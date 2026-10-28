// See-through terrain (hero occlusion) check, two parts:
//  1. Guard: the DM's selected actor only cuts the terrain it stands on. Viewing
//     another terrain must switch the cutout off.
//  2. Stress: rebuilds Forest Clearing as a lab (open ground, a walled pen, a
//     roofed room, a low slab, a 1-tile pit, a two-storey platform), stands the
//     selected actor in each, and sweeps ortho and perspective cameras over
//     azimuth, elevation, distance, zoom and an off-centre ortho framing.
//     For each view it casts the real view rays at 15 points on the token
//     through the voxels, with and without the cutout (the shader's CPU twin,
//     solid cone, no feather), and reports how much of the token stays hidden.
//     A few views also screenshot with the cutout on and off and report how much
//     of the picture it changes.
//   node test-kit/run.mjs test-kit/scenarios/see-through.mjs --players 0
// Report: test-kit/out/see-through.json. Shots: test-kit/out/see-through-*.png.

import assert from "node:assert/strict";
import fs from "node:fs";

export const options = { characters: [] };

// A view fails when the cutout leaves more than this share of the token hidden.
const MAX_HIDDEN_WITH_CUTOUT = 0.34;

const hero = (dm) => dm.eval(() => {
	const h = window.__qnHeroOcclusion;
	return h ? { enabled: h.enabled.value } : null;
});

async function guardOtherTerrain(dm) {
	const page = dm.page;
	await dm.page.waitForFunction(() => !!window.__qnHeroOcclusion, null, { timeout: 20000 });
	const ids = await dm.eval((qn) => {
		const byName = (n) => qn.campaign.VoxelTerrains.find((t) => t.Name === n).Id;
		return { campaign: qn.campaign.Id, forest: byName("Forest Clearing"), cellar: byName("Old Cellar") };
	});
	const view = (first, second) =>
		dm.eval((qn, { campaign, first, second }) => {
			qn.ctx.ViewedTerrains ??= {};
			qn.ctx.ViewedTerrains[campaign] = [first, second];
		}, { campaign: ids.campaign, first, second });

	await view(ids.forest, ids.cellar);
	await page.locator('button.btn-square[title="Overview"]').click();
	await page.getByRole("heading", { name: "Aria", exact: true }).first().click();
	await page.waitForTimeout(800);
	assert.equal((await hero(dm)).enabled, 1, "cutout on for the selected actor's own terrain");

	await view(ids.cellar, ids.forest);
	await page.waitForTimeout(800);
	assert.equal((await hero(dm)).enabled, 0, "cutout off while viewing a terrain the selected actor is not on");

	// Back again: the selection survived, so the 0 above came from the terrain check.
	await view(ids.forest, ids.cellar);
	await page.waitForTimeout(800);
	assert.equal((await hero(dm)).enabled, 1, "cutout back on when returning to the actor's terrain");
}

// Builds the lab and returns the structures (actor tile + height per structure).
function buildLab(dm) {
	return dm.eval(async (qn) => {
		const { encodeVoxels } = await qn.import("utils/terrain/data/VoxelDataUtils.ts");
		const terrain = qn.campaign.VoxelTerrains.find((t) => t.Name === "Forest Clearing");
		const res = terrain.Resolution ?? 1;
		const W = terrain.Width, L = terrain.Length;
		if (W < 24 || L < 24) throw new Error(`lab needs 24x24, Forest Clearing is ${W}x${L}`);
		const STONE = 240, WOOD = 244, DIRT = 30;
		const voxels = new Map();
		// Tile/height box, inclusive tiles, heights [h0, h1) in tactical units.
		const box = (x0, x1, z0, z1, h0, h1, color, keep = () => true) => {
			for (let tx = x0; tx <= x1; tx++)
				for (let tz = z0; tz <= z1; tz++) {
					if (!keep(tx, tz)) continue;
					for (let vy = h0 * res; vy < h1 * res; vy++)
						for (let i = 0; i < res; i++)
							for (let k = 0; k < res; k++) {
								const x = tx * res + i, z = tz * res + k;
								voxels.set(`${x},${vy},${z}`, { x, y: vy, z, color });
							}
				}
		};
		const GROUND = 2;
		const ring = (cx, cz, r) => (tx, tz) => Math.max(Math.abs(tx - cx), Math.abs(tz - cz)) === r;
		box(0, W - 1, 0, L - 1, 0, GROUND, DIRT);
		// Pen: 3-high walls 2 tiles out, open top.
		box(3, 7, 3, 7, 2, 5, STONE, ring(5, 5, 2));
		// Room: same walls plus a roof.
		box(16, 20, 3, 7, 2, 5, STONE, ring(18, 5, 2));
		box(16, 20, 3, 7, 5, 6, WOOD);
		// Slab: 9x9, 2 thick, 2 above the ground, on corner pillars.
		box(1, 9, 14, 22, 4, 6, STONE);
		for (const [x, z] of [[1, 14], [9, 14], [1, 22], [9, 22]]) box(x, x, z, z, 2, 4, STONE);
		// Pit: 5x5 plateau 3 high with a 1-tile hole.
		box(10, 14, 10, 14, 2, 5, STONE, (x, z) => !(x === 12 && z === 12));
		// Two-storey: floor at height 6 on pillars, roof at 9-10.
		box(16, 20, 16, 20, 5, 6, WOOD);
		box(16, 20, 16, 20, 9, 10, WOOD);
		for (const [x, z] of [[16, 16], [20, 16], [16, 20], [20, 20]]) box(x, x, z, z, 2, 9, STONE);

		await qn.actions.executeAndWait("terrain:edit", {
			terrainId: terrain.Id,
			updates: { Voxels: encodeVoxels(voxels.values()), Surroundings: undefined },
		});

		// Occupancy for the ray tests below, kept on the page between evals.
		let maxY = 0;
		for (const v of voxels.values()) maxY = Math.max(maxY, v.y);
		const Wv = W * res, Lv = L * res, Hv = maxY + 1;
		const occ = new Uint8Array(Wv * Lv * Hv);
		for (const v of voxels.values()) occ[v.x + v.z * Wv + v.y * Wv * Lv] = 1;
		window.__seeThroughLab = { occ, res, W, L, Wv, Lv, Hv };

		return [
			{ name: "open", x: 12, y: 4, h: 2 },
			{ name: "pen", x: 5, y: 5, h: 2 },
			{ name: "room", x: 18, y: 5, h: 2 },
			{ name: "slab", x: 5, y: 18, h: 2 },
			{ name: "pit", x: 12, y: 12, h: 2 },
			{ name: "upstairs", x: 18, y: 18, h: 6, below: true },
		];
	});
}

// Moves Aria into the structure, then sweeps every camera. Runs in the page.
function sweep(dm, structure) {
	return dm.eval(async (qn, { structure }) => {
		const { isHeroOccludedPoint } = await qn.import("components/Map/Terrain/shaders/heroOcclusionShader.ts");
		const terrain = qn.campaign.VoxelTerrains.find((t) => t.Name === "Forest Clearing");
		const aria = qn.campaign.GameState.Characters.find((c) => c.Name === "Aria");
		await qn.actions.executeAndWait("actor:move", {
			actorId: aria.Id,
			position: { terrainId: terrain.Id, x: structure.x, y: structure.y, h: structure.h },
		});
		// Wait for the cutout driver to aim at the new tile before placing cameras.
		const wantX = structure.x - (terrain.Width - 1) / 2, wantZ = structure.y - (terrain.Length - 1) / 2;
		for (let i = 0; i < 100; i++) {
			const a = window.__qnHeroOcclusion.actorPos.value;
			if (Math.abs(a.x - wantX) < 1e-6 && Math.abs(a.z - wantZ) < 1e-6) break;
			await new Promise((r) => setTimeout(r, 50));
		}
		const lab = window.__seeThroughLab;
		const c = window.__qnMapController;
		const rig = c.rig;
		const h = window.__qnHeroOcclusion;
		const frame = () => new Promise((r) => requestAnimationFrame(() => r()));

		const solid = (x, y, z) =>
			x >= 0 && y >= 0 && z >= 0 && x < lab.Wv && y < lab.Hv && z < lab.Lv &&
			lab.occ[x + z * lab.Wv + y * lab.Wv * lab.Lv] === 1;

		// Amanatides & Woo through the voxel grid. Returns true when a visible
		// front face (air -> solid) lies on the ray before maxT; `skip(P)` drops
		// faces the cutout discards.
		const blocked = (o, d, maxT, skip) => {
			const r = lab.res;
			const p = [(o[0] + lab.W / 2) * r, (o[1] + 0.5) * r, (o[2] + lab.L / 2) * r];
			const v = [d[0] * r, d[1] * r, d[2] * r];
			const hi = [lab.Wv, lab.Hv, lab.Lv];
			let t0 = 0, t1 = maxT;
			for (let a = 0; a < 3; a++) {
				if (Math.abs(v[a]) < 1e-12) {
					if (p[a] < 0 || p[a] > hi[a]) return false;
					continue;
				}
				let ta = (0 - p[a]) / v[a], tb = (hi[a] - p[a]) / v[a];
				if (ta > tb) [ta, tb] = [tb, ta];
				t0 = Math.max(t0, ta);
				t1 = Math.min(t1, tb);
			}
			if (t0 >= t1) return false;
			let t = t0;
			const cell = [0, 1, 2].map((a) => Math.min(hi[a] - 1, Math.max(0, Math.floor(p[a] + v[a] * (t + 1e-7)))));
			const step = v.map((x) => (x > 0 ? 1 : -1));
			const tMax = [0, 1, 2].map((a) =>
				Math.abs(v[a]) < 1e-12 ? Infinity : (cell[a] + (v[a] > 0 ? 1 : 0) - p[a]) / v[a]);
			const tDelta = v.map((x) => (Math.abs(x) < 1e-12 ? Infinity : Math.abs(1 / x)));
			let prev = t0 > 0 ? false : solid(...cell); // a ray starting inside rock sees no face
			while (t < t1) {
				const s = solid(cell[0], cell[1], cell[2]);
				if (s && !prev) {
					const P = [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t];
					if (!skip || !skip(P)) return true;
				}
				prev = s;
				const a = tMax[0] < tMax[1] ? (tMax[0] < tMax[2] ? 0 : 2) : (tMax[1] < tMax[2] ? 1 : 2);
				t = tMax[a];
				cell[a] += step[a];
				tMax[a] += tDelta[a];
			}
			return false;
		};

		const placeOrtho = (az, el, zoom, offCentre) => {
			if (c.cameraMode !== "ortho") c.setCameraMode("ortho", true);
			const cam = rig.orthoCamera;
			const dist = cam.position.distanceTo(rig.controls.target);
			const a = h.actorPos.value;
			const right = [Math.cos(az), 0, -Math.sin(az)];
			rig.controls.target.set(a.x + right[0] * offCentre, a.y, a.z + right[2] * offCentre);
			cam.position.set(
				rig.controls.target.x + dist * Math.cos(el) * Math.sin(az),
				rig.controls.target.y + dist * Math.sin(el),
				rig.controls.target.z + dist * Math.cos(el) * Math.cos(az));
			cam.zoom = zoom;
			cam.updateProjectionMatrix();
			rig.controls.update();
		};
		const placePerspective = (az, el, dist) => {
			if (c.cameraMode !== "perspective") c.setCameraMode("perspective", true);
			const a = h.actorPos.value;
			rig.controls.target.copy(a);
			rig.perspectiveCamera.position.set(
				a.x + dist * Math.cos(el) * Math.sin(az),
				a.y + dist * Math.sin(el),
				a.z + dist * Math.cos(el) * Math.cos(az));
			rig.perspectiveCamera.lookAt(a);
			rig.controls.update();
		};

		const measure = async (label) => {
			// Let the cutout driver see this camera (it runs once per frame).
			for (let i = 0; i < 3; i++) await frame();
			const cam = c.cameraMode === "ortho" ? rig.orthoCamera : rig.perspectiveCamera;
			const camPos = cam.position.clone();
			const fwd = cam.getWorldDirection(camPos.clone());
			const params = {
				camX: h.camPos.value.x, camY: h.camPos.value.y, camZ: h.camPos.value.z,
				actorX: h.actorPos.value.x, actorY: h.actorPos.value.y, actorZ: h.actorPos.value.z,
				radius: h.radius.value, coneScale: h.coneScale.value, cutY: h.cutY.value, cutSign: h.cutSign.value,
			};
			const skip = (P) => isHeroOccludedPoint(P[0], P[1], P[2], params);
			// Token: small standee, base 0.13 above the ground, 0.95 tall and wide.
			const groundY = h.actorPos.value.y - 0.9;
			const side = [fwd.z, 0, -fwd.x];
			const sideLen = Math.hypot(side[0], side[2]) || 1;
			let hiddenOff = 0, hiddenOn = 0, n = 0;
			for (const fy of [0.1, 0.3, 0.5, 0.7, 0.9])
				for (const fx of [-0.35, 0, 0.35]) {
					const S = [
						h.actorPos.value.x + (side[0] / sideLen) * fx * 0.95,
						groundY + 0.13 + fy * 0.95,
						h.actorPos.value.z + (side[2] / sideLen) * fx * 0.95,
					];
					let o, d, maxT;
					if (cam.isOrthographicCamera) {
						d = [fwd.x, fwd.y, fwd.z];
						maxT = 200;
						o = [S[0] - d[0] * maxT, S[1] - d[1] * maxT, S[2] - d[2] * maxT];
					} else {
						const dx = S[0] - camPos.x, dy = S[1] - camPos.y, dz = S[2] - camPos.z;
						maxT = Math.hypot(dx, dy, dz);
						d = [dx / maxT, dy / maxT, dz / maxT];
						o = [camPos.x, camPos.y, camPos.z];
					}
					maxT -= 1e-3;
					n++;
					if (blocked(o, d, maxT)) hiddenOff++;
					if (blocked(o, d, maxT, skip)) hiddenOn++;
				}
			const elevation = Math.asin(-fwd.y) * 180 / Math.PI;
			return {
				structure: structure.name, label, mode: cam.isOrthographicCamera ? "ortho" : "perspective",
				elevation: Math.round(elevation), cutSign: params.cutSign,
				hiddenOff: hiddenOff / n, hiddenOn: hiddenOn / n,
			};
		};

		const deg = Math.PI / 180;
		const rows = [];
		for (const azDeg of [45, 135, 225, 315]) {
			const az = azDeg * deg;
			for (const elDeg of [35, 60, 80])
				for (const off of [0, 8, 16]) {
					placeOrtho(az, elDeg * deg, 1, off);
					rows.push(await measure(`ortho az${azDeg} el${elDeg}${off ? ` off${off}` : ""}`));
				}
			const elevations = structure.below ? [-35, -15, 10, 35, 70] : [10, 35, 70];
			for (const elDeg of elevations)
				for (const dist of [3, 8, 20]) {
					placePerspective(az, elDeg * deg, dist);
					rows.push(await measure(`persp az${azDeg} el${elDeg} d${dist}`));
				}
		}
		return rows;
	}, { structure });
}

// Screenshots one view with the cutout on and off; returns the changed share.
async function pictureDiff(dm, label, place) {
	const page = dm.page;
	const box = await page.evaluate(() => {
		const c = [...document.querySelectorAll("canvas")].sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];
		const r = c.getBoundingClientRect();
		return { x: r.x, y: r.y, width: r.width, height: r.height };
	});
	const setCutout = (on) => dm.eval((qn, on) => { qn.ctx.AppSettings.heroOcclusionEnabled = on ? "true" : "false"; }, on);
	await dm.eval(place.fn, place.arg);
	await setCutout(true);
	await page.waitForTimeout(900);
	const on = await page.screenshot({ path: `test-kit/out/see-through-${label}.png`, clip: box });
	await setCutout(false);
	await page.waitForTimeout(900);
	const off = await page.screenshot({ path: `test-kit/out/see-through-${label}-off.png`, clip: box });
	await setCutout(true);
	return page.evaluate(async ([a, b]) => {
		const load = async (b64) => {
			const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
			const cv = new OffscreenCanvas(bmp.width, bmp.height);
			const g = cv.getContext("2d");
			g.drawImage(bmp, 0, 0);
			return g.getImageData(0, 0, bmp.width, bmp.height).data;
		};
		const [x, y] = await Promise.all([load(a), load(b)]);
		let changed = 0;
		for (let i = 0; i < x.length; i += 4) {
			if (Math.abs(x[i] - y[i]) + Math.abs(x[i + 1] - y[i + 1]) + Math.abs(x[i + 2] - y[i + 2]) > 48) changed++;
		}
		return changed / (x.length / 4);
	}, [on.toString("base64"), off.toString("base64")]);
}

export default async function seeThrough(kit) {
	const { dm } = kit;
	await dm.page.setViewportSize({ width: 1400, height: 900 });
	const hideScene = dm.page.getByTitle("Hide scene");
	if (await hideScene.count()) await hideScene.first().click();

	await guardOtherTerrain(dm);
	console.log("[see-through] other-terrain guard passed");

	const structures = await buildLab(dm);
	const rows = [];
	const pictures = [];
	for (const structure of structures) {
		const result = await sweep(dm, structure);
		rows.push(...result);
		// Picture diffs: iso camera at three zooms, perspective at three distances.
		for (const [kind, value] of [["ortho", 0.6], ["ortho", 1.5], ["ortho", 4], ["persp", 3], ["persp", 8], ["persp", 20]]) {
			const label = `${structure.name}-${kind}${value}`;
			const changed = await pictureDiff(dm, label, {
				fn: (qn, { kind, value }) => {
					const c = window.__qnMapController;
					const rig = c.rig;
					const a = window.__qnHeroOcclusion.actorPos.value;
					const az = Math.PI / 4, el = 35 * Math.PI / 180;
					if (kind === "ortho") {
						if (c.cameraMode !== "ortho") c.setCameraMode("ortho", true);
						const cam = rig.orthoCamera;
						const dist = cam.position.distanceTo(rig.controls.target);
						rig.controls.target.copy(a);
						cam.position.set(a.x + dist * Math.cos(el) * Math.sin(az), a.y + dist * Math.sin(el), a.z + dist * Math.cos(el) * Math.cos(az));
						cam.zoom = value;
						cam.updateProjectionMatrix();
					} else {
						if (c.cameraMode !== "perspective") c.setCameraMode("perspective", true);
						rig.controls.target.copy(a);
						rig.perspectiveCamera.position.set(a.x + value * Math.cos(el) * Math.sin(az), a.y + value * Math.sin(el), a.z + value * Math.cos(el) * Math.cos(az));
						rig.perspectiveCamera.lookAt(a);
					}
					rig.controls.update();
				},
				arg: { kind, value },
			});
			pictures.push({ structure: structure.name, view: `${kind} ${value}`, changed: Math.round(changed * 1000) / 1000 });
		}
		const bad = result.filter((r) => r.hiddenOn > MAX_HIDDEN_WITH_CUTOUT);
		console.log(`[see-through] ${structure.name}: ${result.length} views, ${bad.length} with the token still hidden`);
	}

	const failures = rows.filter((r) => r.hiddenOn > MAX_HIDDEN_WITH_CUTOUT);
	fs.writeFileSync("test-kit/out/see-through.json", JSON.stringify({ failures, pictures, rows }, null, 2));
	const shaderErrors = dm.logs.filter((line) => /Shader Error|not compiled/i.test(line));
	assert.deepEqual(shaderErrors, [], "no shader compile errors");
	console.log("[see-through] picture change share", pictures.map((p) => `${p.structure}/${p.view}=${p.changed}`).join("  "));
	for (const f of failures) console.log(`[see-through] HIDDEN ${f.structure} ${f.label}: off ${f.hiddenOff.toFixed(2)} on ${f.hiddenOn.toFixed(2)}`);
	assert.equal(failures.length, 0, `${failures.length} views leave the token hidden behind terrain (see test-kit/out/see-through.json)`);
}
