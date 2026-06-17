import type { Position } from "../Actor/Actor";
import type { Character } from "../Character/Character";
import type { Entity } from "../Entity/Entity";
import type { MovementSettings } from "../CampaignSetting/CampaignSetting";
import type { VoxelTerrain } from "./VoxelTerrain";
import { isItemEntity } from "../Item/ItemDropUtils";
import {
	getVoxelTerrainIndex,
	type VoxelTerrainIndex,
} from "../../utils/terrain/data/VoxelTerrainIndex";
import {
	getVoxelMovementAdjacency,
	isCellStandable,
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
		terrainId: position.terrainId,
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

export function shouldRestrictPlayerMovementToRange(
	userRole: "dm" | "player" | undefined,
	isCombatActive: boolean,
	movementSettings?:
		| Pick<MovementSettings, "restrictPlayerMovementToRange">
		| null
): boolean {
	return (
		userRole === "player" &&
		isCombatActive &&
		(movementSettings?.restrictPlayerMovementToRange ?? false)
	);
}

// ---------------------------------------------------------------------------
// Shared actor physics: the single "where can an actor STAND" authority
// (`canStandVoxel`), consumed by both movement-range pathing (below) and DM-side
// position validation/repair. Two distinct geometric notions feed it, and
// keeping them separate is what makes flyer-standable a superset of
// walker-standable by construction:
//
//   - SURFACE (`allSurfaces`): a walkable surface exists at rules-height h. This
//     is where a non-flyer can put its feet. It is detected per voxel sub-column
//     (an exposed top, floored to rules height), so it can report a surface in a
//     tactical tile even when a taller neighbouring sub-column fills the rest of
//     that rules cell.
//   - CLEARANCE (`isCellStandable`): the rules cell is not *fully* solid across
//     the whole res*res footprint. This is the strict PASSAGE predicate -- it is
//     what stops actors tunnelling through a wall via a one-voxel gap -- and it
//     also serves as the flyer's open-air hover test.
//
// Standing rule:
//   - non-flyer: SURFACE(h)                  (a detected surface is always standable)
//   - flyer:     CLEARANCE(h) OR SURFACE(h)  (open air, or anywhere a walker can stand)
//
// Because SURFACE(h) appears in the flyer clause, every tile a walker can stand
// on a flyer can stand on too. Actor size plays no part here -- it is purely
// visual.
// ---------------------------------------------------------------------------

/**
 * Whether a flyer may occupy the rules cell at (x, y, h): true in open air
 * (`isCellStandable`) OR on any walkable surface (`allSurfaces`). The surface
 * clause is what guarantees flyer-standable >= walker-standable even on rugged
 * sub-tactical terrain where a surface cell is not whole-tile-clear. Callers in
 * the Dijkstra hot loop must have already bounds/height-checked (x, y, h).
 */
function isFlyerStandableCell(
	index: VoxelTerrainIndex,
	x: number,
	y: number,
	h: number
): boolean {
	if (isCellStandable(index, x, y, h)) return true;
	return (index.allSurfaces.get(`${x},${y}`) ?? []).includes(h);
}

/**
 * Highest rules-height an actor may occupy on this terrain. Matches the bound
 * used by position validation so pathing and validation agree on the ceiling.
 */
export function getMaxActorHeight(
	terrain: VoxelTerrain,
	index: VoxelTerrainIndex
): number {
	return Math.ceil(Math.max(terrain.Height, index.maxSurfaceHeight));
}

/**
 * The single standing authority. A non-flyer stands exactly on detected
 * surfaces (`allSurfaces`); a flyer stands on those surfaces OR hovers in any
 * open cell (`isFlyerStandableCell`). Flyer-standable is therefore a superset of
 * walker-standable by construction. (The strict whole-tile clearance rule lives
 * in `isCellStandable` and governs PASSAGE -- climbing through, tunnel
 * prevention -- not standing.)
 */
export function canStandVoxel(
	terrain: VoxelTerrain,
	index: VoxelTerrainIndex,
	x: number,
	y: number,
	h: number,
	canFly: boolean
): boolean {
	if (!isVoxelTileInBounds(terrain, x, y)) return false;
	if (h < 0 || h > getMaxActorHeight(terrain, index)) return false;

	if (canFly) return isFlyerStandableCell(index, x, y, h);

	// Non-flyer: feet must land on an exposed surface at this rules height. A
	// detected surface is always standable -- no separate clearance gate.
	return (index.allSurfaces.get(`${x},${y}`) ?? []).includes(h);
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
	// costs and bestTiles are keyed by (x,y,h) so multiple heights per column
	// (a flier's ladder, or stacked surfaces) are tracked independently.
	const costs = new Map<string, number>();
	const bestTiles = new Map<string, VoxelMovementTile>();

	if (!isVoxelTileInBounds(terrain, start.x, start.y)) {
		return { tiles: [], costs };
	}

	const index = getVoxelTerrainIndex(terrain);
	const maxActorHeight = getMaxActorHeight(terrain, index);
	// Non-flyers traverse the cached surface adjacency graph; flyers flood through
	// any cell they can stand in (open air or a walkable surface, see
	// isFlyerStandableCell) at any height and never touch it.
	const adjacency: VoxelMovementAdjacency | null = canFly
		? null
		: getVoxelMovementAdjacency(terrain);

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
	const nodeKey = (x: number, y: number, h: number) => `${x},${y},${h}`;

	const startKey = nodeKey(start.x, start.y, start.h);
	nodeCosts.set(startKey, 0);
	queue.enqueue({ x: start.x, y: start.y, h: start.h }, 0);

	const relax = (nx: number, ny: number, nh: number, newCost: number) => {
		if (newCost > budget) return;
		const nextKey = nodeKey(nx, ny, nh);
		const existingCost = nodeCosts.get(nextKey);
		if (existingCost !== undefined && existingCost <= newCost) return;
		nodeCosts.set(nextKey, newCost);
		queue.enqueue({ x: nx, y: ny, h: nh }, newCost);
		addBestTile(nx, ny, nh, newCost);
	};

	// Vertical cost for a flier to occupy rules-height `h`, measured as the NET
	// ascent above the start height the flood originates from. When
	// `flyingIgnoresHeight` is on, climbing is capped at 1 per height level while
	// still respecting cheaper lookup formulas: total climb cost is
	// min(lookup(dh), dh). When off, a flier pays the normal height-cost lookup.
	// Dropping back toward (or below) the start costs nothing. The ladder edges
	// below add the per-level increment of this total so a contiguous climb
	// telescopes exactly to it.
	const verticalCostAtHeight = (h: number): number => {
		const netAscent = Math.max(0, h - start.h);
		if (netAscent === 0) return 0;
		const lookupCost = getHeightCost(
			netAscent,
			movementSettings.heightCostLookup
		);
		return movementSettings.flyingIgnoresHeight
			? Math.min(lookupCost, netAscent)
			: lookupCost;
	};

	while (!queue.isEmpty()) {
		const current = queue.dequeue()!;
		const currentCost = nodeCosts.get(
			nodeKey(current.x, current.y, current.h)
		)!;

		if (canFly) {
			// Lateral flight: step to any standable neighbor cell at the current
			// altitude for the flat lateral cost. A flier can be in open air OR on
			// any walkable surface (isFlyerStandableCell), so it crosses gaps,
			// passes over walls at height, and -- crucially -- can step onto the
			// same surface tiles a walker uses even where those cells are not
			// whole-tile-clear. Altitude changes are the vertical "ladder" below.
			for (let d = 0; d < VOXEL_MOVEMENT_DIRECTIONS.length; d++) {
				const { dx, dy } = VOXEL_MOVEMENT_DIRECTIONS[d];
				const nx = current.x + dx;
				const ny = current.y + dy;
				if (!isVoxelTileInBounds(terrain, nx, ny)) continue;
				if (isFlyerStandableCell(index, nx, ny, current.h)) {
					relax(nx, ny, current.h, currentCost + 1);
				}
			}

			// Vertical flight: the "ladder". Ascend/descend one rules-height at a
			// time through clear cells in the current column. Each edge charges the
			// increment of the net-ascent cost (clamped non-negative); descending
			// yields a non-positive delta, i.e. free.
			for (const dh of [1, -1]) {
				const nh = current.h + dh;
				if (nh < 0 || nh > maxActorHeight) continue;
				if (isFlyerStandableCell(index, current.x, current.y, nh)) {
					const stepCost = Math.max(
						0,
						verticalCostAtHeight(nh) - verticalCostAtHeight(current.h)
					);
					relax(current.x, current.y, nh, currentCost + stepCost);
				}
			}

			continue;
		}

		// Non-flyer: surface-to-surface transitions from the cached adjacency
		// graph (lazily built per terrain revision). Each cardinal step lands on
		// a reachable neighbor surface; climbing up to it pays the height cost,
		// dropping down is free.
		const neighborsByDirection = adjacency!.getNeighborsByDirection(
			current.x,
			current.y,
			current.h
		);

		for (let d = 0; d < VOXEL_MOVEMENT_DIRECTIONS.length; d++) {
			const { dx, dy } = VOXEL_MOVEMENT_DIRECTIONS[d];
			const nx = current.x + dx;
			const ny = current.y + dy;
			if (!isVoxelTileInBounds(terrain, nx, ny)) continue;

			for (const neighbor of neighborsByDirection[d]) {
				let stepCost = 1;
				const heightDiff = neighbor.h - current.h;
				if (heightDiff > 0) {
					stepCost += getHeightCost(
						heightDiff,
						movementSettings.heightCostLookup
					);
				}
				relax(nx, ny, neighbor.h, currentCost + stepCost);
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
