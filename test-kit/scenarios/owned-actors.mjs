// Owned actors: a character's player controls the actors it owns (characters
// or entities), owned actors fight on the party side, owned characters can't be
// picked at character select, and only the DM assigns ownership.
//   node test-kit/run.mjs test-kit/scenarios/owned-actors.mjs
import assert from "node:assert/strict";

// P1 plays the Beast Tamer (owns the Wolf), P2 the Necromancer (raises
// Skeletons), P3 has no character and sits on the character select screen.
export const options = { characters: ["Beast Tamer", "Necromancer", null] };

async function actor(peer, name) {
	return peer.eval(
		(qn, name) =>
			qn.plain(
				[...qn.campaign.GameState.Characters, ...qn.campaign.GameState.Entities].find(
					(a) => a.Name === name
				)
			),
		name
	);
}

/** Give the DM time to receive, (not) apply and re-broadcast a request. */
const settle = (ms = 1500) => new Promise((r) => setTimeout(r, ms));

export default async function ownedActors(kit) {
	const { dm, players } = kit;
	const [tamer, necro, chooser] = players;

	const wolf = await actor(dm, "Wolf");
	const tamerChar = await actor(dm, "Beast Tamer");
	assert.equal(wolf.OwnerId, tamerChar.Id, "spawned Wolf inherited its template owner");

	// --- The owner's player moves and edits the owned entity -----------------
	const wolfTo = { ...wolf.Position, x: wolf.Position.x + 1 };
	await tamer.act("actor:move", { actorId: wolf.Id, position: wolfTo });
	await dm.waitFor(
		(c, a) => c.GameState.Entities.find((e) => e.Id === a.id).Position.x === a.x,
		{ arg: { id: wolf.Id, x: wolfTo.x }, message: "DM applied the Beast Tamer moving the Wolf" }
	);
	const wolfStats = wolf.Stats.map((s, i) => (i === 0 ? { ...s, Current: s.Current - 3 } : s));
	await tamer.act("actor:edit", { actorId: wolf.Id, updates: { Stats: wolfStats } });
	await dm.waitFor(
		(c, a) => c.GameState.Entities.find((e) => e.Id === a.id).Stats[0].Current === a.hp,
		{ arg: { id: wolf.Id, hp: wolfStats[0].Current }, message: "DM applied the Beast Tamer editing the Wolf" }
	);

	// --- The owner's player uses the owned entity's item ---------------------
	const potionUses = wolf.Inventory[0].UsesLeft;
	await tamer.act("item:use", { actorId: wolf.Id, itemId: wolf.Inventory[0].Id });
	await dm.waitFor(
		(c, a) => c.GameState.Entities.find((e) => e.Id === a.id).Inventory[0].UsesLeft === a.uses,
		{ arg: { id: wolf.Id, uses: potionUses - 1 }, message: "Wolf used its potion" }
	);

	// --- Another player can't touch it, and nobody but the DM re-owns it ------
	const before = await actor(dm, "Wolf");
	await necro.act("actor:move", { actorId: wolf.Id, position: { ...before.Position, x: 1 } });
	await necro.act("actor:edit", { actorId: wolf.Id, updates: { Name: "Stolen Wolf" } });
	await tamer.act("actor:edit", { actorId: wolf.Id, updates: { OwnerId: "" } });
	await settle();
	const after = await actor(dm, "Wolf");
	assert.deepEqual(after.Position, before.Position, "Necromancer could not move the Wolf");
	assert.equal(after.Name, "Wolf", "Necromancer could not edit the Wolf");
	assert.equal(after.OwnerId, tamerChar.Id, "a player can't change ownership");

	// --- The owned character is controllable by its owner only ---------------
	const puppet = await actor(dm, "Puppet");
	await necro.act("actor:edit", { actorId: puppet.Id, updates: { MoveSpeed: 1 } });
	await settle();
	assert.equal((await actor(dm, "Puppet")).MoveSpeed, puppet.MoveSpeed, "only the Puppet Master's player may edit the Puppet");

	// --- Character select hides owned characters ------------------------------
	await chooser.page.getByText("Select Your Character").waitFor({ timeout: 15000 });
	assert.equal(await chooser.page.getByText("Puppet Master", { exact: true }).count() > 0, true, "Puppet Master is selectable");
	assert.equal(await chooser.page.getByText("Puppet", { exact: true }).count(), 0, "owned Puppet is not selectable");
	console.log("screenshot:", await chooser.shot("owned-select"));

	// --- Generic summon: Raise Dead spawns a Skeleton owned by its caster -----
	const necroChar = await actor(dm, "Necromancer");
	const raiseDead = await dm.state((c) => c.SkillTemplates.find((s) => s.Name === "Raise Dead").Id);
	await necro.act("skill:use", { actorId: necroChar.Id, skillId: raiseDead });
	await dm.waitFor((c) => c.GameState.Entities.some((e) => e.Name.startsWith("Skeleton")), {
		message: "Raise Dead spawned a Skeleton",
	});
	const skeleton = await actor(dm, "Skeleton");
	assert.equal(skeleton.OwnerId, necroChar.Id, "summoned Skeleton is owned by the caster");
	await necro.act("actor:move", { actorId: skeleton.Id, position: { ...skeleton.Position, y: skeleton.Position.y + 1 } });
	await dm.waitFor(
		(c, a) => c.GameState.Entities.find((e) => e.Id === a.id).Position.y === a.y,
		{ arg: { id: skeleton.Id, y: skeleton.Position.y + 1 }, message: "Necromancer moved their Skeleton" }
	);

	// --- Owned actors fight on the party side --------------------------------
	await dm.act("combat:start", { startingSide: "enemies" });
	const round = () =>
		dm.eval(async (qn) => {
			const { actorsThisRound } = await qn.import("domains/Combat/CombatUtils.ts");
			return actorsThisRound(qn.campaign).map((a) => ({ id: a.Id, name: a.Name }));
		});
	const enemyTurn = await round();
	const enemyNames = enemyTurn.map((a) => a.name);
	assert.ok(enemyNames.some((n) => n.startsWith("Goblin")), `goblins act on the enemy turn: ${enemyNames}`);
	assert.ok(!enemyNames.includes("Wolf") && !enemyNames.includes("Skeleton"), `owned entities don't act with enemies: ${enemyNames}`);
	// The turn banner must agree: once every enemy is done, it says so (it used
	// to keep waiting on the owned Wolf and Skeleton).
	for (const { id } of enemyTurn) await dm.act("combat:markActorTurnDone", { actorId: id });
	await dm.page.locator('.tab[title="Combat"]').click();
	await dm.page.getByText("All enemies have acted this round.").waitFor({ timeout: 5000 });
	await dm.act("combat:incrementRound", {});
	const partyNames = (await round()).map((a) => a.name);
	for (const name of ["Beast Tamer", "Wolf", "Skeleton", "Puppet"]) {
		assert.ok(partyNames.includes(name), `${name} acts on the party turn: ${partyNames}`);
	}
	await tamer.act("combat:markActorTurnDone", { actorId: wolf.Id });
	await dm.waitFor((c, id) => c.GameState.CombatState.RoundCompleted.includes(id), {
		arg: wolf.Id,
		message: "Beast Tamer marked the Wolf's turn done",
	});
	await dm.act("combat:end", {});

	// --- A saved scenario keeps a summon's owner ------------------------------
	// The Skeleton's owner came from the spawn, not its (unowned) template.
	await dm.act("scenario:capture", { name: "With skeleton" });
	await dm.act("actor:despawn", { actorId: skeleton.Id });
	const scenarioId = await dm.state((c) => c.Scenarios.find((s) => s.Name === "With skeleton").Id);
	await dm.act("scenario:load", { scenarioId });
	assert.equal((await actor(dm, "Skeleton"))?.OwnerId, necroChar.Id, "reloaded Skeleton is still the Necromancer's");

	// --- The owner always sees what it owns, even hidden ----------------------
	await dm.act("actor:edit", { actorId: wolf.Id, updates: { Hidden: true } });
	await tamer.waitFor((c, id) => c.GameState.Entities.find((e) => e.Id === id).Hidden === true, {
		arg: wolf.Id,
		message: "hide synced",
	});
	const visible = (peer) =>
		peer.eval(async (qn, id) => {
			const { isActorVisibleToUser } = await qn.import("domains/Actor/ActorVisibilityUtils.ts");
			const a = qn.campaign.GameState.Entities.find((e) => e.Id === id);
			return isActorVisibleToUser(a, qn.ctx.User, qn.campaign.RoomCode, new Set());
		}, wolf.Id);
	assert.equal(await visible(tamer), true, "owner sees the hidden Wolf");
	assert.equal(await visible(necro), false, "other players don't");
	await dm.act("actor:edit", { actorId: wolf.Id, updates: { Hidden: false } });

	// --- DM-side rules: no chains, only characters own, delete releases ------
	const master = await actor(dm, "Puppet Master");
	await dm.act("actor:edit", { actorId: master.Id, updates: { OwnerId: tamerChar.Id } });
	await dm.act("actor:edit", { actorId: puppet.Id, updates: { OwnerId: wolf.Id } });
	await dm.act("actor:edit", { actorId: tamerChar.Id, updates: { OwnerId: tamerChar.Id } });
	assert.equal((await actor(dm, "Puppet Master")).OwnerId, undefined, "an owner can't be owned");
	assert.equal((await actor(dm, "Puppet")).OwnerId, master.Id, "an entity can't own");
	assert.equal((await actor(dm, "Beast Tamer")).OwnerId, undefined, "nothing owns itself");

	const released = await dm.eval(async (qn) => {
		const run = (k, p) => qn.actions.executeAndWait(k, p);
		const { CharacterUtils } = await qn.import("domains/Character/CharacterUtils.ts");
		const owner = { ...CharacterUtils.createDefault(qn.ctx), Name: "Temp Owner" };
		const pet = { ...CharacterUtils.createDefault(qn.ctx), Name: "Temp Pet" };
		await run("character:create", { character: owner });
		await run("character:create", { character: { ...pet, OwnerId: owner.Id } });
		const ownedBefore = qn.campaign.CharacterRoster.find((c) => c.Id === pet.Id).OwnerId;
		await run("actor:delete", { actorId: owner.Id });
		return { ownedBefore: ownedBefore === owner.Id, after: qn.campaign.CharacterRoster.find((c) => c.Id === pet.Id).OwnerId };
	});
	assert.ok(released.ownedBefore, "roster character took its owner");
	assert.equal(released.after, undefined, "deleting the owner released it");

	// --- Despawning the summon removes it; the owner's despawn leaves owned ---
	await dm.act("actor:despawn", { actorId: skeleton.Id });
	await dm.act("actor:despawn", { actorId: tamerChar.Id });
	assert.equal((await actor(dm, "Skeleton")), undefined, "despawned Skeleton is gone");
	assert.equal((await actor(dm, "Wolf")).OwnerId, tamerChar.Id, "Wolf keeps its owner while the owner is benched");

	console.log("screenshot:", await dm.shot("owned-actors"));
}
