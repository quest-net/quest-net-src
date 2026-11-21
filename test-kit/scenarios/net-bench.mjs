// Networking benchmark: join time, action and pose latency, bulk transfer,
// head-of-line blocking, terrain/image fetches, player and DM reload recovery.
// Written against app-level APIs only, so it runs unchanged across Trystero
// versions (used to compare 0.26 vs 0.27). Report: test-kit/out/net-bench-<label>.json
//   node test-kit/run.mjs test-kit/scenarios/net-bench.mjs --label v26
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { openPeer, waitForDm, ROOM_CODE, OUT_DIR, ROOT } from "../kit.mjs";

export const options = { players: 0 };

const args = process.argv.slice(2);
const label = args.includes("--label") ? args[args.indexOf("--label") + 1] : "run";
const ITER = 30;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const stats = (xs) => {
	const s = [...xs].sort((a, b) => a - b);
	const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
	return { n: s.length, min: s[0], p50: q(0.5), p90: q(0.9), max: s[s.length - 1] };
};

// Page-side: resolve with Date.now() once fn(campaign, arg) holds (5ms polling).
const until = (peer, fn, arg, timeout = 20000) =>
	peer.eval(
		async (qn, { src, arg, timeout }) => {
			const f = new Function(`return (${src})`)();
			const end = Date.now() + timeout;
			while (Date.now() < end) {
				if (qn.campaign && f(qn.campaign, arg, qn)) return Date.now();
				await new Promise((r) => setTimeout(r, 5));
			}
			return null;
		},
		{ src: fn.toString(), arg, timeout }
	);

async function joinPlayer(kit, i, characterId) {
	const p = await openPeer(kit, `P${i + 1}`);
	await p.eval(
		async (qn, { room, characterId }) => {
			const { UserUtils } = await qn.import("domains/User/UserUtils.ts");
			UserUtils.selectCharacter({ campaignId: room, characterId }, qn.ctx);
		},
		{ room: ROOM_CODE, characterId }
	);
	const start = Date.now();
	await p.goto(ROOM_CODE);
	await waitForDm(p);
	kit.players.push(p);
	return { p, ms: Date.now() - start };
}

// One-way latency of a dice roll from `sender` until each receiver's log holds
// it (matched by a unique breakdown marker, so pending echoes can't fake it).
let rollSeq = 0;
async function rollLatency(sender, receivers, actorId) {
	const marker = `bench-${++rollSeq}-${Date.now()}`;
	const arrivals = receivers.map((r) =>
		until(r, (c, m) => c.Log.slice(-30).some((e) => JSON.stringify(e).includes(m)), marker)
	);
	await sleep(30);
	const sentAt = await sender.eval(async (qn, { actorId, marker }) => {
		const t = Date.now();
		qn.actions.execute("dice:roll", { actorId, expr: "1d20", total: 7, breakdown: marker });
		return t;
	}, { actorId, marker });
	return (await Promise.all(arrivals)).map((t) => (t == null ? null : t - sentAt));
}

// Version-agnostic listener registration: 0.27 methods vs 0.26 settable props.
const ON_SRC = `(act, kind, fn) => typeof act[kind] === "function" ? act[kind](fn) : (act[kind] = fn)`;

export default async function netBench(kit) {
	const { dm } = kit;
	const report = { label, trystero: JSON.parse(await readFile(path.join(ROOT, "node_modules/trystero/package.json"), "utf8")).version };
	const characters = await dm.state((c) => c.GameState.Characters.map((ch) => ch.Id));

	// 1. Fresh joins (DM has been up only a few seconds), three players at once.
	const joins = await Promise.all([0, 1, 2].map((i) => joinPlayer(kit, i, characters[i])));
	kit.players.sort((a, b) => a.name.localeCompare(b.name));
	const [p1, p2, p3] = kit.players;
	report.joinMs = joins.map((j) => j.ms);
	await sleep(2000);
	report.campaignPeers = {};
	for (const peer of kit.peers()) {
		report.campaignPeers[peer.name] = await peer.eval((qn) => Object.keys(qn.actions.room.getPeers()).length);
	}

	// 2. Action latency, both directions.
	const p2dm = [];
	const dm2p = [];
	for (let i = 0; i < ITER; i++) {
		const [toDm] = await rollLatency(p1, [dm], characters[0]);
		p2dm.push(toDm);
		const toPlayers = await rollLatency(dm, [p1, p2, p3], characters[0]);
		dm2p.push(...toPlayers);
	}
	assert.ok(!p2dm.includes(null) && !dm2p.includes(null), "an action never arrived");
	report.actionPlayerToDmMs = stats(p2dm);
	report.actionDmToPlayersMs = stats(dm2p);

	// 3. Live pose latency (pose room), P1 -> DM and P2.
	const { actorId, terrainId } = await p1.eval((qn) => {
		const id = qn.ctx.User.SelectedCharacters.testkit;
		const a = qn.campaign.GameState.Characters.find((c) => c.Id === id);
		return { actorId: id, terrainId: a.Position.terrainId };
	});
	for (const r of [dm, p2]) {
		await r.eval((qn, { actorId, terrainId }) => {
			const seen = (window.__qnPoseSeen = {});
			const svc = qn.actions.actorPoseService;
			svc.subscribeLiveActorPoses(() => {
				const pose = svc.getLiveActorPoses(terrainId).get(actorId);
				if (pose) seen[Math.round(pose.position[0] * 10)] ??= Date.now();
			});
		}, { actorId, terrainId });
	}
	const poseSent = await p1.eval(async (qn, a) => {
		const sent = {};
		for (let seq = 1; seq <= 50; seq++) {
			sent[seq] = Date.now();
			qn.actions.actorPoseService.sendActorPose({ ...a, position: [seq / 10, 2, 1.5] });
			await new Promise((r) => setTimeout(r, 80));
		}
		return sent;
	}, { actorId, terrainId });
	await sleep(1000);
	for (const r of [dm, p2]) {
		const seen = await r.eval(() => window.__qnPoseSeen);
		const lat = Object.entries(poseSent).filter(([s]) => seen[s]).map(([s, t]) => seen[s] - t);
		report[`pose_${r.name}`] = { received: lat.length, of: 50, ...stats(lat) };
	}

	// 4. Bulk transfer DM -> P1 on a benchmark channel, plus small-message
	//    latency (P1 -> DM action) while an 8 MB transfer is in flight.
	// getPeerUser on 0.27; peerUsers on the 0.26 baseline.
	const p1PeerId = await dm.eval((qn) => [...qn.actions.connectedPeerIds].find((id) => (qn.actions.getPeerUser?.(id) ?? qn.actions.peerUsers?.get(id))?.Name === "P1"));
	await p1.eval((qn, on) => {
		const act = qn.actions.room.makeAction("benchBlob");
		window.__qnBlobs = [];
		new Function(`return (${on})`)()(act, "onMessage", (data) => window.__qnBlobs.push({ at: Date.now(), bytes: data.byteLength }));
	}, ON_SRC);
	await dm.eval((qn) => {
		window.__qnBenchSend = qn.actions.room.makeAction("benchBlob").send;
	});
	await sleep(500);
	report.bulk = [];
	for (const mb of [0.25, 1, 4]) {
		const bytes = Math.round(mb * 1024 * 1024);
		const n = await p1.eval(() => window.__qnBlobs.length);
		const arrival = until(p1, (_c, n) => window.__qnBlobs.length > n, n, 60000);
		const sentAt = await dm.eval(async (_qn, { bytes, target }) => {
			const t = Date.now();
			window.__qnBenchSend(new Uint8Array(bytes), { target });
			return t;
		}, { bytes, target: p1PeerId });
		const at = await arrival;
		const ms = at == null ? null : at - sentAt;
		report.bulk.push({ mb, ms, mbps: ms ? +((mb * 8) / (ms / 1000)).toFixed(1) : null });
	}
	{
		const n = await p1.eval(() => window.__qnBlobs.length);
		const arrival = until(p1, (_c, n) => window.__qnBlobs.length > n, n, 60000);
		const sentAt = await dm.eval(async (_qn, target) => {
			const t = Date.now();
			window.__qnBenchSend(new Uint8Array(8 * 1024 * 1024), { target });
			return t;
		}, p1PeerId);
		await sleep(50);
		const [hol] = await rollLatency(p1, [dm], characters[0]);
		const [holBack] = await rollLatency(dm, [p1], characters[0]);
		const at = await arrival;
		report.duringBulk8mb = { bulkMs: at && at - sentAt, actionPlayerToDmMs: hol, actionDmToSenderTargetMs: holBack };
	}

	// 5. Terrain + image fetches as the player app does them.
	const fetches = await p1.eval(async (qn) => {
		const dmId = qn.actions.getDmPeerId();
		const out = { terrains: [], images: { count: 0, bytes: 0, ms: 0 } };
		for (const t of qn.campaign.VoxelTerrains) {
			const s = performance.now();
			const buf = await qn.actions.terrainTransferService.requestTerrainData(t.Id, { target: dmId, timeoutMs: 60000 });
			out.terrains.push({ name: t.Name, bytes: buf?.byteLength ?? 0, ms: Math.round(performance.now() - s) });
		}
		const s = performance.now();
		const bufs = await Promise.all(
			qn.campaign.Images.map((img) => qn.actions.imageService.requestImage(img.Id, { target: dmId, timeoutMs: 60000 }).catch(() => null))
		);
		out.images = { count: bufs.filter(Boolean).length, of: bufs.length, bytes: bufs.reduce((n, b) => n + (b?.byteLength ?? 0), 0), ms: Math.round(performance.now() - s) };
		return out;
	});
	const tr = fetches.terrains;
	report.fetches = {
		terrains: { count: tr.length, bytes: tr.reduce((n, t) => n + t.bytes, 0), totalMs: tr.reduce((n, t) => n + t.ms, 0), maxMs: Math.max(...tr.map((t) => t.ms)) },
		images: fetches.images,
	};

	// 5b. Terrain edit: the DM adds stone voxels; P1 should rebuild the payload
	//     from the broadcast delta, not fall back to a full terrainFetch.
	await p1.eval((qn) => {
		const tts = qn.actions.terrainTransferService;
		const s = (window.__qnTerrain = { fullFetches: 0, deltaTypes: [] });
		const fetch = tts.fetchTerrain.bind(tts);
		tts.fetchTerrain = (...a) => (s.fullFetches++, fetch(...a));
		const handle = tts.handleDelta.bind(tts);
		tts.handleDelta = (data, meta) => (s.deltaTypes.push(data?.constructor?.name), handle(data, meta));
	});
	report.terrainEditMs = [];
	for (let i = 0; i < 3; i++) {
		const { terrainId, newHash, sentAt } = await dm.eval(async (qn, i) => {
			const { decodeVoxels, encodeVoxels } = await qn.import("utils/terrain/data/VoxelDataUtils.ts");
			const { resolveTerrainVoxels } = await qn.import("utils/terrain/data/terrainPayloadStore.ts");
			const terrain = qn.campaign.VoxelTerrains.find((t) => t.Name === "Forest Clearing");
			const voxels = [...decodeVoxels(resolveTerrainVoxels(terrain))];
			voxels.push({ x: 20 + i, y: 3, z: 20, color: 240 });
			const sentAt = Date.now();
			await qn.actions.executeAndWait("terrain:edit", { terrainId: terrain.Id, updates: { Voxels: encodeVoxels(voxels) } });
			return { terrainId: terrain.Id, newHash: terrain.ContentHash, sentAt };
		}, i);
		const at = await p1.eval(async (qn, { terrainId, newHash }) => {
			const { getMaterializedContentHash } = await qn.import("utils/terrain/data/terrainPayloadStore.ts");
			const end = Date.now() + 20000;
			while (Date.now() < end) {
				if (getMaterializedContentHash(terrainId) === newHash) return Date.now();
				await new Promise((r) => setTimeout(r, 5));
			}
			return null;
		}, { terrainId, newHash });
		report.terrainEditMs.push(at == null ? null : at - sentAt);
	}
	report.terrainDeltaPath = await p1.eval(() => window.__qnTerrain);

	// 6. Player reload: P3 refreshes, time until it holds the DM again.
	{
		const start = Date.now();
		await p3.page.reload();
		await p3.page.waitForFunction(() => !!window.__qnActionService?.getDmPeerId?.() && !!window.__qnActionService, null, { timeout: 90000, polling: 50 });
		await p3.eval((qn) => (window.__qnCtx = qn.ctx));
		await p3.waitFor((c) => c.GameState?.Characters?.length >= 0);
		report.playerReloadMs = Date.now() - start;
	}

	// 7. DM reload: time until every player is linked to the new DM peer and
	//    has a fresh state from it.
	{
		const oldDm = await p1.eval((qn) => qn.actions.getDmPeerId());
		const waits = kit.players.map((p) =>
			p.eval(async (qn, oldDm) => {
				const end = Date.now() + 120000;
				while (Date.now() < end) {
					const id = qn.actions?.getDmPeerId();
					if (id && id !== oldDm) return Date.now();
					await new Promise((r) => setTimeout(r, 50));
				}
				return null;
			}, oldDm)
		);
		const start = Date.now();
		await dm.page.reload();
		const back = await Promise.all(waits);
		report.dmReloadMs = back.map((t) => (t == null ? null : t - start));
		await dm.page.waitForFunction(() => !!window.__qnActionService, null, { timeout: 30000 });
		await dm.eval((qn) => (window.__qnCtx = qn.ctx));
		// Confirm the session works again end to end.
		const [after] = await rollLatency(p1, [dm], characters[0]);
		report.actionAfterDmReloadMs = after;
	}

	// 8. Claimed characters: the DM relays all three claims, and a player who
	//    closes their tab frees theirs.
	const claimed = () => dm.eval((qn) => (qn.ctx.User.ClaimedCharacters ?? []).length);
	await dm.page.waitForFunction(() => (window.__qnCtx.User.ClaimedCharacters ?? []).length === 3, null, { timeout: 20000 }).catch(() => {});
	report.claimedWithAll = await claimed();
	const leaveStart = Date.now();
	await p3.page.close();
	await dm.page.waitForFunction(() => (window.__qnCtx.User.ClaimedCharacters ?? []).length === 2, null, { timeout: 30000, polling: 50 }).catch(() => {});
	report.claimedAfterLeave = await claimed();
	report.claimReleaseMs = Date.now() - leaveStart;
	kit.players.splice(kit.players.indexOf(p3), 1);

	report.consoleErrors =Object.fromEntries(kit.peers().map((p) => [p.name, p.logs.filter((l) => / (error|pageerror):/.test(l)).length]));

	await mkdir(OUT_DIR, { recursive: true });
	const file = path.join(OUT_DIR, `net-bench-${label}.json`);
	await writeFile(file, JSON.stringify(report, null, 2));
	console.log(JSON.stringify(report, null, 2));
	assert.ok(!report.dmReloadMs.includes(null), "a player never reconnected after the DM reloaded");
	assert.ok(report.actionAfterDmReloadMs != null, "actions broken after DM reload");
	assert.equal(report.claimedWithAll, 3, "DM should relay all three claimed characters");
	assert.equal(report.claimedAfterLeave, 2, "a departed player's character should be released");
}
