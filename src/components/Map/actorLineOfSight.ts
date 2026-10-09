// components/Map/actorLineOfSight.ts
//
// Actor-to-actor line of sight over voxel terrain, for the "players see
// out-of-sight entities" campaign setting. Lives beside the map (not in
// domains/) because the test is defined by the rendered token: an actor's
// sight points sit on its standee.
//
// Two rays leave the viewer's eye -- the same eyeline the first-person camera
// uses (getEyeHeight) -- one to each ACTOR_SIGHT_TARGET_HEIGHT_RATIOS point on
// the target. The target is out of sight only when terrain blocks both, so a
// low wall that covers its legs still leaves the upper ray clear.

import * as THREE from "three";
import type { Actor } from "../../domains/Actor/Actor";
import type { VoxelTerrain } from "../../domains/VoxelTerrain/VoxelTerrain";
import { getVoxelTerrainIndex } from "../../utils/terrain/data/VoxelTerrainIndex";
import { isSightSegmentClear } from "../../utils/terrain/raycast/VoxelRaycast";
import { getEyeHeight } from "./ActorCamera/actor";
import { ACTOR_TOKEN_DESCRIPTOR_DEFAULTS } from "./Actors3D/actorTokenConstants";
import { getActorGroundPosition } from "./Actors3D/actorTokenPlacement";
import { getActorTokenWorldSize } from "./Actors3D/actorTokenTexture";

/** Target sample heights, as fractions of the target's standee height. */
const ACTOR_SIGHT_TARGET_HEIGHT_RATIOS = [0.75, 0.25] as const;

type SightActor = Pick<Actor, "Id" | "Position" | "Size">;

/** World point `height` above the centre of the tile `actor` stands on. */
function getPointAboveActor(
	actor: SightActor,
	terrain: VoxelTerrain,
	height: number
): THREE.Vector3 {
	const point = getActorGroundPosition({ position: actor.Position }, terrain);
	point.y += height;
	return point;
}

/** Whether `viewer` has line of sight to `target`. Both must stand on `terrain`. */
export function canActorSee(
	viewer: SightActor,
	target: SightActor,
	terrain: VoxelTerrain
): boolean {
	const index = getVoxelTerrainIndex(terrain);
	const eye = getPointAboveActor(viewer, terrain, getEyeHeight(viewer));
	const targetHeight = getActorTokenWorldSize(
		target.Size ?? ACTOR_TOKEN_DESCRIPTOR_DEFAULTS.SIZE
	).height;
	return ACTOR_SIGHT_TARGET_HEIGHT_RATIOS.some((ratio) =>
		isSightSegmentClear(
			eye,
			getPointAboveActor(target, terrain, targetHeight * ratio),
			index
		)
	);
}

/** Ids of the `candidates` that `viewer` cannot see (other terrain or blocked). */
export function computeOutOfSightIds(
	viewer: SightActor,
	candidates: readonly SightActor[],
	terrain: VoxelTerrain
): Set<string> {
	const out = new Set<string>();
	for (const candidate of candidates) {
		if (
			candidate.Position.terrainId !== viewer.Position.terrainId ||
			!canActorSee(viewer, candidate, terrain)
		) {
			out.add(candidate.Id);
		}
	}
	return out;
}
