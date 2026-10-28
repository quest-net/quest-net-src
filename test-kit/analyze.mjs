// Sorts every flagged jump in test-kit/out/stress-<prefix>*.json into a likely
// cause, using the events the recorder kept before it.
//   node test-kit/analyze.mjs [prefix]   (default "m-", the matrix runs)
// Causes:
//   revert       the actor's committed tile went A->B then back to A (a stale
//                broadcast undid a not-yet-confirmed move), then usually forward again
//   poseExpiry   the token's live pose ended just before (no pose for 800ms),
//                so it eased back to its last committed tile, then chased again
//   walkerBody   a walker's own body jumped/backtracked at the same moment
//                (observers just see it in the pose stream)
//   dmMove       an NPC the DM moved / spawned (expected, not a bug)
//   other        none of the above
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { OUT_DIR } from "./kit.mjs";

const prefix = process.argv[2] ?? "m-";
const files = (await readdir(OUT_DIR)).filter((f) => f.startsWith(`stress-${prefix}`) && f.endsWith(".json")).sort();
const parse = (line) => {
	const m = /^(-?\d+)ms (\w+)\s?(.*)$/.exec(line);
	return m ? { dt: +m[1], type: m[2], rest: m[3] } : null;
};
const samples = {};
const totals = {};
const rows = [];

for (const f of files) {
	const run = JSON.parse(await readFile(path.join(OUT_DIR, f), "utf8"));
	const walkers = new Map(run.assigned.filter((a) => a.mode === "first-person" || a.mode === "follow").map((a) => [a.char, a.peer]));
	const charOf = Object.fromEntries(run.assigned.map((a) => [a.peer, a.char]));
	const players = new Set(run.assigned.map((a) => a.char));
	const bodyJumps = run.reports.flatMap((r) => r.jumps.filter((j) => j.kind.startsWith("body")).map((j) => ({ ...j, char: charOf[r.peer] })));
	const counts = {};
	for (const r of run.reports) {
		for (const j of r.jumps) {
			const who = j.who === "body" || j.who === "camera" ? charOf[r.peer] : j.who;
			const ctx = j.context.map(parse).filter(Boolean);
			const commits = r.commits.filter((c) => c.who === who && c.t >= j.t - 2500 && c.t <= j.t + 100);
			const reverted = commits.some((c, i) => commits.slice(i + 1).some((d) => d.to === c.from && d.from === c.to));
			let cause;
			if (reverted) cause = "revert";
			else if (ctx.some((e) => e.type === "liveEnd" && e.rest.startsWith(who))) cause = "poseExpiry";
			else if (walkers.has(who) && bodyJumps.some((b) => b.char === who && Math.abs(b.t - j.t) < 400)) cause = "walkerBody";
			else if (!players.has(who)) cause = "dmMove";
			else cause = "other";
			const key = `${cause}`;
			counts[key] = (counts[key] ?? 0) + 1;
			totals[key] = (totals[key] ?? 0) + 1;
			(samples[key] ??= []).push({ run: run.label, peer: r.peer, kind: j.kind, who, cls: j.cls, size: j.d ?? j.back, ctx: j.context.slice(-6) });
		}
	}
	const fps = Math.min(...run.reports.map((r) => r.fps));
	const long = run.reports.reduce((s, r) => s + r.longFrames, 0);
	const jumps = run.reports.reduce((s, r) => s + r.jumps.length, 0);
	rows.push({ run: run.label, jumps, ...counts, minFps: fps, longFrames: long, desync: run.desync.length });
}

console.table(rows);
console.log("totals:", totals);
for (const [cause, list] of Object.entries(samples)) {
	console.log(`\n--- ${cause}: ${list.length} (2 samples)`);
	for (const s of list.filter((_, i) => i % Math.max(1, Math.floor(list.length / 2)) === 0).slice(0, 2)) {
		console.log(`${s.run} ${s.peer} ${s.kind} ${s.who} [${s.cls}] ${s.size}`);
		for (const l of s.ctx) console.log(`    ${l}`);
	}
}
