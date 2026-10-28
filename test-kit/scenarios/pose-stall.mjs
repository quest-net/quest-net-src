// A walker whose link stalls mid-walk must not slide back on other screens.
// P1 walks Aria across open ground in first person; mid-walk its outgoing live
// poses are held for 1.5s (longer than the 800ms pose timeout), then released
// in order, like a stalled reliable channel. The DM and P2 must see Aria hold
// and then carry on -- no backtrack to her last committed tile, no snap.
//   node test-kit/run.mjs test-kit/scenarios/pose-stall.mjs
import assert from "node:assert/strict";
import { installRecorder, recorderReport } from "../stress.mjs";

export const options = { players: 2 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export default async function poseStall(kit) {
	const { dm, players } = kit;
	const [p1, p2] = players;
	await sleep(3000);

	await p1.eval((qn) => (qn.ctx.AppSettings.cameraMode = "first-person"));
	await sleep(2500);
	for (const p of [dm, p2]) await installRecorder(p);
	await p1.eval((qn) => {
		const aps = qn.actions.actorPoseService;
		const send = aps.sendActorPosePacket;
		let held = null;
		aps.sendActorPosePacket = (...args) => (held ? held.push(args) : send(...args));
		window.__stallPoses = (ms) => {
			held = [];
			setTimeout(() => {
				const queued = held;
				held = null;
				for (const args of queued) send(...args);
			}, ms);
		};
	});

	const box = await p1.page.evaluate(() => {
		const c = [...document.querySelectorAll("canvas")].sort((a, b) => b.width * b.height - a.width * a.height)[0];
		const r = c.getBoundingClientRect();
		return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
	});
	await p1.page.mouse.move(box.x, box.y);
	await p1.page.mouse.down({ button: "right" });
	await sleep(300);
	// Face the open middle of the map (the default heading runs into a corner).
	await p1.page.evaluate(
		() =>
			new Promise((done) => {
				let left = 1428; // ~180 degrees at 0.0022 rad/px
				const tick = () => {
					window.dispatchEvent(new MouseEvent("mousemove", { movementX: 12 }));
					left -= 12;
					left > 0 ? requestAnimationFrame(tick) : done();
				};
				tick();
			})
	);
	await p1.page.keyboard.down("KeyW");
	await sleep(1200);
	const stallAt = Date.now();
	await p1.eval(() => window.__stallPoses(1500));
	await sleep(2500);
	await p1.page.keyboard.up("KeyW");
	await p1.page.mouse.up({ button: "right" });
	await sleep(1500);

	for (const peer of [dm, p2]) {
		const r = await recorderReport(peer);
		const aria = r.jumps.filter((j) => j.who === "Aria" && j.t >= stallAt - 200 && j.t <= stallAt + 3500);
		console.log(`${peer.name}: Aria jumps around the stall: ${aria.map((j) => `${j.kind} ${j.d ?? j.back}`).join(", ") || "none"}`);
		assert.equal(aria.length, 0, `${peer.name} saw Aria hold through the stall, not slide back`);
	}
}
