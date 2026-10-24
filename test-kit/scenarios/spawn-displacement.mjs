// Spawning an entity on a character's tile (e.g. an item's summon at its user)
// bumps the character to a free tile beside it, not toward the map center.
//   node test-kit/run.mjs test-kit/scenarios/spawn-displacement.mjs --players 0
import assert from "node:assert/strict";

const aria = (dm) =>
	dm.state((c) => c.GameState.Characters.find((a) => a.Name.startsWith("Aria")));

export default async function spawnDisplacement(kit) {
	const { dm } = kit;
	const start = await aria(dm);

	// Park Aria on a free surface tile near a corner, far from the 24x24 center.
	const corner = await dm.eval(async (qn, terrainId) => {
		const { getVoxelTerrainIndex, tileKey } = await qn.import(
			"utils/terrain/data/VoxelTerrainIndex.ts"
		);
		const terrain = qn.campaign.VoxelTerrains.find((t) => t.Id === terrainId);
		const index = getVoxelTerrainIndex(terrain);
		const actors = [...qn.campaign.GameState.Characters, ...qn.campaign.GameState.Entities];
		for (let y = 1; y < 6; y++)
			for (let x = 1; x < 6; x++) {
				const h = index.allSurfaces.get(tileKey(x, y))?.[0];
				if (h === undefined) continue;
				if (actors.some((a) => a.Position.terrainId === terrainId && Math.abs(a.Position.x - x) < 2 && Math.abs(a.Position.y - y) < 2)) continue;
				return { terrainId, x, y, h };
			}
		return null;
	}, start.Position.terrainId);
	assert.ok(corner, "found a free corner tile");
	await dm.act("actor:move", { actorId: start.Id, position: corner });
	await dm.waitFor((c, p) => c.GameState.Characters.some((a) => a.Position.x === p.x && a.Position.y === p.y), {
		arg: corner,
		message: "Aria moved to the corner",
	});
	const before = (await aria(dm)).Position;

	// Summon a goblin right on top of her.
	const goblinId = await dm.state((c) => c.EntityTemplates.find((e) => e.Name.startsWith("Goblin")).Id);
	const entityCount = (await dm.state((c) => c.GameState.Entities.length));
	await dm.act("actor:spawn", { actorId: goblinId, position: before });
	await dm.waitFor((c, n) => c.GameState.Entities.length === n, {
		arg: entityCount + 1,
		message: "goblin spawned",
	});

	const after = (await aria(dm)).Position;
	const moved = Math.max(Math.abs(after.x - before.x), Math.abs(after.y - before.y));
	console.log(`Aria ${before.x},${before.y} -> ${after.x},${after.y} (moved ${moved})`);
	assert.equal(after.terrainId, before.terrainId, "Aria stayed on the same terrain");
	assert.ok(moved >= 1, "Aria was bumped off the goblin's tile");
	assert.ok(moved <= 2, `Aria landed beside the goblin, not near the center (moved ${moved} tiles)`);
}
