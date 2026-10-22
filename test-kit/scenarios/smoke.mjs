// Smoke test: DM + 2 players connect, a player moves, the DM starts combat,
// a player rolls, and every peer converges. Run:
//   node test-kit/run.mjs test-kit/scenarios/smoke.mjs
import assert from "node:assert/strict";

export default async function smoke(kit) {
	const { dm, players } = kit;
	const [p1, p2] = players;

	// Everyone sees the party; each player holds its own character.
	const dmView = await dm.state((c) => ({
		characters: c.GameState.Characters.map((ch) => ({ id: ch.Id, name: ch.Name, pos: ch.Position })),
		entities: c.GameState.Entities.length,
	}));
	assert.equal(dmView.characters.length, 3);
	for (const p of players) {
		await p.waitFor((c) => c.GameState.Characters.length === 3, { message: "party synced" });
	}
	const p1Char = await p1.eval((qn) => qn.ctx.User.SelectedCharacters.testkit);
	assert.equal(p1Char, dmView.characters[0].id, "P1 claimed Aria");

	// Hidden actors are synced by design (the UI hides them); check the flag arrived.
	const hiddenOnPlayer = await p1.state((c) => c.GameState.Entities.filter((e) => e.Hidden).length);
	assert.equal(hiddenOnPlayer, 1, "hidden goblin synced with Hidden flag");

	// Player move goes through the DM and back out to the other player.
	const from = dmView.characters[0].pos;
	const to = { ...from, y: from.y + 1 };
	await p1.act("actor:move", { actorId: p1Char, position: to });
	const moved = (c) => c.GameState.Characters[0].Position.y === 5;
	await dm.waitFor(moved, { message: "DM saw P1 move" });
	await p2.waitFor(moved, { message: "P2 saw P1 move" });

	// DM starts combat; players see it.
	await dm.act("combat:start", { startingSide: "party" });
	for (const p of players) {
		await p.waitFor((c) => c.GameState.CombatState.isActive, { message: "combat synced" });
	}

	// Player roll lands in the DM's log.
	const p2Char = await p2.eval((qn) => qn.ctx.User.SelectedCharacters.testkit);
	await p2.act("dice:roll", { actorId: p2Char, expr: "1d20", total: 11, breakdown: "[11]" });
	await dm.waitFor((c) => c.Log.some((l) => (l.Action ?? l.action ?? "").includes?.("1d20") || JSON.stringify(l).includes("1d20")), {
		message: "DM logged P2 roll",
	});

	for (const peer of kit.peers()) console.log("screenshot:", await peer.shot("smoke"));
}
