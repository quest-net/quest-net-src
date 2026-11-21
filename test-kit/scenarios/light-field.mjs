// Voxel light field (sky light + glow) look and cost check. Builds in Forest
// Clearing: a roofed stone room with a doorway and a light block in its far
// corner, and a lava pit with walls on three sides and a partial roof. Shoots
// them from above and through the doorway / at the pit, then times the WASM
// mesher on this map and on a synthetic 64x16x64-tile map at resolution 3.
//   node test-kit/run.mjs test-kit/scenarios/light-field.mjs --players 0
// Shots: test-kit/out/light-field-*.png. Timings: test-kit/out/light-field.json
// Pass --label <name> via LIGHT_FIELD_LABEL env to keep before/after shots apart.

import assert from "node:assert/strict";
import fs from "node:fs";

const LABEL = process.env.LIGHT_FIELD_LABEL ?? "after";

export default async function lightField(kit) {
	const { dm } = kit;

	await dm.eval(async (qn) => {
		const { decodeVoxels, encodeVoxels } = await qn.import("utils/terrain/data/VoxelDataUtils.ts");
		const { resolveTerrainVoxels } = await qn.import("utils/terrain/data/terrainPayloadStore.ts");
		const terrain = qn.campaign.VoxelTerrains.find((t) => t.Name === "Forest Clearing");
		const STONE = 240, LIGHT = 243, LAVA = 245;
		const voxels = new Map();
		for (const v of decodeVoxels(resolveTerrainVoxels(terrain))) voxels.set(`${v.x},${v.y},${v.z}`, v);
		const put = (x, y, z, color) => voxels.set(`${x},${y},${z}`, { x, y, z, color });
		const del = (x, y, z) => voxels.delete(`${x},${y},${z}`);

		// Room: stone shell x 2..9, z 2..9, walls y 2..5, roof y 6; doorway on +X.
		for (let x = 2; x <= 9; x++) for (let z = 2; z <= 9; z++) {
			for (let y = 2; y <= 5; y++) if (x === 2 || x === 9 || z === 2 || z === 9) put(x, y, z, STONE);
			put(x, 6, z, STONE);
		}
		for (let z = 5; z <= 6; z++) for (let y = 2; y <= 3; y++) del(9, y, z);
		put(3, 2, 3, LIGHT);

		// Lava pit at ground level, walls on -X, -Z and +Z, roof over its -X half.
		for (let x = 14; x <= 17; x++) for (let z = 14; z <= 17; z++) put(x, 1, z, LAVA);
		for (let y = 2; y <= 4; y++) {
			for (let z = 13; z <= 18; z++) put(13, y, z, STONE);
			for (let x = 13; x <= 18; x++) { put(x, y, 13, STONE); put(x, y, 18, STONE); }
		}
		for (let x = 13; x <= 15; x++) for (let z = 13; z <= 18; z++) put(x, 5, z, STONE);

		await qn.actions.executeAndWait("terrain:edit", {
			terrainId: terrain.Id,
			updates: { Voxels: encodeVoxels(voxels.values()) },
		});
	});

	const page = dm.page;
	await page.setViewportSize({ width: 1600, height: 1000 });
	const hideScene = page.getByTitle("Hide scene");
	if (await hideScene.count()) await hideScene.first().click();
	const settle = () => page.waitForTimeout(2500);
	const mapShot = async (name) => {
		const box = await page.evaluate(() => {
			const c = [...document.querySelectorAll("canvas")].sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];
			const r = c.getBoundingClientRect();
			return { x: r.x, y: r.y, width: r.width, height: r.height };
		});
		const file = `test-kit/out/light-field-${LABEL}-${name}.png`;
		await page.screenshot({ path: file, clip: box });
		console.log("screenshot:", file);
	};
	const perspective = (position, target) =>
		dm.eval((qn, { position, target }) => {
			const c = window.__qnMapController;
			c.setCameraMode("perspective", true);
			c.rig.controls.target.set(...target);
			c.rig.perspectiveCamera.position.set(...position);
			c.rig.perspectiveCamera.lookAt(c.rig.controls.target);
			c.rig.controls.update();
		}, { position, target });

	await settle();
	await mapShot("overview");
	// Through the doorway (world x = 9 - 12 + 0.5 = -2.5, z ~ -6) into the room.
	await perspective([1.5, 2.3, -6], [-7, 1.8, -6]);
	await settle();
	await mapShot("room");
	// At the lava pit (world x/z 2.5..5.5) from the open +X side.
	await perspective([10, 3.5, 4], [3, 1.8, 4]);
	await settle();
	await mapShot("lava");
	// Open-air ground at the foot of the room's +Z wall (face at world z = -2).
	await perspective([-6, 2.6, 2], [-6, 1.5, -2]);
	await settle();
	await mapShot("wallbase");

	const shaderErrors = dm.logs.filter((line) => /Shader Error|not compiled|ERROR: 0:/i.test(line));
	assert.deepEqual(shaderErrors, [], "no shader compile errors");
	const anchorWarnings = dm.logs.filter((line) => line.includes("Voxel light: shader anchor missing"));
	assert.deepEqual(anchorWarnings, [], "light field patch applied to every terrain shader");

	// Mesher cost (median of 5): this map, then a synthetic 64x16x64 @ res 3.
	const timings = await dm.eval(async (qn) => {
		const { encodeVoxels } = await qn.import("utils/terrain/data/VoxelDataUtils.ts");
		const { MATERIAL_LOOKUP } = await qn.import("components/Map/Terrain/materials/index.ts");
		const { resolveTerrainVoxels } = await qn.import("utils/terrain/data/terrainPayloadStore.ts");
		const { VoxelMesher } = await qn.import("../wasm/voxel-mesher/pkg/voxel_mesher.js");
		const L = MATERIAL_LOOKUP;
		const mesher = new VoxelMesher(L.bucketId, L.occlusionId, L.usesVertexColors, L.deformsSurface,
			L.preservesVoxelFaces, L.isVolumetric, new Float32Array(768), L.lightBlocks, L.lightEmission);
		const time = (svo, w, h, l, res, skyRadius = 3) => {
			const runs = [];
			for (let i = 0; i < 5; i++) {
				const t = performance.now();
				mesher.build_from_svo(svo, w, h, l, res, 1, skyRadius, 5).free();
				runs.push(performance.now() - t);
			}
			return Math.round(runs.sort((a, b) => a - b)[2] * 10) / 10;
		};
		const forest = qn.campaign.VoxelTerrains.find((t) => t.Name === "Forest Clearing");
		const big = [];
		// Ground 3 voxels deep, stone pillars every 6 voxels, a roofed hall, lava strips.
		for (let x = 0; x < 192; x++) for (let z = 0; z < 192; z++) {
			for (let y = 0; y < 3; y++) big.push({ x, y, z, color: 10 });
			if (x % 6 === 0 && z % 6 === 0) for (let y = 3; y < 20; y++) big.push({ x, y, z, color: 240 });
			if (x >= 40 && x < 120 && z >= 40 && z < 120) big.push({ x, y: 20, z, color: 240 });
			if (z % 30 === 0) big.push({ x, y: 2, z, color: 245 });
		}
		const bigSvo = encodeVoxels(big);
		// Performance mode passes sky radius 0: no light field at all.
		const perfBuild = mesher.build_from_svo(bigSvo, 64, 16, 64, 3, 1, 0, 5);
		const perfLightBytes = perfBuild.take_light().length;
		perfBuild.free();
		return {
			forestMs: time(resolveTerrainVoxels(forest), forest.Width, forest.Height, forest.Length, forest.Resolution ?? 1),
			big64Res3Ms: time(bigSvo, 64, 16, 64, 3),
			big64Res3PerfModeMs: time(bigSvo, 64, 16, 64, 3, 0),
			perfLightBytes,
			big64Res3Voxels: big.length,
		};
	});
	console.log("timings:", JSON.stringify(timings));
	if (LABEL === "after") assert.equal(timings.perfLightBytes, 0, "performance mode builds no light field");
	const reportPath = "test-kit/out/light-field.json";
	const report = fs.existsSync(reportPath) ? JSON.parse(fs.readFileSync(reportPath, "utf8")) : {};
	report[LABEL] = timings;
	fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
}
