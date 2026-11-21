// Token texture resolution benchmark. Swaps the canvas resolution actor tokens
// are rasterized at (512 / 1024 / 2048, outside performance mode) by
// rewriting actorTokenConstants.ts as Vite serves it, so the app is untouched.
// Every token source image is replaced by a 2048px cutout PNG (the upload cap),
// and ~24 goblins are spawned, so Forest Clearing holds a big battle.
// Per config it measures: token load (main-thread long tasks, worst frame),
// steady frame time from an overview orbit and a close-up orbit, and texture
// memory.
//   node test-kit/run.mjs test-kit/scenarios/token-res-bench.mjs
// Runs headed on the real GPU with vsync off; report in test-kit/out/token-res-bench.json.

import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

export const options = {
	players: 0,
	headed: true, // headless WebGL is software-rendered
	chromeArgs: [
		"--disable-gpu-vsync",
		"--disable-frame-rate-limit",
		"--disable-renderer-backgrounding",
		"--disable-backgrounding-occluded-windows",
		"--enable-precise-memory-info",
	],
};

const CONFIGS = [
	{ name: "512 all", size: 512 },
	{ name: "1024 all (current)", size: 1024 },
	{ name: "2048 all", size: 2048 },
];
const ROUNDS = 2; // second round runs in reverse order to cancel drift
const GOBLINS = 24;
const OVERVIEW_MS = 8000;
const CLOSEUP_MS = 8000;

const OUT = path.resolve("test-kit/out/token-res-bench.json");

// Installed before every load: frame timestamps, long tasks, token count timeline.
function benchProbe() {
	const b = (window.__bench = { frames: [], longTasks: [], groups: [] });
	try {
		new PerformanceObserver((list) => {
			for (const e of list.getEntries()) b.longTasks.push([e.startTime, e.duration]);
		}).observe({ type: "longtask", buffered: true });
	} catch {}
	let lastSize = -1;
	const loop = (t) => {
		b.frames.push(t);
		const size = window.__qnActorLayer?.groups?.size ?? -1;
		if (size !== lastSize) {
			b.groups.push([t, size]);
			lastSize = size;
		}
		requestAnimationFrame(loop);
	};
	requestAnimationFrame(loop);
}

function rewriteConstants(src, { size }) {
	const line = /HIGH_RES_SIZE:\s*\d+/;
	if (!line.test(src)) {
		throw new Error("actorTokenConstants.ts no longer matches the benchmark's rewrite");
	}
	return src.replace(line, `HIGH_RES_SIZE: ${size}`);
}

const stats = (dts) => {
	const s = [...dts].sort((a, b) => a - b);
	const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
	const total = dts.reduce((a, b) => a + b, 0);
	return {
		frames: dts.length,
		fps: +(dts.length / (total / 1000)).toFixed(1),
		meanMs: +(total / dts.length).toFixed(2),
		p50Ms: +q(0.5).toFixed(2),
		p95Ms: +q(0.95).toFixed(2),
		p99Ms: +q(0.99).toFixed(2),
		maxMs: +s[s.length - 1].toFixed(1),
	};
};

// Orbits the perspective camera for `ms` (after 1s warm-up) and returns frame
// intervals; the camera is left at the end pose for a screenshot. Overview
// circles the whole clearing; close-up circles the token nearest the map
// centre (a goblin in the spawned crowd) from 1.8 tiles away.
function orbit(dm, ms, kind) {
	return dm.eval(
		async (qn, { ms, kind }) => {
			const c = window.__qnMapController;
			const rig = c.rig;
			if (c.cameraMode !== "perspective") c.setCameraMode("perspective", true);
			const groups = [...window.__qnActorLayer.groups.values()];
			const near = groups.reduce((a, g) => (g.position.length() < a.position.length() ? g : a));
			const target = kind === "overview" ? near.position.clone().set(0, 0, 0) : near.position.clone();
			target.y += kind === "overview" ? 0 : 0.5; // look at the standee, not its feet
			const [radius, height] = kind === "overview" ? [20, 14] : [1.8, 0.9];
			const dts = [];
			let last = performance.now();
			const start = last;
			while (last - start < ms + 1000) {
				const a = ((last - start) / 8000) * Math.PI * 2;
				rig.controls.target.copy(target);
				rig.perspectiveCamera.position.set(
					target.x + radius * Math.sin(a),
					target.y + height,
					target.z + radius * Math.cos(a)
				);
				rig.perspectiveCamera.lookAt(target);
				rig.controls.update();
				await new Promise((r) => requestAnimationFrame(r));
				const now = performance.now();
				if (now - start > 1000) dts.push(now - last);
				last = now;
			}
			return dts;
		},
		{ ms, kind }
	);
}

export default async function tokenResBench(kit) {
	const { dm } = kit;
	const page = dm.page;

	// --- Setup: 2048px source images + a crowd of goblins (persisted in IDB). ---
	const setup = await dm.eval(async (qn, goblins) => {
		const { IndexedDBUtilities } = await qn.import("utils/IndexedDBUtilities.ts");
		const c = qn.campaign;
		const tokenImages = c.Images.filter((i) => i.Cutout);
		for (const [n, img] of tokenImages.entries()) {
			const S = 2048;
			const cv = new OffscreenCanvas(S, S);
			const g = cv.getContext("2d");
			// A figure silhouette with fine detail, transparent margins (cutout).
			g.beginPath();
			g.ellipse(S / 2, S * 0.28, S * 0.16, S * 0.18, 0, 0, Math.PI * 2);
			g.moveTo(S * 0.22, S * 0.95);
			g.quadraticCurveTo(S * 0.5, S * 0.25, S * 0.78, S * 0.95);
			g.closePath();
			g.clip();
			const grad = g.createLinearGradient(0, 0, S, S);
			grad.addColorStop(0, `hsl(${(n * 37) % 360} 70% 55%)`);
			grad.addColorStop(1, `hsl(${(n * 37 + 120) % 360} 60% 30%)`);
			g.fillStyle = grad;
			g.fillRect(0, 0, S, S);
			const px = g.getImageData(0, 0, S, S);
			for (let i = 0; i < px.data.length; i += 4) {
				const v = (Math.random() - 0.5) * 60;
				px.data[i] += v;
				px.data[i + 1] += v;
				px.data[i + 2] += v;
			}
			g.putImageData(px, 0, 0);
			const blob = await cv.convertToBlob({ type: "image/png" });
			await IndexedDBUtilities.save(img.Id, blob);
			img.Width = S;
			img.Height = S;
		}

		const { getVoxelTerrainIndex } = await qn.import("utils/terrain/data/VoxelTerrainIndex.ts");
		const { TerrainStorageService } = await qn.import("services/TerrainStorageService.ts");
		const forest = c.VoxelTerrains.find((t) => t.Name === "Forest Clearing");
		const terrain = await TerrainStorageService.hydrateTerrain(c, forest.Id);
		const index = getVoxelTerrainIndex(terrain);
		const taken = new Set(
			[...c.GameState.Characters, ...c.GameState.Entities]
				.filter((a) => a.Position.terrainId === forest.Id)
				.map((a) => `${a.Position.x},${a.Position.y}`)
		);
		const tiles = [...index.allSurfaces]
			.filter(([k, hs]) => hs?.length && !taken.has(k))
			.map(([k, hs]) => {
				const [x, y] = k.split(",").map(Number);
				return { terrainId: forest.Id, x, y, h: hs[0] };
			})
			// Deterministic: a ring of tiles around the map centre.
			.filter((t) => (t.x + t.y) % 2 === 0)
			.sort((a, b) => Math.hypot(a.x - 12, a.y - 12) - Math.hypot(b.x - 12, b.y - 12));
		const tpl = c.EntityTemplates.find((e) => e.Name.startsWith("Goblin"));
		for (const pos of tiles.slice(0, goblins)) {
			await qn.actions.executeAndWait("actor:spawn", { actorId: tpl.Id, position: pos });
		}
		const onForest = [...c.GameState.Characters, ...c.GameState.Entities].filter(
			(a) => a.Position.terrainId === forest.Id
		);
		return {
			forestId: forest.Id,
			tokenImages: tokenImages.length,
			characters: onForest.filter((a) => c.GameState.Characters.includes(a)).length,
			entities: onForest.filter((a) => c.GameState.Entities.includes(a)).length,
			gpu: (() => {
				const gl = document.createElement("canvas").getContext("webgl2");
				const ext = gl.getExtension("WEBGL_debug_renderer_info");
				return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
			})(),
			dpr: window.devicePixelRatio,
			perfMode: qn.ctx.AppSettings.performanceMode === "true",
		};
	}, GOBLINS);
	console.log("setup:", setup);
	// Let the debounced campaign persist land before the first reload.
	await new Promise((r) => setTimeout(r, 3000));

	await page.context().addInitScript(benchProbe);
	let current = null;
	await page.route("**/src/components/Map/Actors3D/actorTokenConstants.ts*", async (route) => {
		const res = await route.fetch();
		const body = await res.text();
		await route.fulfill({ response: res, body: current ? rewriteConstants(body, current) : body });
	});

	const order = [];
	for (let r = 0; r < ROUNDS; r++) order.push(...(r % 2 ? [...CONFIGS].reverse() : CONFIGS));

	const runs = [];
	for (const cfg of order) {
		current = cfg;
		await page.reload();
		await page.waitForFunction(() => !!window.__qnActionService && !!window.__qnMapController, null, {
			timeout: 60000,
		});
		const expected = setup.characters + setup.entities;
		await page.waitForFunction((n) => (window.__qnActorLayer?.groups?.size ?? 0) >= n, expected, {
			timeout: 120000,
			polling: 100,
		});
		await new Promise((r) => setTimeout(r, 2500)); // uploads + settle

		const run = await dm.eval(
			async () => {
				const b = window.__bench;
				const groups = [...window.__qnActorLayer.groups.values()];

				// Token load window: first token appears -> last token appears (+1s for uploads).
				const firstT = b.groups.find(([, s]) => s > 0)[0];
				const lastT = b.groups[b.groups.length - 1][0];
				const lo = firstT - 500, hi = lastT + 1000;
				const lt = b.longTasks.filter(([s]) => s >= lo && s <= hi);
				const gaps = [];
				for (let i = 1; i < b.frames.length; i++) {
					if (b.frames[i] >= lo && b.frames[i] <= hi) gaps.push(b.frames[i] - b.frames[i - 1]);
				}

				// Texture memory, from the token standees actually in the scene.
				const tex = new Set();
				for (const g of groups) g.traverse((o) => o.material?.map && tex.add(o.material.map));
				let gpuBytes = 0, canvasBytes = 0;
				const sizes = {};
				for (const t of tex) {
					const w = t.image?.width ?? 0, h = t.image?.height ?? 0;
					if (w <= 128) continue; // the shared blob-shadow texture
					sizes[w] = (sizes[w] ?? 0) + 1;
					canvasBytes += w * h * 4; // the source canvas stays referenced by the texture
					gpuBytes += w * h * 4 * (t.generateMipmaps ? 4 / 3 : 1);
				}

				return {
					tokens: groups.length,
					textureSizes: sizes,
					gpuMB: +(gpuBytes / 2 ** 20).toFixed(1),
					canvasMB: +(canvasBytes / 2 ** 20).toFixed(1),
					jsHeapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 2 ** 20).toFixed(1) : null,
					load: {
						allTokensAtMs: Math.round(lastT),
						spanMs: Math.round(lastT - firstT),
						longTaskCount: lt.length,
						longTaskTotalMs: Math.round(lt.reduce((a, [, d]) => a + d, 0)),
						longTaskMaxMs: Math.round(Math.max(0, ...lt.map(([, d]) => d))),
						worstFrameMs: Math.round(Math.max(0, ...gaps)),
					},
				};
			},
		);
		const tag = cfg.name.split(" ")[0];
		run.overview = stats(await orbit(dm, OVERVIEW_MS, "overview"));
		await dm.shot(`token-res-${tag}-overview`);
		run.closeup = stats(await orbit(dm, CLOSEUP_MS, "closeup"));
		await dm.shot(`token-res-${tag}-closeup`);
		console.log(cfg.name, JSON.stringify({ ...run.load, gpuMB: run.gpuMB, sizes: run.textureSizes, overviewFps: run.overview.fps, closeupFps: run.closeup.fps }));
		runs.push({ config: cfg.name, ...run });
	}


	// Average the rounds per config.
	const avg = (xs) => +(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1);
	const summary = CONFIGS.map((cfg) => {
		const rs = runs.filter((r) => r.config === cfg.name);
		return {
			config: cfg.name,
			tokens: rs[0].tokens,
			textureSizes: rs[0].textureSizes,
			gpuMB: rs[0].gpuMB,
			canvasMB: rs[0].canvasMB,
			loadLongTaskMs: avg(rs.map((r) => r.load.longTaskTotalMs)),
			loadWorstFrameMs: avg(rs.map((r) => r.load.worstFrameMs)),
			loadSpanMs: avg(rs.map((r) => r.load.spanMs)),
			overviewFps: avg(rs.map((r) => r.overview.fps)),
			overviewP99Ms: avg(rs.map((r) => r.overview.p99Ms)),
			closeupFps: avg(rs.map((r) => r.closeup.fps)),
			closeupP99Ms: avg(rs.map((r) => r.closeup.p99Ms)),
		};
	});
	console.table(summary);
	
	await mkdir(path.dirname(OUT), { recursive: true });
	await writeFile(OUT, JSON.stringify({ setup, summary, runs }, null, 2));
	console.log("report:", OUT);
}
