// Grid movement body rules (1 x 1 x 2 tile body): walls thinner than a tile block,
// one-voxel gaps don't let a body through, standing and crossing need 2 tiles of
// headroom, posts and fence tops are not footing, and nobody climbs up through a
// thin ceiling. Builds tiny synthetic terrains (6 x 3 tiles, resolution 3, floor
// at voxel y 0) in the DM page and asks the movement code directly.
//   node test-kit/run.mjs test-kit/scenarios/movement-body-rules.mjs --players 0

import assert from "node:assert/strict";

export default async function movementBodyRules(kit) {
	const r = await kit.dm.eval(async (qn) => {
		const { encodeVoxels } = await qn.import("utils/terrain/data/VoxelDataUtils.ts");
		const { setTerrainVoxels } = await qn.import("utils/terrain/data/terrainPayloadStore.ts");
		const { calculateVoxelMovementRange, canStandVoxel } = await qn.import("domains/VoxelTerrain/VoxelMovementUtilities.ts");
		const { getVoxelTerrainIndex } = await qn.import("utils/terrain/data/VoxelTerrainIndex.ts");
		const R = 3, W = 6, L = 3, H = 5;
		const lookup = Array.from({ length: 65 }, (_, i) => i + 1); // climb cost = height
		let n = 0;
		const make = (fill) => {
			const v = [];
			for (let x = 0; x < W * R; x++) for (let z = 0; z < L * R; z++) {
				v.push({ x, y: 0, z, color: 10 });
				for (let y = 1; y < H * R; y++) if (fill(x, y, z)) v.push({ x, y, z, color: 240 });
			}
			const id = `body-rules-${n++}`;
			const terrain = { Id: id, Name: id, Width: W, Length: L, Height: H, Resolution: R, Lighting: {}, Background: {} };
			terrain.ContentHash = setTerrainVoxels(id, encodeVoxels(v));
			return terrain;
		};
		const cost = (t, fly, to = "4,1,0") =>
			calculateVoxelMovementRange(t, { x: 0, y: 1, h: 0 }, 50, fly, { heightCostLookup: lookup, flyingIgnoresHeight: false })
				.costs.get(to) ?? null;
		const stand = (t, x, y, h, fly = false) => canStandVoxel(t, getVoxelTerrainIndex(t), x, y, h, fly);
		const surfaces = (t, x, y) => getVoxelTerrainIndex(t).allSurfaces.get(`${x},${y}`) ?? [];
		const thin = (x) => x === 6; // one voxel thick, inside tile column 2
		const tile2 = (x) => x >= 6 && x <= 8;
		const out = {};
		let t;

		out.flat = cost(make(() => false), false);
		t = make((x, y) => thin(x) && y <= 9);
		out.thinWall = { walk: cost(t, false), fly: cost(t, true), surfaces: surfaces(t, 2, 1) };
		t = make((x, y) => tile2(x) && y <= 9);
		out.fullWall = cost(t, false);
		t = make((x, y, z) => thin(x) && y <= 9 && z !== 4);
		out.oneVoxelGap = cost(t, false);
		t = make((x, y, z) => thin(x) && y <= 9 && z !== 4 && z !== 5);
		out.twoVoxelGap = cost(t, false);
		t = make((x, y) => thin(x) && y <= 3);
		out.fence = { walk: cost(t, false), standOnTop: stand(t, 2, 1, 1) };
		t = make((x, y) => thin(x) && y === 1);
		out.curb = cost(t, false);
		t = make((x, y, z) => x === 7 && z === 4 && y <= 9);
		out.centrePost = { enter: cost(t, false, "2,1,0"), around: cost(t, false), surfaces: surfaces(t, 2, 1) };
		t = make((x, y, z) => x === 6 && z === 3 && y <= 9);
		out.cornerPost = cost(t, false);
		t = make((x, y) => tile2(x) && y === 2);
		out.crawlspace = { walk: cost(t, false), standUnder: stand(t, 2, 1, 0), flyUnder: stand(t, 2, 1, 0, true) };
		t = make((x, y) => tile2(x) && y === 4);
		out.oneTileHeadroom = { walk: cost(t, false), standUnder: stand(t, 2, 1, 0) };
		// Full-tile wall with a 1-tile doorway in row 1: 2 tiles tall, then 1 voxel too low.
		t = make((x, y, z) => tile2(x) && y <= 9 && !(z >= 3 && z <= 5 && y <= 6));
		out.door = cost(t, false);
		t = make((x, y, z) => tile2(x) && y <= 9 && !(z >= 3 && z <= 5 && y <= 5));
		out.lowDoor = cost(t, false);
		// Thin ceiling over tiles 0-1 (2 tiles of headroom under it), full-tile pillar in tile 2.
		t = make((x, y) => (x < 6 && y === 7) || (tile2(x) && y <= 9));
		out.thinCeiling = { pillarTop: cost(t, false, "2,1,3"), underCeiling: stand(t, 1, 1, 0) };
		return out;
	});
	console.log(JSON.stringify(r));

	assert.equal(r.flat, 4, "open ground");
	assert.equal(r.thinWall.walk, null, "a thin wall blocks walkers");
	assert.ok(r.thinWall.fly > 4, "flyers go over a thin wall, not through it");
	assert.deepEqual(r.thinWall.surfaces, [0], "a thin wall's top is not footing");
	assert.equal(r.fullWall, 7, "a full-tile wall is still climbable for its height");
	assert.equal(r.oneVoxelGap, null, "a one-voxel gap is too narrow");
	assert.equal(r.twoVoxelGap, 4, "a half-tile gap lets a body through");
	assert.equal(r.fence.walk, null, "a thin fence blocks");
	assert.equal(r.fence.standOnTop, false, "nobody stands on a fence top");
	assert.equal(r.curb, 4, "a curb under half a tile is a step");
	assert.equal(r.centrePost.enter, null, "a 1 x 1 body can't share a tile with a post in its middle");
	assert.equal(r.centrePost.around, 6, "walkers go around it");
	assert.deepEqual(r.centrePost.surfaces, [0], "a post top is not footing");
	assert.equal(r.cornerPost, 4, "a post in a tile corner leaves room to pass");
	assert.equal(r.crawlspace.standUnder, false, "no standing in a crawlspace");
	assert.equal(r.crawlspace.flyUnder, false, "no hovering in a crawlspace");
	assert.equal(r.crawlspace.walk, 5, "walkers go over the crawlspace slab instead");
	assert.equal(r.oneTileHeadroom.standUnder, false, "1 tile of headroom is too low");
	assert.equal(r.door, 4, "a 1 x 2 doorway is passable");
	assert.ok(r.lowDoor === null || r.lowDoor > 4, "a doorway under 2 tiles is not");
	assert.equal(r.thinCeiling.underCeiling, true, "2 tiles under a ceiling is standable");
	assert.equal(r.thinCeiling.pillarTop, null, "no climbing up through a thin ceiling");
}
