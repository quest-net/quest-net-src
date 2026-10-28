// Fire material look check: paints fire (palette 253) into Forest Clearing and
// screenshots it by day and night, close up, top-down and from a low camera.
// Left half: campfire, brazier, a fire wall and a 3x3 blaze. Right half: tall
// fire -- a 4x4x4 block, a 5-high column, and a torch on a wall bracket.
//   node test-kit/run.mjs test-kit/scenarios/fire-look.mjs --players 0
// In a --serve session, rerun with:
//   node test-kit/send.mjs "return (await import('file:///<repo>/test-kit/scenarios/fire-look.mjs?' + Date.now())).default(kit)"

import assert from "node:assert/strict";

// Flame runs painted below: campfire 1, brazier 1, wall 7, blaze 9, block 16,
// column 1, torch 1. Every one stands on a solid voxel, so each gets a glow.
const EXPECTED_RUNS = 36;
const LIGHT_POOL = 8;

export default async function fireLook(kit) {
	const { dm } = kit;

	await dm.eval(async (qn) => {
		const { decodeVoxels, encodeVoxels } = await qn.import("utils/terrain/data/VoxelDataUtils.ts");
		const { resolveTerrainVoxels } = await qn.import("utils/terrain/data/terrainPayloadStore.ts");
		const terrain = qn.campaign.VoxelTerrains.find((t) => t.Name === "Forest Clearing");
		const STONE = 240, WOOD = 244, FIRE = 253, OLD_VOLUME_FIRE = 254;
		const voxels = new Map();
		for (const v of decodeVoxels(resolveTerrainVoxels(terrain))) {
			// Drop fire from an earlier run so reruns start clean.
			if (v.color === FIRE || v.color === OLD_VOLUME_FIRE) continue;
			voxels.set(`${v.x},${v.y},${v.z}`, v);
		}
		const put = (x, y, z, color) => voxels.set(`${x},${y},${z}`, { x, y, z, color });

		// Ground top is y = 1 on open grass, so features start at y = 2.
		// Campfire: one fire voxel ringed by logs.
		put(5, 2, 12, FIRE);
		for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) put(5 + dx, 2, 12 + dz, WOOD);
		// Brazier: two stone blocks, fire on top.
		put(2, 2, 12, STONE);
		put(2, 3, 12, STONE);
		put(2, 4, 12, FIRE);
		// Wall of fire: a 7-tile line, 2 high.
		for (let x = 2; x <= 8; x++) for (let y = 2; y <= 3; y++) put(x, y, 22, FIRE);
		// Blaze: 3x3 tiles, 2 high.
		for (let x = 8; x <= 10; x++) for (let z = 16; z <= 18; z++) for (let y = 2; y <= 3; y++) put(x, y, z, FIRE);

		// Tall fire: 4x4x4 block.
		for (let x = 14; x <= 17; x++) for (let z = 14; z <= 17; z++) for (let y = 2; y <= 5; y++) put(x, y, z, FIRE);
		// A single 5-high column.
		for (let y = 2; y <= 6; y++) put(20, y, 12, FIRE);
		// Torch: a stone pillar with a wooden bracket sticking out, fire on the bracket.
		for (let y = 2; y <= 5; y++) put(21, y, 20, STONE);
		put(20, 4, 20, WOOD);
		put(20, 5, 20, FIRE);

		await qn.actions.executeAndWait("terrain:edit", {
			terrainId: terrain.Id,
			updates: { Voxels: encodeVoxels(voxels.values()) },
		});
	});

	const setLighting = (lighting, background) =>
		dm.eval(async (qn, { lighting, background }) => {
			const terrain = qn.campaign.VoxelTerrains.find((t) => t.Name === "Forest Clearing");
			await qn.actions.executeAndWait("terrain:edit", {
				terrainId: terrain.Id,
				updates: { Lighting: { ...terrain.Lighting, ...lighting }, Background: background },
			});
		}, { lighting, background });

	const frame = (zoom, target) =>
		dm.eval((qn, { zoom, target }) => {
			const rig = window.__qnMapController.rig;
			const cam = rig.orthoCamera;
			const offset = cam.position.clone().sub(rig.controls.target);
			rig.controls.target.set(target[0], target[1], target[2]);
			cam.position.copy(rig.controls.target).add(offset);
			cam.zoom = zoom;
			cam.updateProjectionMatrix();
			rig.controls.update();
		}, { zoom, target });

	const perspective = (position, target) =>
		dm.eval((qn, { position, target }) => {
			const c = window.__qnMapController;
			c.setCameraMode("perspective", true);
			c.rig.controls.target.set(...target);
			c.rig.perspectiveCamera.position.set(...position);
			c.rig.perspectiveCamera.lookAt(c.rig.controls.target);
			c.rig.controls.update();
		}, { position, target });
	const ortho = () => dm.eval(() => window.__qnMapController.setCameraMode("ortho", true));

	const shots = [];
	const settle = () => dm.page.waitForTimeout(2500);
	await dm.page.setViewportSize({ width: 1800, height: 1100 });
	const hideScene = dm.page.getByTitle("Hide scene");
	if (await hideScene.count()) await hideScene.first().click();
	// Crop to the map: the largest canvas on the page.
	const mapShot = async (label) => {
		const box = await dm.page.evaluate(() => {
			const c = [...document.querySelectorAll("canvas")].sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];
			const r = c.getBoundingClientRect();
			return { x: r.x, y: r.y, width: r.width, height: r.height };
		});
		const file = `test-kit/out/${label}.png`;
		await dm.page.screenshot({ path: file, clip: box });
		return file;
	};

	await setLighting({ Intensity: 1.15, Color: "#ffffff" }, {});
	await frame(1, [0, 0, 0]);
	await settle();
	shots.push(await mapShot("fire-day"));

	// The layer built what was painted, and its shaders compiled.
	const layer = await dm.eval(() => {
		const group = window.__qnFireLayer;
		if (!group?.parent) return null;
		const meshes = group.children.filter((o) => o.isInstancedMesh);
		return {
			instanceCounts: meshes.map((m) => m.count),
			lights: group.children.filter((o) => o.isPointLight).length,
			embers: group.children.some((o) => o.isPoints),
		};
	});
	assert.ok(layer, "fire layer is in the scene");
	assert.deepEqual(layer.instanceCounts, [EXPECTED_RUNS, EXPECTED_RUNS], "one card and one glow per flame run");
	assert.equal(layer.lights, LIGHT_POOL, "full light pool");
	assert.ok(layer.embers, "embers present");
	const shaderErrors = dm.logs.filter((line) => /Shader Error|not compiled/i.test(line));
	assert.deepEqual(shaderErrors, [], "no shader compile errors");
	await perspective([4, 1.6, -3.5], [4, 2.2, 4]);
	await settle();
	shots.push(await mapShot("fire-day-tall-perspective"));
	await ortho();

	await setLighting({ Intensity: 0.18, Color: "#7f95ff" }, { Color: "#05070f" });
	// Terrain lighting only drives the sun; the hemisphere fill is a constant.
	// Dim it directly so the fire lights can be judged at night.
	await dm.eval(() => {
		const scene = window.__qnFireLayer?.parent;
		scene?.traverse((o) => { if (o.isHemisphereLight) o.intensity = 0.25; });
	});
	await frame(1, [0, 0, 0]);
	await settle();
	shots.push(await mapShot("fire-night"));
	await frame(3, [-5, 1.5, 5]);
	await settle();
	shots.push(await mapShot("fire-night-short-close"));
	await frame(3, [5, 2, 4]);
	await settle();
	shots.push(await mapShot("fire-night-tall-close"));
	await perspective([4, 1.6, -3.5], [4, 2.2, 4]);
	await settle();
	shots.push(await mapShot("fire-night-tall-perspective"));
	await perspective([-6, 1.4, 1], [-4, 1.2, 5]);
	await settle();
	shots.push(await mapShot("fire-night-short-perspective"));
	await ortho();

	// Tokens and fire: one entity behind the 4x4x4 block (from the iso camera,
	// which looks toward -x -z), one in front. The flame must hide the one behind.
	const moved = await dm.eval(async (qn) => {
		const terrain = qn.campaign.VoxelTerrains.find((t) => t.Name === "Forest Clearing");
		const here = qn.campaign.GameState.Entities.filter((e) => e.Position?.terrainId === terrain.Id && !e.Hidden);
		const spots = [{ x: 13, y: 13 }, { x: 18, y: 18 }];
		const names = [];
		for (const [i, spot] of spots.entries()) {
			const actor = here[i];
			if (!actor) break;
			await qn.actions.executeAndWait("actor:move", {
				actorId: actor.Id,
				position: { ...qn.plain(actor.Position), x: spot.x, y: spot.y },
			});
			names.push(`${actor.Name} -> (${spot.x}, ${spot.y})`);
		}
		return names;
	});
	console.log("[fire-look] moved", moved);
	await frame(3, [4, 2, 4]);
	await settle();
	shots.push(await mapShot("fire-night-tokens-iso"));
	await perspective([10.5, 2, 10.5], [3, 1.5, 3]);
	await settle();
	shots.push(await mapShot("fire-night-tokens-perspective"));
	await ortho();

	// Fire as the surroundings material ("smoldering ground"), level with the
	// grass top (ground voxels are y 0..1, so 2 tactical units above the base).
	await dm.eval(async (qn) => {
		const terrain = qn.campaign.VoxelTerrains.find((t) => t.Name === "Forest Clearing");
		await qn.actions.executeAndWait("terrain:edit", {
			terrainId: terrain.Id,
			updates: { Surroundings: { Height: 2, ColorIndex: 253 } },
		});
	});
	await dm.eval(() => {
		const scene = window.__qnFireLayer?.parent;
		scene?.traverse((o) => { if (o.isHemisphereLight) o.intensity = 0.25; });
	});
	await frame(0.55, [0, 0, 0]);
	await settle();
	shots.push(await mapShot("fire-night-surroundings"));
	await perspective([-14, 2.5, 14], [-24, 1, 24]);
	await settle();
	shots.push(await mapShot("fire-night-surroundings-low"));
	await ortho();
	await setLighting({ Intensity: 1.15, Color: "#ffffff" }, {});
	await frame(0.55, [0, 0, 0]);
	await settle();
	shots.push(await mapShot("fire-day-surroundings"));

	const lateShaderErrors = dm.logs.filter((line) => /Shader Error|not compiled/i.test(line));
	assert.deepEqual(lateShaderErrors, [], "no shader compile errors (incl. surroundings)");

	return shots;
}
