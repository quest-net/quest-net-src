// Stress tools for multiplayer movement: a per-peer jump recorder, a network
// impairment shim, input drivers (walkers + click movers) and a DM chaos loop.
// Used by scenarios/stress.mjs. See test-kit/README.md ("Stress testing").

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (xs) => xs[Math.floor(Math.random() * xs.length)];

// --- Jump recorder ----------------------------------------------------------
// Runs a rAF loop in the page that watches where every token (and the camera)
// is drawn, via the dev-only window.__qnActorLayer / __qnMapController hooks.
// Flags:
//   snap      a token covers > SNAP world units (1 unit = 1 tile) in one frame
//   backtrack a token moves out and then comes back > BACK units within 1s
//   cameraSnap the camera jumps > SNAP in one frame (ignored 1.5s after a mode change)
// Both thresholds sit above the largest legit settle (a token easing from its
// sub-tile walking position to its tile centre is at most ~0.71).
// Alongside, it logs a timeline (poses in, state updates, commits, sends, mode
// changes, long frames) so each jump can be explained.
export async function installRecorder(peer) {
	await peer.eval((qn) => {
		if (window.__qnRec) return;
		const SNAP = 0.75;
		const BACK = 0.75;
		const RETURN_SPEED = 8; // walking is 4.2 units/s (ACTOR_CONTROLS.MOVE_UNITS_PER_SECOND)
		const BODY_SNAP = 0.3;
		const now = () => performance.timeOrigin + performance.now();
		const rec = { events: [], jumps: [], frames: 0, longFrames: 0, start: now(), names: {} };
		window.__qnRec = rec;
		const ev = (type, data) => {
			rec.events.push({ t: now(), type, ...data });
			if (rec.events.length > 60000) rec.events.splice(0, 20000);
		};
		rec.ev = ev;

		const svc = qn.actions;
		const aps = svc.actorPoseService;
		const handlePose = aps.handleActorPose.bind(aps);
		aps.handleActorPose = (data, peerId) => {
			ev("poseIn", { actor: data?.actorId });
			handlePose(data, peerId);
		};
		const ss = svc.stateSync;
		for (const [fn, type] of [["handleFullUpdate", "full"], ["handleDeltaUpdate", "delta"]]) {
			const orig = ss[fn].bind(ss);
			ss[fn] = (u) => {
				ev("state", { kind: type });
				return orig(u);
			};
		}
		const exec = svc.executeAndWait.bind(svc);
		svc.executeAndWait = (key, params) => {
			const p = params?.position;
			ev("send", { key, actor: params?.actorId, to: p ? `${p.x},${p.y},${p.h}` : undefined });
			return exec(key, params);
		};

		const prevTok = new Map();
		const trails = new Map();
		const cooldown = new Map();
		const prevCommit = new Map();
		let prevLive = new Set();
		let prevCam = null;
		let lastMode;
		let modeAt = 0;
		let lastT = performance.now();
		let namesAt = 0;

		const jump = (kind, key, cls, data) => {
			const t = now();
			if ((cooldown.get(key + kind) ?? 0) > t) return;
			cooldown.set(key + kind, t + 1000);
			rec.jumps.push({ t, kind, key, cls, ...data });
		};

		// Per-frame motion check for one tracked thing (a token, or the body).
		// `owner` changing (token rebuilt, actor switched) restarts tracking.
		let dt = 0.006;
		let t = now();
		const motion = (key, owner, cls, p, snapLimit, snapSpeed, prefix) => {
			const kind = (k) => (prefix ? prefix + k[0].toUpperCase() + k.slice(1) : k);
			const prev = prevTok.get(key);
			if (!prev || prev.owner !== owner) {
				prevTok.set(key, { owner, x: p.x, z: p.z });
				trails.set(key, []);
				return;
			}
			const d = Math.hypot(p.x - prev.x, p.z - prev.z);
			if (d > snapLimit && d / dt > snapSpeed) {
				jump(kind("snap"), key, cls, { d: +d.toFixed(2), from: [+prev.x.toFixed(2), +prev.z.toFixed(2)], to: [+p.x.toFixed(2), +p.z.toFixed(2)] });
				trails.set(key, []);
			}
			prev.x = p.x;
			prev.z = p.z;

			const trail = trails.get(key);
			trail.push({ t, x: p.x, z: p.z, v: d / dt });
			while (trail.length && t - trail[0].t > 1000) trail.shift();
			const a = trail[0];
			let out = 0;
			let outAt = 0;
			trail.forEach((q, i) => {
				const r = Math.hypot(q.x - a.x, q.z - a.z);
				if (r > out) (out = r), (outAt = i);
			});
			const back = out - Math.hypot(p.x - a.x, p.z - a.z);
			// Well above walking speed, so a walker legitimately
			// turning back or sliding along a wall doesn't count.
			const returnSpeed = Math.max(0, ...trail.slice(outAt + 1).map((q) => q.v));
			if (back > BACK && returnSpeed > RETURN_SPEED) {
				jump(kind("backtrack"), key, cls, { out: +out.toFixed(2), back: +back.toFixed(2), speed: +returnSpeed.toFixed(1), at: [+p.x.toFixed(2), +p.z.toFixed(2)] });
				trail.length = 0;
			}
		};

		const frame = (tp) => {
			dt = Math.max(0.001, (tp - lastT) / 1000);
			lastT = tp;
			rec.frames++;
			if (dt > 0.1) {
				rec.longFrames++;
				ev("longFrame", { ms: Math.round(dt * 1000) });
			}
			t = now();
			const layer = window.__qnActorLayer;
			const ctl = window.__qnMapController;
			const camp = qn.ctx.ActiveCampaign;

			const mode = ctl?.cameraMode;
			if (mode !== lastMode) {
				ev("mode", { mode });
				lastMode = mode;
				modeAt = t;
			}

			if (camp) {
				const actors = [...camp.GameState.Characters, ...camp.GameState.Entities];
				if (t > namesAt) {
					for (const a of actors) rec.names[a.Id] = a.Name;
					namesAt = t + 500;
				}
				const seen = new Set();
				for (const a of actors) {
					const p = a.Position;
					const k = `${p.terrainId.slice(0, 4)}|${p.x},${p.y},${p.h}`;
					seen.add(a.Id);
					const old = prevCommit.get(a.Id);
					if (old !== k) {
						ev(old === undefined ? "appear" : "commit", { actor: a.Id, from: old, to: k });
						prevCommit.set(a.Id, k);
					}
				}
				for (const id of Array.from(prevCommit.keys())) {
					if (!seen.has(id)) {
						ev("gone", { actor: id });
						prevCommit.delete(id);
					}
				}
			}

			if (layer) {
				const live = new Set(layer.liveTargets.keys());
				for (const k of live) if (!prevLive.has(k)) ev("liveStart", { key: k });
				for (const k of prevLive) if (!live.has(k)) ev("liveEnd", { key: k });
				prevLive = live;

				for (const [key, g] of layer.groups) {
					const cls = live.has(key) ? "live" : layer.animations.has(key) ? "anim" : "other";
					motion(key, g, cls, g.position, SNAP, 40, "");
				}
			}

			if (ctl) {
				// The walker's own capsule (first person / follow). It moves at walking
				// speed, so a one-frame jump over BODY_SNAP is a reset, not movement.
				// Skipped across slow frames: this rAF and the app's can then sample
				// the body two app-steps apart, which reads as a jump.
				if (ctl.hasControlledActorPose && t - modeAt > 1500 && dt < 0.05) {
					motion("body", ctl, mode, ctl.controlledActorBodyPosition, BODY_SNAP, 15, "body");
				} else {
					prevTok.delete("body");
				}

				const c = ctl.camera.position;
				if (prevCam && prevCam.cam === ctl.camera && t - modeAt > 1500) {
					const d = Math.hypot(c.x - prevCam.x, c.y - prevCam.y, c.z - prevCam.z);
					if (d > SNAP && d / dt > 40) jump("cameraSnap", "camera", mode, { d: +d.toFixed(2) });
				}
				prevCam = { cam: ctl.camera, x: c.x, y: c.y, z: c.z };
			}
			requestAnimationFrame(frame);
		};
		requestAnimationFrame(frame);
	});
}

/** Collects the recorder's results, each jump with the events leading up to it. */
export async function recorderReport(peer, { windowMs = 1500, maxJumps = 60 } = {}) {
	const r = await peer.eval((qn, { windowMs, maxJumps }) => {
		const rec = window.__qnRec;
		if (!rec) return null;
		const end = performance.timeOrigin + performance.now();
		const name = (id) => rec.names[id] ?? id?.slice(0, 6);
		const keyName = (key) => (key.includes(":") ? name(key.split(":")[1]) : key);
		const jumps = rec.jumps.slice(0, maxJumps).map((j) => {
			const id = j.key.split(":")[1];
			const win = rec.events.filter((e) => e.t <= j.t + 50 && e.t >= j.t - windowMs);
			const poses = rec.events.filter((e) => e.type === "poseIn" && e.actor === id && e.t <= j.t);
			const lastPose = poses[poses.length - 1];
			const other = win
				.filter((e) => e.type !== "poseIn")
				.slice(-14)
				.map((e) => {
					const who =
						(e.type === "send" ? ` ${e.key}` : "") +
						(e.actor ? ` ${name(e.actor)}` : e.key && e.type !== "send" ? ` ${keyName(e.key)}` : "");
					const extra = e.kind ?? e.mode ?? e.ms ?? (e.to ? `${e.from ?? ""}->${e.to}` : "") ?? "";
					return `${Math.round(e.t - j.t)}ms ${e.type}${who} ${extra}`.trim();
				});
			return {
				t: Math.round(j.t),
				kind: j.kind,
				who: keyName(j.key),
				cls: j.cls,
				d: j.d,
				out: j.out,
				back: j.back,
				speed: j.speed,
				from: j.from,
				to: j.to,
				lastPoseGapMs: lastPose ? Math.round(j.t - lastPose.t) : null,
				posesInWindow: win.filter((e) => e.type === "poseIn" && e.actor === id).length,
				context: other,
			};
		});
		const counts = {};
		for (const j of rec.jumps) counts[j.kind] = (counts[j.kind] ?? 0) + 1;
		const seconds = (end - rec.start) / 1000;
		return {
			seconds: +seconds.toFixed(1),
			fps: +(rec.frames / seconds).toFixed(0),
			longFrames: rec.longFrames,
			states: rec.events.filter((e) => e.type === "state").length,
			counts,
			commits: rec.events
				.filter((e) => e.type === "commit")
				.map((e) => ({ t: Math.round(e.t), who: name(e.actor), from: e.from, to: e.to })),
			jumps,
		};
	}, { windowMs, maxJumps });
	return r && { peer: peer.name, ...r };
}

// --- Network impairment -----------------------------------------------------
// Delays this peer's traffic in both directions: live poses in/out, state
// sync in (players) / out (DM), action requests out (players) / in (DM).
// Trystero channels are ordered and reliable, so delivery stays in order and a
// "stall" holds everything (head-of-line blocking) rather than dropping it.
export async function impair(peer, { latency = 0, jitter = 0, stallEveryMs = 0, stallMs = 0 } = {}) {
	await peer.eval((qn, o) => {
		const svc = qn.actions;
		let stallUntil = 0;
		if (o.stallEveryMs) {
			const loop = () => {
				stallUntil = performance.now() + o.stallMs;
				window.__qnRec?.ev("stall", { ms: o.stallMs });
				setTimeout(loop, o.stallEveryMs * (0.5 + Math.random()));
			};
			setTimeout(loop, o.stallEveryMs * Math.random());
		}
		// One FIFO queue per lane drained by one timer: separate timers per message
		// can fire out of order (ms rounding) when a stall releases a burst.
		const lane = (fn) => {
			const queue = [];
			let last = 0;
			let timer = null;
			const pump = () => {
				timer = null;
				const n = performance.now();
				while (queue.length && queue[0].at <= n) fn(...queue.shift().args);
				if (queue.length) timer = setTimeout(pump, queue[0].at - n);
			};
			return (...args) => {
				const n = performance.now();
				const at = Math.max(n + o.latency + Math.random() * o.jitter, stallUntil, last);
				last = at;
				queue.push({ at, args });
				if (!timer) timer = setTimeout(pump, at - n);
			};
		};
		const aps = svc.actorPoseService;
		aps.handleActorPose = lane(aps.handleActorPose.bind(aps));
		if (aps.sendActorPosePacket) aps.sendActorPosePacket = lane(aps.sendActorPosePacket);
		const ss = svc.stateSync;
		// Delay before StateSync's in-order receive queue, like the wire would.
		if (ss.receive) ss.receive = lane(ss.receive.bind(ss));
		else ss.handleIncomingStateTransport = lane(ss.handleIncomingStateTransport.bind(ss));
		if (ss.sendState) ss.sendState = lane(ss.sendState);
		if (svc.sendActionRequest) svc.sendActionRequest = lane(svc.sendActionRequest);
		if (qn.ctx.User.Role === "dm") svc.handlePlayerRequest = lane(svc.handlePlayerRequest.bind(svc));
	}, { latency, jitter, stallEveryMs, stallMs });
}

// --- Input drivers ----------------------------------------------------------

export async function setCameraMode(peer, mode) {
	await peer.eval((qn, mode) => (qn.ctx.AppSettings.cameraMode = mode), mode);
}

async function canvasCenter(peer) {
	return peer.page.evaluate(() => {
		const c = [...document.querySelectorAll("canvas")].sort((a, b) => b.width * b.height - a.width * a.height)[0];
		const r = c.getBoundingClientRect();
		return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
	});
}

/**
 * First person / follow walker: holds the right button and W, turns 25-75
 * degrees every 1-2.5s (never 180, so turning can't look like a backtrack),
 * and stops for 0.5-1.5s now and then so the body settles and commits a tile.
 * Returns a stop function.
 */
export async function startWalker(peer, mode, log) {
	await setCameraMode(peer, mode);
	await sleep(2500);
	const c = await canvasCenter(peer);
	await peer.page.mouse.move(c.x, c.y);
	await peer.page.mouse.down({ button: "right" });
	await sleep(300);
	let running = true;
	const loop = (async () => {
		while (running) {
			await peer.page.keyboard.down("KeyW");
			const walkFor = rand(2000, 5000);
			const until = Date.now() + walkFor;
			while (running && Date.now() < until) {
				await sleep(rand(1000, 2500));
				const px = Math.round(rand(200, 600)) * (Math.random() < 0.5 ? -1 : 1);
				// Spread over ~0.3s of frames like a real mouse; one big delta would
				// swing the follow camera several units in one frame.
				await peer.page
					.evaluate(
						(px) =>
							new Promise((done) => {
								const step = Math.sign(px) * 12;
								let left = Math.abs(px);
								const tick = () => {
									window.dispatchEvent(new MouseEvent("mousemove", { movementX: step }));
									left -= 12;
									left > 0 ? requestAnimationFrame(tick) : done();
								};
								tick();
							}),
						px
					)
					.catch(() => {});
			}
			await peer.page.keyboard.up("KeyW");
			log?.(peer.name, "pause");
			await sleep(rand(500, 1500));
		}
	})();
	return async () => {
		running = false;
		await loop.catch(() => {});
		await peer.page.keyboard.up("KeyW").catch(() => {});
		await peer.page.mouse.up({ button: "right" }).catch(() => {});
	};
}

/** Picks a random standable tile within `radius` of (x, y) on a terrain, in-page. */
const randomTileInPage = async (qn, { terrainId, x, y, radius }) => {
	const { getVoxelTerrainIndex } = await qn.import("utils/terrain/data/VoxelTerrainIndex.ts");
	// A terrain nobody here is looking at may still be a stub in OPFS.
	const { TerrainStorageService } = await qn.import("services/TerrainStorageService.ts");
	const terrain = await TerrainStorageService.hydrateTerrain(qn.campaign, terrainId);
	if (!terrain) return null;
	const index = getVoxelTerrainIndex(terrain);
	const taken = new Set(
		[...qn.campaign.GameState.Characters, ...qn.campaign.GameState.Entities]
			.filter((a) => a.Position.terrainId === terrainId)
			.map((a) => `${a.Position.x},${a.Position.y}`)
	);
	const options = [];
	for (const [k, hs] of index.allSurfaces) {
		const [tx, ty] = k.split(",").map(Number);
		if (x !== undefined && Math.max(Math.abs(tx - x), Math.abs(ty - y)) > radius) continue;
		if (taken.has(`${tx},${ty}`) || !hs?.length) continue;
		options.push({ terrainId, x: tx, y: ty, h: hs[0] });
	}
	return options.length ? options[Math.floor(Math.random() * options.length)] : null;
};

/**
 * Click-to-move player (ortho / perspective): every 2-3.5s moves its character
 * 1-3 tiles, dispatching the same actor:move the map click does.
 */
export async function startClicker(peer, mode, log) {
	await setCameraMode(peer, mode);
	await sleep(1500);
	let running = true;
	const loop = (async () => {
		while (running) {
			await sleep(rand(2000, 3500));
			if (!running) break;
			const moved = await peer
				.eval(
					async (qn, src) => {
						const randomTile = new Function(`return (${src})`)();
						const id = qn.ctx.User.SelectedCharacters.testkit;
						const a = qn.campaign.GameState.Characters.find((c) => c.Id === id);
						if (!a) return null;
						const to = await randomTile(qn, { ...a.Position, radius: 3 });
						if (to) qn.actions.execute("actor:move", { actorId: id, position: to });
						return to;
					},
					randomTileInPage.toString()
				)
				.catch(() => null);
			if (moved) log?.(peer.name, `click-move ${moved.x},${moved.y}`);
		}
	})();
	return async () => {
		running = false;
		await loop.catch(() => {});
	};
}

/** DM moves a character to a random tile on another terrain (by name). */
export async function moveToTerrain(dm, actorName, terrainName) {
	return dm.eval(
		async (qn, { actorName, terrainName, src }) => {
			const randomTile = new Function(`return (${src})`)();
			const t = qn.campaign.VoxelTerrains.find((t) => t.Name === terrainName);
			const a = [...qn.campaign.GameState.Characters, ...qn.campaign.GameState.Entities].find((a) => a.Name === actorName);
			const to = await randomTile(qn, { terrainId: t.Id });
			if (!to) throw new Error(`no free tile on ${terrainName}`);
			await qn.actions.executeAndWait("actor:move", { actorId: a.Id, position: to });
			return to;
		},
		{ actorName, terrainName, src: randomTileInPage.toString() }
	);
}

// --- DM chaos loop ----------------------------------------------------------
// Every 0.8-2s the DM does one random thing that changes campaign state while
// players move: spawn/despawn goblins on either terrain, move NPCs (sometimes
// across terrains), give statuses, start combat / advance rounds (fires the
// Poisoned and Cursed Ring scripts) / end combat, cast Raise Dead (a script
// spawn), roll dice. Returns a stop function.
export async function startChaos(dm, log) {
	let running = true;
	const loop = (async () => {
		while (running) {
			await sleep(rand(800, 2000));
			if (!running) break;
			const what = pick(["spawn", "spawn", "npcMove", "npcMove", "npcHop", "status", "combat", "combat", "raiseDead", "roll"]);
			const result = await dm
				.eval(
					async (qn, { what, src }) => {
						const randomTile = new Function(`return (${src})`)();
						const run = (k, p) => qn.actions.executeAndWait(k, p);
						const c = qn.campaign;
						const gs = c.GameState;
						const terrains = c.VoxelTerrains.filter((t) => t.Name === "Forest Clearing" || t.Name === "Old Cellar");
						const npcs = gs.Entities.filter((e) => !e.OwnerId && !e.Hidden);
						switch (what) {
							case "spawn": {
								const old = gs.Entities.filter((e) => (e.Name.startsWith("Goblin") || e.Name.startsWith("Skeleton")) && !e.Hidden);
								if (old.length > 8) {
									await run("actor:despawn", { actorId: old[0].Id });
									return `despawn ${old[0].Name}`;
								}
								const tpl = c.EntityTemplates.find((e) => e.Name.startsWith("Goblin"));
								const t = terrains[Math.floor(Math.random() * terrains.length)];
								const to = await randomTile(qn, { terrainId: t.Id });
								if (!to) return `no free tile on ${t.Name}`;
								await run("actor:spawn", { actorId: tpl.Id, position: to });
								return `spawn goblin on ${t.Name} ${to.x},${to.y}`;
							}
							case "npcMove": {
								const e = npcs[Math.floor(Math.random() * npcs.length)];
								if (!e) return null;
								const to = await randomTile(qn, { ...e.Position, radius: 3 });
								if (!to) return null;
								await run("actor:move", { actorId: e.Id, position: to });
								return `move ${e.Name} -> ${to.x},${to.y}`;
							}
							case "npcHop": {
								const e = npcs[Math.floor(Math.random() * npcs.length)];
								if (!e) return null;
								const t = terrains.find((t) => t.Id !== e.Position.terrainId) ?? terrains[0];
								const to = await randomTile(qn, { terrainId: t.Id });
								if (!to) return `no free tile on ${t.Name}`;
								await run("actor:move", { actorId: e.Id, position: to });
								return `hop ${e.Name} -> ${t.Name}`;
							}
							case "status": {
								const actors = [...gs.Characters, ...npcs];
								const a = actors[Math.floor(Math.random() * actors.length)];
								const s = c.StatusTemplates[Math.floor(Math.random() * c.StatusTemplates.length)];
								await run("status:give", { statusIds: [s.Id], actorIds: [a.Id], count: 1 });
								return `status ${s.Name} -> ${a.Name}`;
							}
							case "combat": {
								if (!gs.CombatState?.isActive) {
									await run("combat:start", { startingSide: "party" });
									return "combat start";
								}
								if (Math.random() < 0.2) {
									await run("combat:end", {});
									return "combat end";
								}
								await run("combat:incrementRound", {});
								return `round -> ${gs.CombatState.currentRound}`;
							}
							case "raiseDead": {
								const necro = gs.Characters.find((a) => a.Name === "Necromancer");
								const skill = c.SkillTemplates.find((s) => s.Name === "Raise Dead");
								if (!necro || !skill) return null;
								await run("skill:use", { actorId: necro.Id, skillId: skill.Id });
								return "raise dead";
							}
							case "roll": {
								const a = gs.Characters[0];
								await run("dice:roll", { actorId: a.Id, expr: "1d20", total: 7, breakdown: "[7]" });
								return "roll";
							}
						}
						return null;
					},
					{ what, src: randomTileInPage.toString() }
				)
				.catch((e) => `error ${what}: ${e.message.split("\n")[0]}`);
			if (result) log?.("DM", result);
		}
	})();
	return async () => {
		running = false;
		await loop.catch(() => {});
	};
}
