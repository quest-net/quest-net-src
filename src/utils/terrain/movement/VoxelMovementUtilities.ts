import type { Position } from "../../../domains/Actor/Actor";
import type { Character } from "../../../domains/Character/Character";
import type { Entity } from "../../../domains/Entity/Entity";
import type { MovementSettings } from "../../../domains/CampaignSetting/CampaignSetting";
import type { VoxelTerrain } from "../../../domains/VoxelTerrain/VoxelTerrain";
import { isItemEntity } from "../../../domains/Item/ItemDropUtils";
import {
	getVoxelTerrainIndex,
	type VoxelTerrainIndex,
} from "../data/VoxelTerrainIndex";
import {
	getVoxelMovementAdjacency,
	VOXEL_MOVEMENT_DIRECTIONS,
	type VoxelMovementAdjacency,
} from "./VoxelMovementAdjacency";

export interface VoxelMovementTile {
	x: number;
	y: number;
	h: number;
	cost: number;
}

export interface VoxelMovementRangeResult {
	tiles: VoxelMovementTile[];
	costs: Map<string, number>;
}

interface PathNode {
	x: number;
	y: number;
	h: number;
}

class PriorityQueue<T> {
	private items: Array<{ value: T; priority: number }> = [];

	enqueue(value: T, priority: number): void {
		this.items.push({ value, priority });
		this.bubbleUp(this.items.length - 1);
	}

	dequeue(): T | undefined {
		if (this.items.length === 0) return undefined;
		if (this.items.length === 1) return this.items.pop()!.value;

		const result = this.items[0].value;
		this.items[0] = this.items.pop()!;
		this.bubbleDown(0);
		return result;
	}

	isEmpty(): boolean {
		return this.items.length === 0;
	}

	private bubbleUp(index: number): void {
		while (index > 0) {
			const parentIndex = Math.floor((index - 1) / 2);
			if (this.items[index].priority >= this.items[parentIndex].priority) break;
			[this.items[index], this.items[parentIndex]] = [
				this.items[parentIndex],
				this.items[index],
			];
			index = parentIndex;
		}
	}

	private bubbleDown(index: number): void {
		while (true) {
			const leftChild = 2 * index + 1;
			const rightChild = 2 * index + 2;
			let smallest = index;

			if (
				leftChild < this.items.length &&
				this.items[leftChild].priority < this.items[smallest].priority
			) {
				smallest = leftChild;
			}
			if (
				rightChild < this.items.length &&
				this.items[rightChild].priority < this.items[smallest].priority
			) {
				smallest = rightChild;
			}
			if (smallest === index) break;

			[this.items[index], this.items[smallest]] = [
				this.items[smallest],
				this.items[index],
			];
			index = smallest;
		}
	}
}

export function getVoxelTileHeightKey(x: number, y: number, h: number): string {
	return `${x},${y},${h}`;
}

export function normalizeVoxelPosition(position: Position): Position {
	return {
		x: Math.round(position.x),
		y: Math.round(position.y),
		h: Math.round(position.h),
	};
}

export function isVoxelTileInBounds(
	terrain: VoxelTerrain,
	x: number,
	y: number
): boolean {
	return x >= 0 && x < terrain.Width && y >= 0 && y < terrain.Length;
}

/**
 * Returns all walkable surface heights at tactical tile (tileX, tileY) from
 * pre-computed surface data.  An empty array means the column has no voxels.
 */
function getSurfacesAtTile(
	index: VoxelTerrainIndex,
	tileX: number,
	tileY: number
): readonly number[] {
	return index.allSurfaces.get(`${tileX},${tileY}`) ?? [];
}

export function isVoxelTileOccupiedAtHeight(
	x: number,
	y: number,
	h: number,
	characters: Character[],
	entities: Entity[],
	excludeActorId?: string
): boolean {
	for (const character of characters) {
		if (character.Id === excludeActorId) continue;
		const position = normalizeVoxelPosition(character.Position);
		if (position.x === x && position.y === y && position.h === h) {
			return true;
		}
	}

	for (const entity of entities) {
		if (entity.Id === excludeActorId) continue;
		if (isItemEntity(entity)) continue;
		const position = normalizeVoxelPosition(entity.Position);
		if (position.x === x && position.y === y && position.h === h) {
			return true;
		}
	}

	return false;
}

export function canOccupyVoxelTile(
	terrain: VoxelTerrain,
	position: Position,
	characters: Character[],
	entities: Entity[],
	excludeActorId?: string
): boolean {
	const normalized = normalizeVoxelPosition(position);
	if (!isVoxelTileInBounds(terrain, normalized.x, normalized.y)) return false;

	return !isVoxelTileOccupiedAtHeight(
		normalized.x,
		normalized.y,
		normalized.h,
		characters,
		entities,
		excludeActorId
	);
}

function getHeightCost(heightDiff: number, heightCostLookup: number[]): number {
	if (heightDiff <= 0) return 0;
	const lookupIndex = Math.min(heightDiff - 1, heightCostLookup.length - 1);
	return heightCostLookup[lookupIndex] ?? 0;
}

function getMoveSpeedBudget(moveSpeed: number | undefined | null): number {
	const value = Number(moveSpeed);
	return Number.isFinite(value) ? Math.max(0, value) : 0;
}

export function calculateVoxelMovementRange(
	terrain: VoxelTerrain,
	from: Position,
	moveSpeed: number,
	canFly: boolean,
	movementSettings: Pick<
		MovementSettings,
		"heightCostLookup" | "flyingIgnoresHeight"
	>
): VoxelMovementRangeResult {
	const start = normalizeVoxelPosition(from);
	const budget = getMoveSpeedBudget(moveSpeed);
	// costs and bestTiles are now keyed by (x,y,h) so multiple heights per
	// column are tracked independently.
	const costs = new Map<string, number>();
	const bestTiles = new Map<string, VoxelMovementTile>();

	if (!isVoxelTileInBounds(terrain, start.x, start.y)) {
		return { tiles: [], costs };
	}

	const index = getVoxelTerrainIndex(terrain);
	const adjacency: VoxelMovementAdjacency = getVoxelMovementAdjacency(terrain);

	const addBestTile = (x: number, y: number, h: number, cost: number) => {
		const key = getVoxelTileHeightKey(x, y, h);
		const existing = bestTiles.get(key);
		if (!existing || cost < existing.cost) {
			bestTiles.set(key, { x, y, h, cost });
			costs.set(key, cost);
		}
	};

	addBestTile(start.x, start.y, start.h, 0);

	if (budget <= 0) {
		return { tiles: Array.from(bestTiles.values()), costs };
	}

	const queue = new PriorityQueue<PathNode>();
	const nodeCosts = new Map<string, number>();
	const nodeKey = (x: number, y: number, h: number) =>
		`${x},${y},${h}`;

	const startKey = nodeKey(start.x, start.y, start.h);
	nodeCosts.set(startKey, 0);
	queue.enqueue({ x: start.x, y: start.y, h: start.h }, 0);

	while (!queue.isEmpty()) {
		const current = queue.dequeue()!;
		const currentKey = nodeKey(current.x, current.y, current.h);
		const currentCost = nodeCosts.get(currentKey)!;

		// Surface-to-surface neighbors are precomputed per terrain revision in
		// VoxelMovementAdjacency, keyed by direction. The build runs
		// isSurfaceTransitionReachable across every (x, y, h) surface tile and
		// every cardinal step once per revision, so Dijkstra no longer rescans
		// voxel columns for air clearance during traversal -- it just reads
		// the precomputed neighbor heights here. Flier extras (maintain altitude
		// over non-empty columns, cross empty columns at current.h) depend on
		// `current.h` so they're computed inline below.
		const neighborsByDirection = adjacency.getNeighborsByDirection(
			current.x,
			current.y,
			current.h
		);

		for (let d = 0; d < VOXEL_MOVEMENT_DIRECTIONS.length; d++) {
			const { dx, dy } = VOXEL_MOVEMENT_DIRECTIONS[d];
			const nx = current.x + dx;
			const ny = current.y + dy;

			if (!isVoxelTileInBounds(terrain, nx, ny)) continue;

			const walking = neighborsByDirection[d];

			// Candidate destination heights for this direction. Walking heights
			// come from cached adjacency; flier extras are layered on top.
			const candidateHeights: number[] = [];
			for (const n of walking) candidateHeights.push(n.h);

			if (canFly) {
				const surfaceList = getSurfacesAtTile(index, nx, ny);
				if (surfaceList.length === 0) {
					// Empty tile -- flying actor can cross at current altitude.
					candidateHeights.push(current.h);
					if (current.h !== 0) candidateHeights.push(0);
				} else if (!walking.some((n) => n.h === current.h)) {
					// Flier maintains altitude over non-empty terrain only when
					// current.h is not already a walking-reachable neighbor.
					candidateHeights.push(current.h);
				}
			}

			for (const targetH of candidateHeights) {
				let stepCost = 1;
				const heightDiff = targetH - current.h;

				if (heightDiff > 0 && !(canFly && movementSettings.flyingIgnoresHeight)) {
					// Non-flying actors (or fliers when the setting does not waive
					// height costs) pay the configured climb cost. Fliers with
					// `flyingIgnoresHeight` ascend freely, which keeps the state
					// space to (x, y, h) and prevents the Dijkstra blowup that
					// crashed the tab when entering FP on a flier.
					stepCost += getHeightCost(
						heightDiff,
						movementSettings.heightCostLookup
					);
				}

				const newCost = currentCost + stepCost;
				if (newCost > budget) continue;

				const nextKey = nodeKey(nx, ny, targetH);
				const existingCost = nodeCosts.get(nextKey);
				if (existingCost !== undefined && existingCost <= newCost) continue;

				nodeCosts.set(nextKey, newCost);
				queue.enqueue({ x: nx, y: ny, h: targetH }, newCost);
				addBestTile(nx, ny, targetH, newCost);
			}
		}
	}

	return { tiles: Array.from(bestTiles.values()), costs };
}

export function calculateVoxelRemainingMovementRange(
	terrain: VoxelTerrain,
	current: Position,
	turnStart: Position | undefined,
	moveSpeed: number,
	canFly: boolean,
	movementSettings: Pick<
		MovementSettings,
		"heightCostLookup" | "flyingIgnoresHeight"
	>
): VoxelMovementRangeResult | null {
	if (!turnStart) return null;

	const normalizedCurrent = normalizeVoxelPosition(current);
	const startRange = calculateVoxelMovementRange(
		terrain,
		turnStart,
		moveSpeed,
		canFly,
		movementSettings
	);
	const spentCost = startRange.costs.get(
		getVoxelTileHeightKey(normalizedCurrent.x, normalizedCurrent.y, normalizedCurrent.h)
	);

	if (spentCost === undefined) return null;

	const remainingBudget = getMoveSpeedBudget(moveSpeed) - spentCost;
	if (remainingBudget <= 0) {
		return {
			tiles: [
				{
					...normalizedCurrent,
					cost: 0,
				},
			],
			costs: new Map([[
				getVoxelTileHeightKey(normalizedCurrent.x, normalizedCurrent.y, normalizedCurrent.h),
				0,
			]]),
		};
	}

	return calculateVoxelMovementRange(
		terrain,
		normalizedCurrent,
		remainingBudget,
		canFly,
		movementSettings
	);
}

export function isVoxelMoveInAllowedRange(
	terrain: VoxelTerrain,
	current: Position,
	turnStart: Position | undefined,
	moveSpeed: number | undefined | null,
	canFly: boolean,
	movementSettings: Pick<
		MovementSettings,
		"heightCostLookup" | "flyingIgnoresHeight"
	>,
	isCombatActive: boolean,
	targetX: number,
	targetY: number,
	targetH?: number
): boolean {
	if (!isVoxelTileInBounds(terrain, targetX, targetY)) return false;

	let budget = getMoveSpeedBudget(moveSpeed);

	if (isCombatActive) {
		if (!turnStart) return false;

		const normalizedCurrent = normalizeVoxelPosition(current);
		const { costs: startCosts } = calculateVoxelMovementRange(
			terrain,
			turnStart,
			budget,
			canFly,
			movementSettings
		);
		const spentCost = startCosts.get(
			getVoxelTileHeightKey(normalizedCurrent.x, normalizedCurrent.y, normalizedCurrent.h)
		);
		if (spentCost === undefined) return false;

		budget -= spentCost;
		if (budget <= 0) return false;
	}

	const { tiles } = calculateVoxelMovementRange(
		terrain,
		current,
		budget,
		canFly,
		movementSettings
	);

	if (targetH !== undefined) {
		return tiles.some(
			(tile) => tile.x === targetX && tile.y === targetY && tile.h === targetH
		);
	}
	return tiles.some((tile) => tile.x === targetX && tile.y === targetY);
}
