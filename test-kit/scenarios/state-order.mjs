// State update ordering under load. Players unpack state updates
// asynchronously, and full updates are always gzip'd while small deltas are
// not, so a delta arriving right behind a full can be applied first. This
// counts, per player, updates applied out of send order and full-sync
// requests, and on the DM how many full broadcasts went out and why.
//   node test-kit/run.mjs test-kit/scenarios/state-order.mjs --players 6 [--seconds 40] [--net mild]
import { setCameraMode, startWalker, startClicker, startChaos, impair } from "../stress.mjs";

const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
const seconds = Number(opt("seconds", 40));
const netArg = opt("net", null);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export default async function stateOrder(kit) {
	const { dm, players } = kit;
	await sleep(3000);

	await dm.eval((qn) => {
		const ss = qn.actions.stateSync;
		const s = (window.__qnOrder = { full: 0, delta: 0, requestedFull: 0 });
		const queue = ss.queueStateSend.bind(ss);
		ss.queueStateSend = (u, target) => {
			if (!target) s[u.type]++;
			return queue(u, target);
		};
		// Full broadcasts a player asked for (REQUEST_FULL_SYNC after a mismatch).
		const bf = ss.broadcastFull.bind(ss);
		ss.broadcastFull = (c) => {
			s.requestedFull++;
			return bf(c);
		};
	});
	for (const p of players) {
		await p.eval((qn) => {
			const ss = qn.actions.stateSync;
			const s = (window.__qnOrder = { applied: 0, full: 0, outOfOrder: 0, fullOverNewer: 0, mismatchRequests: 0, last: 0 });
			const handle = ss.handleIncomingState.bind(ss);
			ss.handleIncomingState = (u) => {
				s.applied++;
				if (u.type === "full") s.full++;
				if (u.timestamp < s.last) {
					s.outOfOrder++;
					if (u.type === "full") s.fullOverNewer++;
				}
				s.last = Math.max(s.last, u.timestamp);
				return handle(u);
			};
			const req = ss.triggerFullSyncRequest.bind(ss);
			ss.triggerFullSyncRequest = () => {
				s.mismatchRequests++;
				return req();
			};
		});
		if (netArg === "mild") await impair(p, { latency: 30, jitter: 40, stallEveryMs: 10000, stallMs: 400 });
	}

	if (args.includes("--race")) {
		// Deterministic probe: a full broadcast immediately followed by a delta.
		await dm.eval(async (qn) => {
			const ss = qn.actions.stateSync;
			for (let i = 0; i < 20; i++) {
				ss.broadcastFull(qn.plain(qn.campaign));
				await qn.actions.executeAndWait("dice:roll", { actorId: qn.campaign.GameState.Characters[0].Id, expr: "1d20", total: 3, breakdown: "[3]" });
				await new Promise((r) => setTimeout(r, 300));
			}
		});
		await sleep(3000);
		console.log("DM broadcasts:", JSON.stringify(await dm.eval(() => window.__qnOrder)));
		for (const p of players) console.log(p.name, JSON.stringify(await p.eval(() => window.__qnOrder)));
		// Did the older full overwrite the newer delta's change for good?
		const logLen = (peer) => peer.state((c) => c.Log.length);
		console.log("log entries: DM", await logLen(dm), players.map((p) => p.name).join("/"), await Promise.all(players.map(logLen)));
		return;
	}

	const modes = ["first-person", "follow", "ortho", "perspective"];
	const stops = await Promise.all(
		players.map((p, i) => (i % 4 < 2 ? startWalker(p, modes[i % 4]) : startClicker(p, modes[i % 4])))
	);
	stops.push(await startChaos(dm));
	await sleep(seconds * 1000);
	await Promise.all(stops.map((s) => s()));
	await sleep(3000);

	console.log("DM broadcasts:", JSON.stringify(await dm.eval(() => window.__qnOrder)));
	for (const p of players) console.log(p.name, JSON.stringify(await p.eval(() => window.__qnOrder)));
	await setCameraMode(dm, "ortho");
}
