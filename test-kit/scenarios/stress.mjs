// Movement stress test: every player moves at once while the DM (optionally)
// churns campaign state, and every peer records visible token/camera jumps.
// Writes test-kit/out/stress-<label>.json and prints a summary. It reports
// rather than asserts: a run "passes" when it completes.
//
//   node test-kit/run.mjs test-kit/scenarios/stress.mjs --players 6 [flags]
//     --modes a,b,...  camera modes handed to players round-robin
//                      (first-person, follow, ortho, perspective; default all four)
//     --chaos          DM spawns, moves NPCs across terrains, runs combat rounds
//                      (fires scripts), casts Raise Dead, gives statuses
//     --net mild | bad | L,J,E,S   impair every player's link: latency L ms,
//                      jitter J ms, a stall of S ms every ~E ms
//                      ("mild" = 30,40,10000,400; "bad" = 60,80,6000,1200)
//     --split          every other player starts in the Old Cellar
//     --seconds N      how long everyone moves (default 60)
//     --dm-mode M      the DM's camera (default ortho)
//     --label NAME     output file name (default from the flags)
//     --self-check     halfway through, the DM teleports P1's character 5 tiles;
//                      fails unless the DM and P1 recorders flag it
import assert from "node:assert/strict";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { OUT_DIR } from "../kit.mjs";
import {
	installRecorder,
	recorderReport,
	impair,
	setCameraMode,
	startWalker,
	startClicker,
	startChaos,
	moveToTerrain,
} from "../stress.mjs";

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n, d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const modes = opt("modes", "first-person,follow,ortho,perspective").split(",");
const chaos = flag("chaos");
const netArg = opt("net", null);
const NET_PRESETS = { mild: [30, 40, 10000, 400], bad: [60, 80, 6000, 1200] };
const net = NET_PRESETS[netArg] ?? (netArg ? netArg.split(",").map(Number) : null);
const split = flag("split");
const seconds = Number(opt("seconds", 60));
const dmMode = opt("dm-mode", "ortho");
const selfCheck = flag("self-check");
const label =
	opt("label", null) ??
	[modes.join("+"), chaos ? "chaos" : "calm", net ? `net${net.join("-")}` : "clean", split ? "split" : "one"].join("_");

export default async function stress(kit) {
	const { dm, players } = kit;
	const log = [];
	const note = (who, what) => log.push({ t: Date.now(), who, what });
	const charName = (p) =>
		p.eval((qn) => qn.campaign.GameState.Characters.find((c) => c.Id === qn.ctx.User.SelectedCharacters.testkit)?.Name);

	await sleep(3000);
	const assigned = [];
	for (const [i, p] of players.entries()) assigned.push({ peer: p.name, char: await charName(p), mode: modes[i % modes.length] });
	if (split) {
		for (const [i, a] of assigned.entries()) {
			if (i % 2 === 1) {
				await moveToTerrain(dm, a.char, "Old Cellar");
				a.terrain = "Old Cellar";
			}
		}
		await sleep(2000);
	}
	console.log(`stress ${label}: ${seconds}s`);
	for (const a of assigned) console.log(`  ${a.peer} ${a.char} ${a.mode}${a.terrain ? " (cellar)" : ""}`);

	for (const p of kit.peers()) await installRecorder(p);
	if (net) {
		const [latency, jitter, stallEveryMs, stallMs] = net;
		for (const p of players) await impair(p, { latency, jitter, stallEveryMs, stallMs });
	}
	await setCameraMode(dm, dmMode);

	const stops = await Promise.all(
		players.map((p, i) => {
			const mode = assigned[i].mode;
			return mode === "first-person" || mode === "follow" ? startWalker(p, mode, note) : startClicker(p, mode, note);
		})
	);
	if (chaos) stops.push(await startChaos(dm, note));
	note("kit", "everyone moving");

	if (selfCheck) {
		// Positive controls, halfway through. (A DM move of a character that is
		// still walking is NOT one: the walker's next commit overrides it.)
		await sleep((seconds * 1000) / 2);
		// 1. P1 stops; once settled, a DM move must snap P1's own body.
		await stops[0]();
		await sleep(3000);
		const to = await dm.eval(async (qn, name) => {
			const a = qn.campaign.GameState.Characters.find((c) => c.Name === name);
			const p = a.Position;
			const to = { ...p, x: p.x > 12 ? p.x - 5 : p.x + 5 };
			await qn.actions.executeAndWait("actor:move", { actorId: a.Id, position: to });
			return to;
		}, assigned[0].char);
		note("DM", `self-check teleport ${assigned[0].char} -> ${to.x},${to.y}`);
		// 2. A 3-unit jump injected into the DM's drawn token must be flagged.
		await sleep(1500);
		await dm.eval((qn, name) => {
			const a = qn.campaign.GameState.Characters.find((c) => c.Name === name);
			const g = window.__qnActorLayer.groups.get(`character:${a.Id}`);
			g.position.x += 3;
			setTimeout(() => (g.position.x -= 3), 500);
		}, assigned[0].char);
		note("DM", "self-check injected jump");
		await sleep((seconds * 1000) / 2);
	} else {
		await sleep(seconds * 1000);
	}
	note("kit", "stopping");
	await Promise.all(stops.map((s) => s()));
	await sleep(4000); // settle, commit, broadcast

	// Do all peers agree on where everyone is once things settle?
	const positions = (peer) =>
		peer.state((c) =>
			Object.fromEntries(
				[...c.GameState.Characters, ...c.GameState.Entities].map((a) => [
					a.Name + "#" + a.Id.slice(0, 4),
					`${a.Position.terrainId.slice(0, 4)}|${a.Position.x},${a.Position.y},${a.Position.h}`,
				])
			)
		);
	const truth = await positions(dm);
	const desync = [];
	for (const p of players) {
		const view = await positions(p);
		for (const [k, v] of Object.entries(truth)) if (view[k] !== v) desync.push(`${p.name}: ${k} DM=${v} player=${view[k] ?? "missing"}`);
		for (const k of Object.keys(view)) if (!(k in truth)) desync.push(`${p.name}: ${k} exists only on player`);
	}

	const reports = [];
	for (const p of kit.peers()) {
		const r = await recorderReport(p);
		if (!r) continue;
		for (const j of r.jumps) j.driver = log.filter((e) => e.t >= j.t - 1500 && e.t <= j.t + 50).map((e) => `${e.t - j.t}ms ${e.who}: ${e.what}`);
		reports.push({ ...r, mode: assigned.find((a) => a.peer === p.name)?.mode ?? dmMode });
	}

	await mkdir(OUT_DIR, { recursive: true });
	const file = path.join(OUT_DIR, `stress-${label}.json`);
	await writeFile(file, JSON.stringify({ label, seconds, assigned, chaos, net, split, desync, reports, driverLog: log }, null, 2));

	// snap/back: other tokens as drawn; bSnap/bBack: this walker's own body.
	console.log("\npeer  mode          fps  long  snap  back  bSnap  bBack  cam  states");
	for (const r of reports) {
		const c = r.counts;
		const n = (v, w) => String(v ?? 0).padStart(w);
		console.log(
			`${r.peer.padEnd(5)} ${r.mode.padEnd(13)} ${n(r.fps, 4)} ${n(r.longFrames, 5)} ${n(c.snap, 5)} ${n(c.backtrack, 5)} ${n(c.bodySnap, 6)} ${n(c.bodyBacktrack, 6)} ${n(c.cameraSnap, 4)} ${n(r.states, 7)}`
		);
	}
	console.log(`desync after settle: ${desync.length ? "\n  " + desync.join("\n  ") : "none"}`);
	const all = reports.flatMap((r) => r.jumps.map((j) => ({ peer: r.peer, ...j })));
	console.log(`\njumps: ${all.length} (first 12; full detail in ${file})`);
	for (const j of all.slice(0, 12)) {
		console.log(`  ${j.peer} ${j.kind} ${j.who} [${j.cls}] ${j.d ?? j.back} units${j.speed ? ` at ${j.speed}/s` : ""}, last pose ${j.lastPoseGapMs ?? "-"}ms before`);
		for (const line of j.context.slice(-5)) console.log(`      ${line}`);
	}
	for (const p of kit.peers()) await p.shot(`stress-${label}`);

	if (selfCheck) {
		const near = (what) => {
			const t = log.find((e) => e.what.startsWith(what)).t;
			return all.filter((j) => Math.abs(j.t - t) < 1500);
		};
		const body = near("self-check teleport").filter((j) => j.peer === "P1" && j.kind === "bodySnap");
		const injected = near("self-check injected").filter((j) => j.peer === "DM" && j.kind === "snap");
		console.log(`self-check: P1 bodySnap ${body.length ? "yes" : "NO"}, DM injected snap ${injected.length ? "yes" : "NO"}`);
		assert.ok(body.length, "self-check: a DM move of a stopped walker snaps its body (bodySnap)");
		assert.ok(injected.length, "self-check: the DM recorder flags an injected 3-unit jump");
	}
}
