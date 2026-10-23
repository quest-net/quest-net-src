// Script Scope: scripts on actors/templates default to "self" (only events about
// their own bearer and template), "any" opts out, old fixture scripts were
// migrated to "any", status:give binds event.actor per bearer, and
// actor.owned() / game.spawnActor() return facades.
//   node test-kit/run.mjs --players 0 test-kit/scenarios/script-scope.mjs
import assert from "node:assert/strict";

const WHISTLE = `const wolf = this.actor.owned("Wolf")[0];
if (wolf) await wolf.despawn();
else this.vars.spawned = (await game.spawnActor("Wolf", this.actor.Position, { owner: this.actor }))?.Name ?? "none";`;

/** Like peer.state(fn), but passes `arg` through as fn's second argument. */
const read = (peer, fn, arg) =>
	peer.eval(
		(qn, { src, arg }) => qn.plain(new Function(`return (${src})`)()(qn.campaign, arg)),
		{ src: fn.toString(), arg }
	);

const ownedWolves = (dm, ownerId) =>
	read(dm, 
		(c, id) => c.GameState.Entities.filter((e) => e.OwnerId === id).map((e) => e.Name),
		ownerId
	);

export default async function scriptScope(kit) {
	const { dm } = kit;

	// --- Migration: every pre-3.2.0 fixture script keeps its old behavior -----
	const scopes = await read(dm, (c) =>
		[c, ...c.ItemTemplates, ...c.StatusTemplates, ...c.SkillTemplates, ...c.EntityTemplates]
			.flatMap((h) => h.Scripts ?? [])
			.map((s) => s.Scope)
	);
	assert.ok(scopes.length > 0, "fixture has scripts");
	assert.ok(scopes.every((s) => s === "any"), `fixture scripts stamped "any": ${scopes}`);

	const ids = await read(dm, (c) => {
		const ch = (n) => c.GameState.Characters.find((a) => a.Name === n).Id;
		return { aria: ch("Aria"), borin: ch("Borin"), cyra: ch("Cyra") };
	});

	// --- Self scope: only the user's own whistle reacts -----------------------
	await dm.act("item:create", {
		item: {
			Id: "test-whistle",
			Name: "Wolf Whistle",
			IsEquippable: false,
			Scripts: [{ Trigger: "item:use", Code: WHISTLE }],
		},
	});
	await dm.act("item:create", { item: { Id: "test-pebble", Name: "Pebble", IsEquippable: false } });
	await dm.act("item:give", {
		itemIds: ["test-whistle", "test-pebble"],
		actorIds: [ids.aria, ids.borin],
		count: 1,
	});

	await dm.act("item:use", { actorId: ids.aria, itemId: "test-pebble" });
	assert.deepEqual(await ownedWolves(dm, ids.aria), [], "another item does not trigger the whistle");

	await dm.act("item:use", { actorId: ids.aria, itemId: "test-whistle" });
	assert.equal((await ownedWolves(dm, ids.aria)).length, 1, "Aria's use summons exactly one wolf");
	assert.deepEqual(await ownedWolves(dm, ids.borin), [], "Borin's whistle ignored Aria's use");

	// The spawned facade came back (second Wolf renames both to "Wolf [A]/[B]").
	const spawned = await read(dm, 
		(c, id) =>
			c.GameState.Characters.find((a) => a.Id === id).Inventory.find((s) => s.Id === "test-whistle")
				.ScriptVars?.spawned,
		ids.aria
	);
	assert.match(spawned ?? "", /^Wolf/, `spawnActor returned the new actor (got ${spawned})`);

	// owned("Wolf") matches "Wolf [B]", so a second use dismisses it.
	await dm.act("item:use", { actorId: ids.aria, itemId: "test-whistle" });
	assert.deepEqual(await ownedWolves(dm, ids.aria), [], "second use dismisses Aria's wolf");

	// --- status:give to two actors binds event.actor to each bearer ------------
	await dm.act("status:create", {
		status: {
			Id: "test-marked",
			Name: "Marked",
			Expiration: { type: "permanent" },
			Scripts: [{ Trigger: "status:give", Code: "this.vars.me = event.actor?.Id === this.actor.Id;" }],
		},
	});
	await dm.act("status:give", { statusIds: ["test-marked"], actorIds: [ids.aria, ids.borin], count: 1 });
	const marked = await read(dm, 
		(c, a) =>
			[a.aria, a.borin].map(
				(id) =>
					c.GameState.Characters.find((x) => x.Id === id).Statuses.find((s) => s.Id === "test-marked")
						?.ScriptVars?.me
			),
		ids
	);
	assert.deepEqual(marked, [true, true], "each bearer sees itself as event.actor");

	// --- Scope "any" still hears other actors ----------------------------------
	await dm.act("status:create", {
		status: {
			Id: "test-watch",
			Name: "Watching",
			Expiration: { type: "permanent" },
			Scripts: [
				{ Trigger: "actor:move", Scope: "any", Code: "this.vars.n = (this.vars.n ?? 0) + 1;" },
				{ Trigger: "actor:move", Code: "this.vars.self = (this.vars.self ?? 0) + 1;" },
			],
		},
	});
	await dm.act("status:give", { statusIds: ["test-watch"], actorIds: [ids.borin], count: 1 });
	const cyra = await read(dm, (c, id) => c.GameState.Characters.find((a) => a.Id === id).Position, ids.cyra);
	await dm.act("actor:move", { actorId: ids.cyra, position: { ...cyra, x: cyra.x + 1 } });
	const watch = await read(dm, 
		(c, id) =>
			c.GameState.Characters.find((a) => a.Id === id).Statuses.find((s) => s.Id === "test-watch")
				?.ScriptVars,
		ids.borin
	);
	assert.equal(watch?.n, 1, `"any" script saw Cyra move (vars ${JSON.stringify(watch)})`);
	assert.equal(watch?.self, undefined, '"self" script ignored Cyra move');
}
