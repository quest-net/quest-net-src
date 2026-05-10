import * as THREE from "three";
import type { VoxelTerrain } from "../../../domains/VoxelTerrain/VoxelTerrain";
import { decodeVoxels } from "../../../utils/VoxelDataUtils";
import { getVoxelTerrainResolution } from "../../../utils/VoxelTerrainUtils";
import { ACTOR_TOKEN_PLACEMENT } from "../Actors3D/actorTokenConstants";
import { terrainHeightToWorldY } from "../Actors3D/actorTokenPlacement";
import { actorPositionToGroundWorld, getEyeHeight } from "./actor";
import { FIRST_PERSON_COLLISION } from "./constants";
import { clampHeightToLegalColumn } from "./movement";
import type { FirstPersonActor, LegalTile } from "./types";

export interface VoxelCollisionData {
	resolution: number;
	voxelSize: number;
	voxelWidth: number;
	voxelHeight: number;
	voxelLength: number;
	occupied: Set<string>;
}

export interface ResolvedFirstPersonMovement {
	bodyPosition: THREE.Vector3;
	tile: LegalTile;
	bodyH: number;
}

function voxelCollisionKey(x: number, y: number, z: number): string {
	return `${x},${y},${z}`;
}

export function createVoxelCollisionData(terrain: VoxelTerrain): VoxelCollisionData {
	const resolution = getVoxelTerrainResolution(terrain);
	const occupied = new Set<string>();
	for (const voxel of decodeVoxels(terrain.Voxels)) {
		occupied.add(voxelCollisionKey(voxel.x, voxel.y, voxel.z));
	}

	return {
		resolution,
		voxelSize: 1 / resolution,
		voxelWidth: terrain.Width * resolution,
		voxelHeight: terrain.Height * resolution,
		voxelLength: terrain.Length * resolution,
		occupied,
	};
}

function chooseLegalTile(
	terrain: VoxelTerrain,
	worldPosition: THREE.Vector3,
	currentH: number,
	legalTilesByColumn: Map<string, LegalTile[]>
): LegalTile | null {
	const offsetX = (terrain.Width - 1) / 2;
	const offsetZ = (terrain.Length - 1) / 2;
	const x = Math.round(worldPosition.x + offsetX);
	const y = Math.round(worldPosition.z + offsetZ);
	const column = legalTilesByColumn.get(`${x},${y}`);
	if (!column || column.length === 0) return null;

	let best = column[0];
	for (const tile of column) {
		if (Math.abs(tile.h - currentH) < Math.abs(best.h - currentH)) {
			best = tile;
		}
	}
	return best;
}

function hasLegalTileAtHeight(
	legalTilesByColumn: Map<string, LegalTile[]>,
	x: number,
	y: number,
	h: number
): boolean {
	return legalTilesByColumn
		.get(`${x},${y}`)
		?.some((tile) => tile.h === h) ?? false;
}

function clampAgainstBlockedNeighbors(
	terrain: VoxelTerrain,
	worldPosition: THREE.Vector3,
	tile: LegalTile,
	legalTilesByColumn: Map<string, LegalTile[]>
): THREE.Vector3 {
	const radius = FIRST_PERSON_COLLISION.BODY_RADIUS;
	const offsetX = (terrain.Width - 1) / 2;
	const offsetZ = (terrain.Length - 1) / 2;
	const centerX = tile.x - offsetX;
	const centerZ = tile.y - offsetZ;
	const next = worldPosition.clone();

	if (!hasLegalTileAtHeight(legalTilesByColumn, tile.x - 1, tile.y, tile.h)) {
		next.x = Math.max(next.x, centerX - 0.5 + radius);
	}
	if (!hasLegalTileAtHeight(legalTilesByColumn, tile.x + 1, tile.y, tile.h)) {
		next.x = Math.min(next.x, centerX + 0.5 - radius);
	}
	if (!hasLegalTileAtHeight(legalTilesByColumn, tile.x, tile.y - 1, tile.h)) {
		next.z = Math.max(next.z, centerZ - 0.5 + radius);
	}
	if (!hasLegalTileAtHeight(legalTilesByColumn, tile.x, tile.y + 1, tile.h)) {
		next.z = Math.min(next.z, centerZ + 0.5 - radius);
	}

	return next;
}

function circleIntersectsAabb2D(
	cx: number,
	cz: number,
	radius: number,
	minX: number,
	maxX: number,
	minZ: number,
	maxZ: number
): boolean {
	const closestX = THREE.MathUtils.clamp(cx, minX, maxX);
	const closestZ = THREE.MathUtils.clamp(cz, minZ, maxZ);
	const dx = cx - closestX;
	const dz = cz - closestZ;
	return dx * dx + dz * dz < radius * radius;
}

function bodyIntersectsVoxelTerrain(
	terrain: VoxelTerrain,
	collision: VoxelCollisionData,
	actor: FirstPersonActor,
	bodyPosition: THREE.Vector3
): boolean {
	const radius = FIRST_PERSON_COLLISION.BODY_RADIUS;
	const minX = bodyPosition.x - radius;
	const maxX = bodyPosition.x + radius;
	const minZ = bodyPosition.z - radius;
	const maxZ = bodyPosition.z + radius;
	const minY = bodyPosition.y + FIRST_PERSON_COLLISION.FOOT_CLEARANCE;
	const maxY =
		bodyPosition.y +
		Math.max(0.2, getEyeHeight(actor.actor) + FIRST_PERSON_COLLISION.HEAD_CLEARANCE);
	const startVoxelX = Math.max(
		0,
		Math.floor((minX + terrain.Width / 2) * collision.resolution)
	);
	const endVoxelX = Math.min(
		collision.voxelWidth - 1,
		Math.floor((maxX + terrain.Width / 2) * collision.resolution)
	);
	const startVoxelZ = Math.max(
		0,
		Math.floor((minZ + terrain.Length / 2) * collision.resolution)
	);
	const endVoxelZ = Math.min(
		collision.voxelLength - 1,
		Math.floor((maxZ + terrain.Length / 2) * collision.resolution)
	);
	const startVoxelY = Math.max(
		0,
		Math.floor((minY + 0.5) * collision.resolution)
	);
	const endVoxelY = Math.min(
		collision.voxelHeight - 1,
		Math.floor((maxY + 0.5) * collision.resolution)
	);

	if (
		startVoxelX > endVoxelX ||
		startVoxelY > endVoxelY ||
		startVoxelZ > endVoxelZ
	) {
		return false;
	}

	for (let voxelY = startVoxelY; voxelY <= endVoxelY; voxelY++) {
		for (let voxelZ = startVoxelZ; voxelZ <= endVoxelZ; voxelZ++) {
			for (let voxelX = startVoxelX; voxelX <= endVoxelX; voxelX++) {
				if (!collision.occupied.has(voxelCollisionKey(voxelX, voxelY, voxelZ))) {
					continue;
				}

				const voxelMinX = voxelX / collision.resolution - terrain.Width / 2;
				const voxelMaxX = voxelMinX + collision.voxelSize;
				const voxelMinZ = voxelZ / collision.resolution - terrain.Length / 2;
				const voxelMaxZ = voxelMinZ + collision.voxelSize;
				if (
					circleIntersectsAabb2D(
						bodyPosition.x,
						bodyPosition.z,
						radius,
						voxelMinX,
						voxelMaxX,
						voxelMinZ,
						voxelMaxZ
					)
				) {
					return true;
				}
			}
		}
	}

	return false;
}

function getGroundWorldYAtHeight(
	actor: FirstPersonActor,
	terrain: VoxelTerrain,
	tile: Pick<LegalTile, "x" | "y">,
	h: number
): number {
	if (actor.actor.CanFly) {
		return terrainHeightToWorldY(h) + ACTOR_TOKEN_PLACEMENT.BASE_Y_OFFSET;
	}

	return actorPositionToGroundWorld(actor, terrain, {
		x: tile.x,
		y: tile.y,
		h,
	}).y;
}

function prepareLegalCandidate(
	terrain: VoxelTerrain,
	actor: FirstPersonActor,
	candidate: THREE.Vector3,
	candidateH: number,
	currentBodyPosition: THREE.Vector3,
	currentH: number,
	legalTilesByColumn: Map<string, LegalTile[]>
): ResolvedFirstPersonMovement | null {
	let legalTile = chooseLegalTile(
		terrain,
		candidate,
		candidateH,
		legalTilesByColumn
	);
	let acceptedCandidate = candidate;
	if (!legalTile) {
		const currentTile = chooseLegalTile(
			terrain,
			currentBodyPosition,
			currentH,
			legalTilesByColumn
		);
		if (!currentTile) return null;

		legalTile = currentTile;
		acceptedCandidate = clampAgainstBlockedNeighbors(
			terrain,
			candidate,
			currentTile,
			legalTilesByColumn
		);
	}

	const constrainedCandidate = clampAgainstBlockedNeighbors(
		terrain,
		acceptedCandidate,
		legalTile,
		legalTilesByColumn
	);
	const bodyH =
		actor.actor.CanFly
			? clampHeightToLegalColumn(legalTile, candidateH, legalTilesByColumn)
			: legalTile.h;
	constrainedCandidate.y = getGroundWorldYAtHeight(
		actor,
		terrain,
		legalTile,
		bodyH
	);
	return { bodyPosition: constrainedCandidate, tile: legalTile, bodyH };
}

function candidateIsClear(
	terrain: VoxelTerrain,
	collision: VoxelCollisionData | null,
	actor: FirstPersonActor,
	candidate: ResolvedFirstPersonMovement | null
): candidate is ResolvedFirstPersonMovement {
	if (!candidate) return false;
	return !collision || !bodyIntersectsVoxelTerrain(
		terrain,
		collision,
		actor,
		candidate.bodyPosition
	);
}

function sameMovementState(
	aPosition: THREE.Vector3,
	aH: number,
	bPosition: THREE.Vector3,
	bH: number
): boolean {
	return (
		Math.abs(aPosition.x - bPosition.x) < 0.0001 &&
		Math.abs(aPosition.z - bPosition.z) < 0.0001 &&
		Math.abs(aH - bH) < 0.0001
	);
}

export function resolveFirstPersonMovement(
	terrain: VoxelTerrain,
	collision: VoxelCollisionData | null,
	actor: FirstPersonActor,
	currentBodyPosition: THREE.Vector3,
	currentH: number,
	candidate: THREE.Vector3,
	candidateH: number,
	legalTilesByColumn: Map<string, LegalTile[]>
): ResolvedFirstPersonMovement | null {
	const fullCandidate = prepareLegalCandidate(
		terrain,
		actor,
		candidate,
		candidateH,
		currentBodyPosition,
		currentH,
		legalTilesByColumn
	);
	if (candidateIsClear(terrain, collision, actor, fullCandidate)) {
		return fullCandidate;
	}

	let nextPosition = currentBodyPosition.clone();
	let nextH = currentH;
	let nextTile: LegalTile | null = null;
	const axes: Array<"x" | "z" | "h"> = actor.actor.CanFly
		? ["x", "z", "h"]
		: ["x", "z"];

	for (const axis of axes) {
		const axisPosition = nextPosition.clone();
		let axisH = nextH;
		if (axis === "x") {
			axisPosition.x = candidate.x;
		} else if (axis === "z") {
			axisPosition.z = candidate.z;
		} else {
			axisH = candidateH;
		}

		const axisCandidate = prepareLegalCandidate(
			terrain,
			actor,
			axisPosition,
			axisH,
			nextPosition,
			nextH,
			legalTilesByColumn
		);
		if (!candidateIsClear(terrain, collision, actor, axisCandidate)) continue;
		if (
			sameMovementState(
				nextPosition,
				nextH,
				axisCandidate.bodyPosition,
				axisCandidate.bodyH
			)
		) {
			continue;
		}
		nextPosition = axisCandidate.bodyPosition;
		nextH = axisCandidate.bodyH;
		nextTile = axisCandidate.tile;
	}

	if (!nextTile) return null;
	return { bodyPosition: nextPosition, tile: nextTile, bodyH: nextH };
}
