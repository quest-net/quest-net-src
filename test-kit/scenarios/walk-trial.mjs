// Walk trial: can the kit drive first person and follow with real input?
// P1 walks in first person, P2 in follow. Each holds the right button on the
// map canvas (pointer lock is faked by kit.mjs), holds W, and must end up on a
// different tile, seen by the DM. Also prints every peer's frame rate, so
// running with more players shows how many this machine can render.
//   node test-kit/run.mjs test-kit/scenarios/walk-trial.mjs [--players N]
import assert from "node:assert/strict";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function controlled(peer) {
	return peer.eval((qn) => {
		const id = qn.ctx.User.SelectedCharacters.testkit;
		const a = qn.campaign.GameState.Characters.find((c) => c.Id === id);
		return { id, name: a.Name, pos: qn.plain(a.Position) };
	});
}

async function mapCanvasCenter(peer) {
	return peer.page.evaluate(() => {
		const canvases = [...document.querySelectorAll("canvas")];
		const c = canvases.sort((a, b) => b.width * b.height - a.width * a.height)[0];
		const r = c.getBoundingClientRect();
		const x = r.left + r.width / 2;
		const y = r.top + r.height / 2;
		return { x, y, hitsCanvas: document.elementFromPoint(x, y) === c };
	});
}

async function fps(peer, ms = 2000) {
	return peer.page.evaluate(
		(ms) =>
			new Promise((resolve) => {
				let n = 0;
				const end = performance.now() + ms;
				const tick = (t) => (t < end ? (n++, requestAnimationFrame(tick)) : resolve((n * 1000) / ms));
				requestAnimationFrame(tick);
			}),
		ms
	);
}

async function walk(peer, dm, mode) {
	await peer.eval((qn, mode) => (qn.ctx.AppSettings.cameraMode = mode), mode);
	await sleep(2500); // mode switch + camera tween
	const before = await controlled(peer);
	const center = await mapCanvasCenter(peer);
	console.log(`${peer.name} ${mode}: ${before.name} at`, before.pos, "canvas hit:", center.hitsCanvas);

	await peer.page.mouse.move(center.x, center.y);
	await peer.page.mouse.down({ button: "right" });
	await sleep(300);
	const locked = await peer.page.evaluate(() => !!document.pointerLockElement);

	// DM samples live poses for this actor while P walks.
	const dmPoses = dm.eval(async (qn, a) => {
		const seen = [];
		for (let i = 0; i < 25; i++) {
			const p = qn.actions.actorPoseService.getLiveActorPoses(a.terrainId).get(a.id);
			if (p) seen.push(p.position.map((v) => +v.toFixed(2)));
			await new Promise((r) => setTimeout(r, 100));
		}
		return seen;
	}, { id: before.id, terrainId: before.pos.terrainId });

	await peer.page.keyboard.down("KeyW");
	await sleep(1500);
	// Turn around and keep walking, in case the first heading was blocked.
	await peer.page.evaluate(() =>
		window.dispatchEvent(new MouseEvent("mousemove", { movementX: 600, movementY: 0 }))
	);
	await sleep(1000);
	await peer.page.keyboard.up("KeyW");
	await sleep(400);
	await peer.page.mouse.up({ button: "right" });

	const poses = await dmPoses;
	await sleep(1500); // settle + commit
	const after = await controlled(peer);
	const dmView = await dm.state((c) => c);
	const dmPos = [...dmView.GameState.Characters].find((c) => c.Id === before.id).Position;
	console.log(`  locked=${locked} live poses at DM: ${poses.length}`, poses.slice(0, 3), "...", poses.slice(-2));
	console.log("  after:", after.pos, "DM sees:", dmPos);
	await peer.shot(`walk-${mode}`);

	assert.ok(locked, `${peer.name}: fake pointer lock engaged`);
	assert.ok(poses.length > 0, `${peer.name}: DM received live poses while walking`);
	const moved = after.pos.x !== before.pos.x || after.pos.y !== before.pos.y;
	assert.ok(moved, `${peer.name}: committed position changed in ${mode}`);
	assert.deepEqual(
		[dmPos.x, dmPos.y, dmPos.h],
		[after.pos.x, after.pos.y, after.pos.h],
		`${peer.name}: DM agrees on the committed tile`
	);
}

export default async function walkTrial(kit) {
	const { dm, players } = kit;
	await sleep(3000); // let maps finish their first mesh
	for (const p of kit.peers()) console.log(`${p.name} fps idle: ${(await fps(p)).toFixed(1)}`);

	await walk(players[0], dm, "first-person");
	await walk(players[1], dm, "follow");

	// Crowd: every player walks in first person at once; all peers measured together.
	await Promise.all(players.map((p) => p.eval((qn) => (qn.ctx.AppSettings.cameraMode = "first-person"))));
	await sleep(2500);
	await Promise.all(
		players.map(async (p) => {
			const c = await mapCanvasCenter(p);
			await p.page.mouse.move(c.x, c.y);
			await p.page.mouse.down({ button: "right" });
			await sleep(300);
			await p.page.keyboard.down("KeyW");
		})
	);
	const crowd = await Promise.all(kit.peers().map((p) => fps(p, 3000)));
	await Promise.all(
		players.map(async (p) => {
			await p.page.keyboard.up("KeyW");
			await p.page.mouse.up({ button: "right" });
		})
	);
	console.log("fps with everyone walking:", kit.peers().map((p, i) => `${p.name}=${crowd[i].toFixed(0)}`).join(" "));
}
