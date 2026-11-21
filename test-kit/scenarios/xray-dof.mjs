// X-ray tokens vs depth of field: x-ray tokens write depth 0 so the fog skips
// them; the DoF circle-of-confusion must treat that as in focus, not blur it.
// Shoots the token area with x-ray off and on, then again inside a fog bank
// (x-ray on: tokens visible through fog; off: tokens fogged). Compare by eye.
//   node test-kit/run.mjs test-kit/scenarios/xray-dof.mjs --players 0
// Shots: test-kit/out/xray-dof-{off,on,fog-on,fog-off}-DM.png (+ -full for fog)
import assert from "node:assert/strict";

export default async function xrayDof(kit) {
	const { dm } = kit;
	const page = dm.page;
	const button = page.locator('[data-tip="Actor X-Ray"], [data-tip="Disable actor X-Ray"]').first();
	await button.waitFor({ timeout: 20000 });
	await page.waitForTimeout(1500);

	const crop = async (label) => {
		const box = await page.locator("canvas").first().boundingBox();
		const clip = { x: box.x + box.width * 0.35, y: box.y + box.height * 0.45, width: box.width * 0.4, height: box.height * 0.35 };
		const path = `test-kit/out/xray-dof-${label}-DM.png`;
		await page.screenshot({ path, clip });
		console.log("screenshot:", path);
	};

	await crop("off");
	await button.click();
	assert.equal(await button.getAttribute("aria-pressed"), "true", "x-ray on");
	await page.waitForTimeout(800);
	await crop("on");

	const warned = dm.logs.some((l) => String(l).includes("CoC shader changed"));
	assert.ok(!warned, "DoF CoC shader patch applied");

	// Fog bank (palette 251) 4 voxels deep over the whole ground: x-ray off must
	// fog the tokens, x-ray on must show them through it.
	await dm.eval(async (qn) => {
		const { decodeVoxels, encodeVoxels } = await qn.import("utils/terrain/data/VoxelDataUtils.ts");
		const { resolveTerrainVoxels } = await qn.import("utils/terrain/data/terrainPayloadStore.ts");
		const terrain = qn.campaign.VoxelTerrains.find((t) => t.Name === "Forest Clearing");
		const voxels = new Map();
		let maxX = 0, maxZ = 0;
		for (const v of decodeVoxels(resolveTerrainVoxels(terrain))) {
			voxels.set(`${v.x},${v.y},${v.z}`, v);
			maxX = Math.max(maxX, v.x);
			maxZ = Math.max(maxZ, v.z);
		}
		for (let x = 0; x <= maxX; x++) for (let z = 0; z <= maxZ; z++) for (let y = 2; y <= 5; y++) {
			const key = `${x},${y},${z}`;
			if (!voxels.has(key)) voxels.set(key, { x, y, z, color: 251 });
		}
		await qn.actions.executeAndWait("terrain:edit", {
			terrainId: terrain.Id,
			updates: { Voxels: encodeVoxels(voxels.values()) },
		});
	});
	await page.waitForTimeout(2500);
	await crop("fog-on");
	await page.screenshot({ path: "test-kit/out/xray-dof-fog-on-full-DM.png" });
	await button.click();
	assert.equal(await button.getAttribute("aria-pressed"), "false", "x-ray off");
	await page.waitForTimeout(800);
	await crop("fog-off");
	await page.screenshot({ path: "test-kit/out/xray-dof-fog-off-full-DM.png" });
	console.log("screenshot: test-kit/out/xray-dof-fog-{on,off}[-full]-DM.png");
}
