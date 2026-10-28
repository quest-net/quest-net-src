// A DM broadcast built before the DM handled a player's move must not put the
// actor back on the player's screen. P1's move request is held 600ms on its way
// to the DM while the DM rolls dice; that roll's broadcast still has Aria on
// her old tile. P1 must see Aria move once -- not old -> new -> old -> new.
//   node test-kit/run.mjs test-kit/scenarios/move-revert.mjs [--no-fix]
// --no-fix turns off the player's re-apply of pending moves, to show the
// check catches the bounce.
import assert from "node:assert/strict";

export const options = { players: 1 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export default async function moveRevert(kit) {
	const { dm, players } = kit;
	const [p1] = players;
	await sleep(2000);

	const { id, from } = await p1.eval((qn) => {
		const id = qn.ctx.User.SelectedCharacters.testkit;
		const a = qn.campaign.GameState.Characters.find((c) => c.Id === id);
		return { id, from: qn.plain(a.Position) };
	});
	const to = { ...from, y: from.y + 2 };

	await p1.eval((qn, noFix) => {
		const svc = qn.actions;
		const send = svc.sendActionRequest;
		svc.sendActionRequest = (...args) => setTimeout(() => send(...args), 600);
		if (noFix) svc.reapplyPendingMoves = () => {};
	}, process.argv.includes("--no-fix"));

	// Sample P1's view of Aria's committed tile every 5ms for 2.5s.
	await p1.eval((qn, id) => {
		window.__seen = [];
		const timer = setInterval(() => {
			const a = qn.campaign.GameState.Characters.find((c) => c.Id === id);
			window.__seen.push(`${a.Position.x},${a.Position.y}`);
		}, 5);
		setTimeout(() => clearInterval(timer), 2500);
	}, id);

	await p1.eval((qn, a) => qn.actions.execute("actor:move", { actorId: a.id, position: a.to }), { id, to });
	await sleep(150);
	const aria = await dm.state((c) => c.GameState.Characters[0].Id);
	await dm.act("dice:roll", { actorId: aria, expr: "1d20", total: 9, breakdown: "[9]" }); // predates the move
	await sleep(2600);

	const seen = await p1.eval(() => window.__seen);
	const path = seen.filter((v, i) => v !== seen[i - 1]);
	console.log(`P1 saw Aria: ${path.join(" -> ")}`);
	// The sampler may start after the optimistic move already landed, so the
	// path is [new] or [old, new]; anything else is a bounce.
	const newTile = `${to.x},${to.y}`;
	assert.equal(path.at(-1), newTile, "Aria ends on the new tile");
	assert.ok(!path.slice(path.indexOf(newTile)).includes(`${from.x},${from.y}`), "P1 saw Aria move once, without bouncing back");
	const dmPos = await dm.state((c) => c.GameState.Characters[0].Position);
	assert.deepEqual([dmPos.x, dmPos.y], [to.x, to.y], "the DM applied the move");
}
