import * as THREE from "three";
import type { Position } from "../../../domains/Actor/Actor";
import type { VoxelTerrain } from "../../../domains/VoxelTerrain/VoxelTerrain";
import type { VoxelTerrainIndex } from "../../../utils/terrain/data/VoxelTerrainIndex";
import {
	ACTOR_TOKEN_DESCRIPTOR_DEFAULTS,
	ACTOR_TOKEN_PLACEMENT,
} from "../Actors3D/actorTokenConstants";
import { actorToGroundWorld, getEyeHeight } from "./actor";
import {
	FIRST_PERSON_CONTROLS,
	FIRST_PERSON_PHYSICS,
} from "./constants";
import type { FirstPersonActor } from "./types";

export interface FirstPersonCapsuleState {
	position: THREE.Vector3;
	velocity: THREE.Vector3;
	grounded: boolean;
}

interface CapsuleDimensions {
	radius: number;
	height: number;
}

interface CapsuleFrameInput {
	forwardInput: number;
	rightInput: number;
	verticalInput: number;
	jumpPressed: boolean;
	yaw: number;
	dt: number;
}

interface AxisMoveResult {
	blocked: boolean;
}

function clamp(value: number, min: number, max: number): number {
	if (min > max) return (min + max) / 2;
	return Math.max(min, Math.min(max, value));
}

function moveToward(current: number, target: number, maxDelta: number): number {
	if (Math.abs(target - current) <= maxDelta) return target;
	return current + Math.sign(target - current) * maxDelta;
}

function moveVectorToward(
	currentX: number,
	currentZ: number,
	targetX: number,
	targetZ: number,
	maxDelta: number
): { x: number; z: number } {
	const dx = targetX - currentX;
	const dz = targetZ - currentZ;
	const distance = Math.hypot(dx, dz);
	if (distance <= maxDelta || distance === 0) {
		return { x: targetX, z: targetZ };
	}

	const scale = maxDelta / distance;
	return {
		x: currentX + dx * scale,
		z: currentZ + dz * scale,
	};
}

function intervalDistance(
	minA: number,
	maxA: number,
	minB: number,
	maxB: number
): number {
	if (maxA < minB) return minB - maxA;
	if (maxB < minA) return minA - maxB;
	return 0;
}

function pointIntervalDistance(value: number, min: number, max: number): number {
	if (value < min) return min - value;
	if (value > max) return value - max;
	return 0;
}

function getCapsuleDimensions(actor: FirstPersonActor): CapsuleDimensions {
	const size = actor.actor.Size ?? ACTOR_TOKEN_DESCRIPTOR_DEFAULTS.SIZE;
	const radius = FIRST_PERSON_PHYSICS.RADIUS_BY_SIZE[size];
	const height = Math.max(
		radius * 2 + 0.05,
		getEyeHeight(actor.actor) + FIRST_PERSON_PHYSICS.CAPSULE_HEAD_CLEARANCE
	);
	return { radius, height };
}

function getHorizontalBounds(
	terrain: VoxelTerrain,
	dimensions: CapsuleDimensions
): { minX: number; maxX: number; minZ: number; maxZ: number } {
	const inset = dimensions.radius + FIRST_PERSON_PHYSICS.COLLISION_EPSILON;
	return {
		minX: -terrain.Width / 2 + inset,
		maxX: terrain.Width / 2 - inset,
		minZ: -terrain.Length / 2 + inset,
		maxZ: terrain.Length / 2 - inset,
	};
}

function getStepHeight(index: VoxelTerrainIndex): number {
	return Math.min(
		FIRST_PERSON_PHYSICS.STEP_HEIGHT,
		index.voxelSize + FIRST_PERSON_PHYSICS.STEP_HEIGHT_MARGIN
	);
}

function clampPositionToBounds(
	terrain: VoxelTerrain,
	dimensions: CapsuleDimensions,
	position: THREE.Vector3
): boolean {
	const bounds = getHorizontalBounds(terrain, dimensions);
	const nextX = clamp(position.x, bounds.minX, bounds.maxX);
	const nextZ = clamp(position.z, bounds.minZ, bounds.maxZ);
	const changed =
		Math.abs(nextX - position.x) > FIRST_PERSON_PHYSICS.COLLISION_EPSILON ||
		Math.abs(nextZ - position.z) > FIRST_PERSON_PHYSICS.COLLISION_EPSILON;
	position.x = nextX;
	position.z = nextZ;
	if (position.y < FIRST_PERSON_PHYSICS.MIN_WORLD_Y) {
		position.y = FIRST_PERSON_PHYSICS.MIN_WORLD_Y;
		return true;
	}
	return changed;
}

function capsuleIntersectsAabb(
	position: THREE.Vector3,
	dimensions: CapsuleDimensions,
	minX: number,
	maxX: number,
	minY: number,
	maxY: number,
	minZ: number,
	maxZ: number
): boolean {
	const radius = dimensions.radius;
	const segmentMinY = position.y + radius;
	const segmentMaxY = Math.max(
		segmentMinY,
		position.y + dimensions.height - radius
	);
	const dx = pointIntervalDistance(position.x, minX, maxX);
	const dy = intervalDistance(segmentMinY, segmentMaxY, minY, maxY);
	const dz = pointIntervalDistance(position.z, minZ, maxZ);
	return (
		dx * dx + dy * dy + dz * dz <
		radius * radius - FIRST_PERSON_PHYSICS.COLLISION_EPSILON
	);
}

function capsuleIntersectsTerrain(
	terrain: VoxelTerrain,
	index: VoxelTerrainIndex,
	dimensions: CapsuleDimensions,
	position: THREE.Vector3
): boolean {
	const radius = dimensions.radius;
	const minX = position.x - radius;
	const maxX = position.x + radius;
	const minY = position.y;
	const maxY = position.y + dimensions.height;
	const minZ = position.z - radius;
	const maxZ = position.z + radius;
	const startVoxelX = Math.max(
		0,
		Math.floor((minX + terrain.Width / 2) * index.resolution)
	);
	const endVoxelX = Math.min(
		index.voxelWidth - 1,
		Math.floor((maxX + terrain.Width / 2) * index.resolution)
	);
	const startVoxelY = Math.max(
		0,
		Math.floor((minY + 0.5) * index.resolution)
	);
	const endVoxelY = Math.min(
		index.voxelHeight - 1,
		Math.floor((maxY + 0.5) * index.resolution)
	);
	const startVoxelZ = Math.max(
		0,
		Math.floor((minZ + terrain.Length / 2) * index.resolution)
	);
	const endVoxelZ = Math.min(
		index.voxelLength - 1,
		Math.floor((maxZ + terrain.Length / 2) * index.resolution)
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
				if (!index.hasVoxel(voxelX, voxelY, voxelZ)) {
					continue;
				}

				const voxelMinX = voxelX / index.resolution - terrain.Width / 2;
				const voxelMaxX = voxelMinX + index.voxelSize;
				const voxelMinY = voxelY / index.resolution - 0.5;
				const voxelMaxY = voxelMinY + index.voxelSize;
				const voxelMinZ = voxelZ / index.resolution - terrain.Length / 2;
				const voxelMaxZ = voxelMinZ + index.voxelSize;
				if (
					capsuleIntersectsAabb(
						position,
						dimensions,
						voxelMinX,
						voxelMaxX,
						voxelMinY,
						voxelMaxY,
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

function liftOutOfTerrain(
	terrain: VoxelTerrain,
	index: VoxelTerrainIndex,
	dimensions: CapsuleDimensions,
	state: FirstPersonCapsuleState
): void {
	if (!capsuleIntersectsTerrain(terrain, index, dimensions, state.position)) {
		return;
	}

	for (let attempt = 0; attempt < 48; attempt++) {
		state.position.y += 0.05;
		if (!capsuleIntersectsTerrain(terrain, index, dimensions, state.position)) {
			state.velocity.y = Math.max(0, state.velocity.y);
			state.grounded = false;
			return;
		}
	}
}

function moveAxis(
	terrain: VoxelTerrain,
	index: VoxelTerrainIndex,
	dimensions: CapsuleDimensions,
	state: FirstPersonCapsuleState,
	axis: "x" | "y" | "z",
	delta: number
): AxisMoveResult {
	if (Math.abs(delta) <= FIRST_PERSON_PHYSICS.COLLISION_EPSILON) {
		return { blocked: false };
	}

	const original = state.position[axis];
	let target = original + delta;
	let hitBounds = false;
	if (axis === "x" || axis === "z") {
		const bounds = getHorizontalBounds(terrain, dimensions);
		const min = axis === "x" ? bounds.minX : bounds.minZ;
		const max = axis === "x" ? bounds.maxX : bounds.maxZ;
		const clampedTarget = clamp(target, min, max);
		hitBounds =
			Math.abs(clampedTarget - target) >
			FIRST_PERSON_PHYSICS.COLLISION_EPSILON;
		target = clampedTarget;
	} else if (target < FIRST_PERSON_PHYSICS.MIN_WORLD_Y) {
		target = FIRST_PERSON_PHYSICS.MIN_WORLD_Y;
		hitBounds = true;
	}

	const actualDelta = target - original;
	state.position[axis] = target;
	if (!capsuleIntersectsTerrain(terrain, index, dimensions, state.position)) {
		if (hitBounds) {
			state.velocity[axis] = 0;
		}
		return { blocked: hitBounds };
	}

	let low = 0;
	let high = 1;
	state.position[axis] = original;
	for (let iteration = 0; iteration < 12; iteration++) {
		const mid = (low + high) / 2;
		state.position[axis] = original + actualDelta * mid;
		if (capsuleIntersectsTerrain(terrain, index, dimensions, state.position)) {
			high = mid;
		} else {
			low = mid;
		}
	}

	state.position[axis] = original + actualDelta * low;
	state.velocity[axis] = 0;
	return { blocked: true };
}

function moveHorizontalAxes(
	terrain: VoxelTerrain,
	index: VoxelTerrainIndex,
	dimensions: CapsuleDimensions,
	state: FirstPersonCapsuleState,
	deltaX: number,
	deltaZ: number
): AxisMoveResult {
	const xFirst = Math.abs(deltaX) >= Math.abs(deltaZ);
	const first = xFirst ? "x" : "z";
	const second = xFirst ? "z" : "x";
	const firstDelta = xFirst ? deltaX : deltaZ;
	const secondDelta = xFirst ? deltaZ : deltaX;
	const firstResult = moveAxis(
		terrain,
		index,
		dimensions,
		state,
		first,
		firstDelta
	);
	const secondResult = moveAxis(
		terrain,
		index,
		dimensions,
		state,
		second,
		secondDelta
	);
	return { blocked: firstResult.blocked || secondResult.blocked };
}

function findGroundBelow(
	terrain: VoxelTerrain,
	index: VoxelTerrainIndex,
	dimensions: CapsuleDimensions,
	position: THREE.Vector3,
	maxDistance: number
): number | null {
	if (capsuleIntersectsTerrain(terrain, index, dimensions, position)) {
		return null;
	}

	const startY = position.y;
	const probe = position.clone();
	probe.y = startY - maxDistance;
	if (!capsuleIntersectsTerrain(terrain, index, dimensions, probe)) {
		return null;
	}

	let low = probe.y;
	let high = startY;
	for (let iteration = 0; iteration < 14; iteration++) {
		const mid = (low + high) / 2;
		probe.y = mid;
		if (capsuleIntersectsTerrain(terrain, index, dimensions, probe)) {
			low = mid;
		} else {
			high = mid;
		}
	}

	return high;
}

function snapToGround(
	terrain: VoxelTerrain,
	index: VoxelTerrainIndex,
	dimensions: CapsuleDimensions,
	state: FirstPersonCapsuleState,
	maxDistance: number
): boolean {
	const groundY = findGroundBelow(
		terrain,
		index,
		dimensions,
		state.position,
		maxDistance
	);
	if (groundY === null) return false;

	state.position.y = groundY;
	state.velocity.y = 0;
	return true;
}

function findStepUpGroundY(
	terrain: VoxelTerrain,
	index: VoxelTerrainIndex,
	dimensions: CapsuleDimensions,
	position: THREE.Vector3,
	maxStepHeight: number
): number | null {
	// Find the first clear resting height instead of requiring the capsule to
	// fit at the maximum step height, which can falsely reject low ceilings.
	const probe = position.clone();
	if (!capsuleIntersectsTerrain(terrain, index, dimensions, probe)) {
		return null;
	}

	const startY = position.y;
	const maxY = startY + maxStepHeight;
	const scanStep = Math.max(
		index.voxelSize / 4,
		FIRST_PERSON_PHYSICS.COLLISION_EPSILON * 4
	);
	const steps = Math.max(1, Math.ceil(maxStepHeight / scanStep));
	let blockedY = startY;

	for (let step = 1; step <= steps; step++) {
		probe.y = Math.min(maxY, startY + scanStep * step);
		if (capsuleIntersectsTerrain(terrain, index, dimensions, probe)) {
			blockedY = probe.y;
			continue;
		}

		let low = blockedY;
		let high = probe.y;
		for (let iteration = 0; iteration < 14; iteration++) {
			const mid = (low + high) / 2;
			probe.y = mid;
			if (capsuleIntersectsTerrain(terrain, index, dimensions, probe)) {
				low = mid;
			} else {
				high = mid;
			}
		}
		return high;
	}

	return null;
}

function horizontalProgress(
	from: THREE.Vector3,
	to: THREE.Vector3,
	deltaX: number,
	deltaZ: number
): number {
	const length = Math.hypot(deltaX, deltaZ);
	if (length <= FIRST_PERSON_PHYSICS.COLLISION_EPSILON) return 0;
	return ((to.x - from.x) * deltaX + (to.z - from.z) * deltaZ) / length;
}

function tryGroundedEndpointMove(
	terrain: VoxelTerrain,
	index: VoxelTerrainIndex,
	dimensions: CapsuleDimensions,
	state: FirstPersonCapsuleState,
	deltaX: number,
	deltaZ: number,
	stepHeight: number
): boolean {
	const probe = state.position.clone();
	probe.x += deltaX;
	probe.z += deltaZ;

	const groundY = findStepUpGroundY(
		terrain,
		index,
		dimensions,
		probe,
		stepHeight
	);
	if (groundY === null) return false;

	const groundDelta = groundY - state.position.y;
	if (
		groundDelta > stepHeight + FIRST_PERSON_PHYSICS.COLLISION_EPSILON ||
		groundDelta < -FIRST_PERSON_PHYSICS.STEP_DOWN_SNAP_DISTANCE
	) {
		return false;
	}

	probe.y = groundY;
	if (capsuleIntersectsTerrain(terrain, index, dimensions, probe)) {
		return false;
	}

	state.position.copy(probe);
	state.velocity.y = 0;
	state.grounded = true;
	return true;
}

function applyHorizontalMoveWithStep(
	terrain: VoxelTerrain,
	index: VoxelTerrainIndex,
	dimensions: CapsuleDimensions,
	state: FirstPersonCapsuleState,
	deltaX: number,
	deltaZ: number
): void {
	const originalPosition = state.position.clone();
	const originalVelocity = state.velocity.clone();
	const normalState: FirstPersonCapsuleState = {
		position: originalPosition.clone(),
		velocity: originalVelocity.clone(),
		grounded: state.grounded,
	};
	const normalResult = moveHorizontalAxes(
		terrain,
		index,
		dimensions,
		normalState,
		deltaX,
		deltaZ
	);

	if (
		!normalResult.blocked ||
		!state.grounded ||
		Math.hypot(deltaX, deltaZ) <= FIRST_PERSON_PHYSICS.COLLISION_EPSILON
	) {
		state.position.copy(normalState.position);
		state.velocity.copy(normalState.velocity);
		return;
	}

	const stepHeight = getStepHeight(index);
	if (
		tryGroundedEndpointMove(
			terrain,
			index,
			dimensions,
			state,
			deltaX,
			deltaZ,
			stepHeight
		)
	) {
		return;
	}

	const stepState: FirstPersonCapsuleState = {
		position: originalPosition
			.clone()
			.add(new THREE.Vector3(0, stepHeight, 0)),
		velocity: originalVelocity.clone(),
		grounded: false,
	};
	if (capsuleIntersectsTerrain(terrain, index, dimensions, stepState.position)) {
		state.position.copy(normalState.position);
		state.velocity.copy(normalState.velocity);
		return;
	}

	moveHorizontalAxes(
		terrain,
		index,
		dimensions,
		stepState,
		deltaX,
		deltaZ
	);
	const groundY = findGroundBelow(
		terrain,
		index,
		dimensions,
		stepState.position,
		stepHeight + FIRST_PERSON_PHYSICS.GROUND_SNAP_DISTANCE
	);
	if (
		groundY === null ||
		groundY - originalPosition.y >
			stepHeight + FIRST_PERSON_PHYSICS.COLLISION_EPSILON
	) {
		state.position.copy(normalState.position);
		state.velocity.copy(normalState.velocity);
		return;
	}

	stepState.position.y = groundY;
	if (capsuleIntersectsTerrain(terrain, index, dimensions, stepState.position)) {
		state.position.copy(normalState.position);
		state.velocity.copy(normalState.velocity);
		return;
	}

	const normalProgress = horizontalProgress(
		originalPosition,
		normalState.position,
		deltaX,
		deltaZ
	);
	const stepProgress = horizontalProgress(
		originalPosition,
		stepState.position,
		deltaX,
		deltaZ
	);
	const steppedUp =
		groundY - originalPosition.y >= FIRST_PERSON_PHYSICS.STEP_UP_MIN_HEIGHT;
	if (
		(!steppedUp && stepProgress <= normalProgress + 0.015) ||
		(steppedUp &&
			stepProgress + FIRST_PERSON_PHYSICS.STEP_PROGRESS_TOLERANCE <
				normalProgress)
	) {
		state.position.copy(normalState.position);
		state.velocity.copy(normalState.velocity);
		return;
	}

	state.position.copy(stepState.position);
	state.velocity.copy(stepState.velocity);
	state.velocity.y = 0;
	state.grounded = true;
}

function applyGroundedAndAirVelocity(
	state: FirstPersonCapsuleState,
	wishX: number,
	wishZ: number,
	jumpPressed: boolean,
	dt: number
): void {
	const desiredX = wishX * FIRST_PERSON_CONTROLS.MOVE_UNITS_PER_SECOND;
	const desiredZ = wishZ * FIRST_PERSON_CONTROLS.MOVE_UNITS_PER_SECOND;
	const wishActive =
		Math.hypot(wishX, wishZ) > FIRST_PERSON_PHYSICS.COLLISION_EPSILON;

	if (state.grounded && jumpPressed) {
		state.velocity.y = Math.sqrt(
			2 * FIRST_PERSON_PHYSICS.GRAVITY * FIRST_PERSON_PHYSICS.JUMP_HEIGHT
		);
		state.grounded = false;
	}

	if (wishActive) {
		const acceleration = state.grounded
			? FIRST_PERSON_PHYSICS.GROUND_ACCELERATION
			: FIRST_PERSON_PHYSICS.AIR_ACCELERATION;
		const next = moveVectorToward(
			state.velocity.x,
			state.velocity.z,
			desiredX,
			desiredZ,
			acceleration * dt
		);
		state.velocity.x = next.x;
		state.velocity.z = next.z;
	} else if (state.grounded) {
		const frictionDelta = FIRST_PERSON_PHYSICS.GROUND_FRICTION * dt;
		state.velocity.x = moveToward(state.velocity.x, 0, frictionDelta);
		state.velocity.z = moveToward(state.velocity.z, 0, frictionDelta);
	} else {
		const drag = Math.max(0, 1 - FIRST_PERSON_PHYSICS.AIR_DRAG * dt);
		state.velocity.x *= drag;
		state.velocity.z *= drag;
	}

	state.velocity.y -= FIRST_PERSON_PHYSICS.GRAVITY * dt;
}

function applyFlyingVelocity(
	state: FirstPersonCapsuleState,
	wishX: number,
	wishZ: number,
	verticalInput: number,
	dt: number
): void {
	const desiredX = wishX * FIRST_PERSON_CONTROLS.MOVE_UNITS_PER_SECOND;
	const desiredZ = wishZ * FIRST_PERSON_CONTROLS.MOVE_UNITS_PER_SECOND;
	const desiredY = verticalInput * FIRST_PERSON_CONTROLS.FLY_UNITS_PER_SECOND;
	const nextHorizontal = moveVectorToward(
		state.velocity.x,
		state.velocity.z,
		desiredX,
		desiredZ,
		FIRST_PERSON_PHYSICS.FLY_ACCELERATION * dt
	);
	state.velocity.x = nextHorizontal.x;
	state.velocity.z = nextHorizontal.z;
	state.velocity.y = moveToward(
		state.velocity.y,
		desiredY,
		FIRST_PERSON_PHYSICS.FLY_ACCELERATION * dt
	);

	if (
		Math.hypot(wishX, wishZ) <= FIRST_PERSON_PHYSICS.COLLISION_EPSILON &&
		verticalInput === 0
	) {
		const damping = Math.max(0, 1 - FIRST_PERSON_PHYSICS.FLY_DAMPING * dt);
		state.velocity.multiplyScalar(damping);
	}
	state.grounded = false;
}

function getWishDirection(input: CapsuleFrameInput): THREE.Vector3 {
	const forward = new THREE.Vector3(
		-Math.sin(input.yaw),
		0,
		-Math.cos(input.yaw)
	);
	const right = new THREE.Vector3(
		Math.cos(input.yaw),
		0,
		-Math.sin(input.yaw)
	);
	const wish = forward
		.multiplyScalar(input.forwardInput)
		.add(right.multiplyScalar(input.rightInput));
	if (wish.lengthSq() > 1) {
		wish.normalize();
	}
	return wish;
}

export function createFirstPersonCapsuleState(
	actor: FirstPersonActor,
	terrain: VoxelTerrain
): FirstPersonCapsuleState {
	return {
		position: actorToGroundWorld(actor, terrain),
		velocity: new THREE.Vector3(),
		grounded: !(actor.actor.CanFly ?? false),
	};
}

export function stepFirstPersonCapsuleController(
	terrain: VoxelTerrain,
	index: VoxelTerrainIndex,
	actor: FirstPersonActor,
	state: FirstPersonCapsuleState,
	input: CapsuleFrameInput
): void {
	const dt = Math.max(0, input.dt);
	if (dt <= 0) return;

	const dimensions = getCapsuleDimensions(actor);
	clampPositionToBounds(terrain, dimensions, state.position);
	liftOutOfTerrain(terrain, index, dimensions, state);

	const wish = getWishDirection(input);
	const canFly = actor.actor.CanFly ?? false;
	if (canFly) {
		applyFlyingVelocity(state, wish.x, wish.z, input.verticalInput, dt);
	} else {
		applyGroundedAndAirVelocity(
			state,
			wish.x,
			wish.z,
			input.jumpPressed,
			dt
		);
	}

	const maxDistance = Math.max(
		Math.abs(state.velocity.x),
		Math.abs(state.velocity.y),
		Math.abs(state.velocity.z)
	) * dt;
	const substeps = Math.max(
		1,
		Math.min(
			FIRST_PERSON_PHYSICS.MAX_SUBSTEPS,
			Math.ceil(maxDistance / FIRST_PERSON_PHYSICS.MAX_SUBSTEP_DISTANCE)
		)
	);
	const subDt = dt / substeps;

	for (let step = 0; step < substeps; step++) {
		const deltaX = state.velocity.x * subDt;
		const deltaY = state.velocity.y * subDt;
		const deltaZ = state.velocity.z * subDt;

		if (canFly) {
			moveHorizontalAxes(terrain, index, dimensions, state, deltaX, deltaZ);
			moveAxis(terrain, index, dimensions, state, "y", deltaY);
			continue;
		}

		applyHorizontalMoveWithStep(
			terrain,
			index,
			dimensions,
			state,
			deltaX,
			deltaZ
		);

		const wasMovingDown = deltaY <= 0;
		const verticalResult = moveAxis(
			terrain,
			index,
			dimensions,
			state,
			"y",
			deltaY
		);
		if (verticalResult.blocked) {
			state.grounded = wasMovingDown;
		} else if (deltaY > FIRST_PERSON_PHYSICS.COLLISION_EPSILON) {
			state.grounded = false;
		}

		if (state.velocity.y <= 0) {
			const snapDistance = state.grounded
				? FIRST_PERSON_PHYSICS.STEP_DOWN_SNAP_DISTANCE
				: FIRST_PERSON_PHYSICS.GROUND_SNAP_DISTANCE;
			state.grounded = snapToGround(
				terrain,
				index,
				dimensions,
				state,
				snapDistance
			);
		}
	}

	clampPositionToBounds(terrain, dimensions, state.position);
}

export function worldPositionToRulesPosition(
	terrain: VoxelTerrain,
	worldX: number,
	worldY: number,
	worldZ: number
): Position {
	const offsetX = (terrain.Width - 1) / 2;
	const offsetZ = (terrain.Length - 1) / 2;
	const h =
		worldY -
		ACTOR_TOKEN_PLACEMENT.TERRAIN_WORLD_Y_OFFSET -
		ACTOR_TOKEN_PLACEMENT.BASE_Y_OFFSET;

	// Use a small epsilon before flooring to absorb the ~0.01 undershoot that
	// the capsule binary search introduces (the capsule rests just clear of the
	// voxel surface, so world-Y converts to h_raw slightly below the exact
	// rules-space surface height). 0.1 is safely above the observed undershoot
	// and well below the tightest safe ceiling of 1/R = 0.25 at resolution 4.
	const H_FLOOR_EPSILON = 0.1;
	return {
		x: Math.round(clamp(worldX + offsetX, 0, terrain.Width - 1)),
		y: Math.round(clamp(worldZ + offsetZ, 0, terrain.Length - 1)),
		h: Math.floor(h + H_FLOOR_EPSILON),
	};
}

export function firstPersonCapsuleToRulesPosition(
	terrain: VoxelTerrain,
	state: FirstPersonCapsuleState
): Position {
	return worldPositionToRulesPosition(
		terrain,
		state.position.x,
		state.position.y,
		state.position.z
	);
}

export function isFirstPersonCapsuleSettled(
	state: FirstPersonCapsuleState,
	canFly: boolean
): boolean {
	const speedSq = state.velocity.lengthSq();
	const thresholdSq =
		FIRST_PERSON_PHYSICS.SETTLED_SPEED *
		FIRST_PERSON_PHYSICS.SETTLED_SPEED;
	if (canFly) return speedSq <= thresholdSq;

	return state.grounded && speedSq <= thresholdSq;
}
