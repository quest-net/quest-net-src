import type { Position } from "../domains/Actor/Actor";
import type { Character } from "../domains/Character/Character";
import type { Entity } from "../domains/Entity/Entity";
import type { MovementSettings } from "../domains/CampaignSetting/CampaignSetting";
import type { VoxelTerrain } from "../domains/VoxelTerrain/VoxelTerrain";
import { isItemEntity } from "../domains/Item/ItemDropUtils";
import {
	getVoxelRulesSurfaceHeight,
	getVoxelRulesSurfaceHeightFromData,
	getVoxelTerrainSurfaceData,
	type VoxelTerrainSurfaceData,
} from "./VoxelTerrainUtils";

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
	climbUsed: number;
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

export function getVoxelTileKey(x: number, y: number): string {
	return `${x},${y}`;
}

export function getVoxelPositionKey(position: Position): string {
	return `${position.x},${position.y},${position.h}`;
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

export function calculateVoxelTargetHeight(
	terrain: VoxelTerrain,
	tileX: number,
	tileY: number,
	currentHeight: number,
	canFly: boolean
): number {
	const tileHeight = getVoxelRulesSurfaceHeight(terrain, tileX, tileY);

	if (canFly) {
		return Math.max(tileHeight, Math.round(currentHeight));
	}

	return tileHeight;
}

function calculateVoxelTargetHeightFromSurfaceData(
	surfaceData: VoxelTerrainSurfaceData,
	tileX: number,
	tileY: number,
	currentHeight: number,
	canFly: boolean
): number {
	const tileHeight = getVoxelRulesSurfaceHeightFromData(surfaceData, tileX, tileY);

	if (canFly) {
		return Math.max(tileHeight, Math.round(currentHeight));
	}

	return tileHeight;
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
	const costs = new Map<string, number>();
	const bestTiles = new Map<string, VoxelMovementTile>();

	if (!isVoxelTileInBounds(terrain, start.x, start.y)) {
		return { tiles: [], costs };
	}

	const surfaceData = getVoxelTerrainSurfaceData(terrain);

	const addBestTile = (x: number, y: number, h: number, cost: number) => {
		const key = getVoxelTileKey(x, y);
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
	const nodeKey = (x: number, y: number, h: number, climbUsed: number) =>
		`${x},${y},${h},${climbUsed}`;

	const startKey = nodeKey(start.x, start.y, start.h, 0);
	nodeCosts.set(startKey, 0);
	queue.enqueue({ x: start.x, y: start.y, h: start.h, climbUsed: 0 }, 0);

	const directions = [
		{ dx: 1, dy: 0 },
		{ dx: -1, dy: 0 },
		{ dx: 0, dy: 1 },
		{ dx: 0, dy: -1 },
	];

	while (!queue.isEmpty()) {
		const current = queue.dequeue()!;
		const currentKey = nodeKey(
			current.x,
			current.y,
			current.h,
			current.climbUsed
		);
		const currentCost = nodeCosts.get(currentKey)!;

		for (const direction of directions) {
			const nx = current.x + direction.dx;
			const ny = current.y + direction.dy;

			if (!isVoxelTileInBounds(terrain, nx, ny)) continue;

			const targetH = calculateVoxelTargetHeightFromSurfaceData(
				surfaceData,
				nx,
				ny,
				current.h,
				canFly
			);

			let stepCost = 1;
			let newClimbUsed = current.climbUsed;
			const heightDiff = targetH - current.h;

			if (heightDiff > 0) {
				if (canFly && movementSettings.flyingIgnoresHeight) {
					const remainingFreeClimb = budget - current.climbUsed;

					if (heightDiff <= remainingFreeClimb) {
						newClimbUsed = current.climbUsed + heightDiff;
					} else {
						const freeUsed = Math.max(0, remainingFreeClimb);
						const paidClimb = heightDiff - freeUsed;
						newClimbUsed = current.climbUsed + freeUsed;
						stepCost += getHeightCost(
							paidClimb,
							movementSettings.heightCostLookup
						);
					}
				} else {
					stepCost += getHeightCost(
						heightDiff,
						movementSettings.heightCostLookup
					);
				}
			}

			const newCost = currentCost + stepCost;
			if (newCost > budget) continue;

			const nextKey = nodeKey(nx, ny, targetH, newClimbUsed);
			const existingCost = nodeCosts.get(nextKey);
			if (existingCost !== undefined && existingCost <= newCost) continue;

			nodeCosts.set(nextKey, newCost);
			queue.enqueue(
				{ x: nx, y: ny, h: targetH, climbUsed: newClimbUsed },
				newCost
			);
			addBestTile(nx, ny, targetH, newCost);
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
		getVoxelTileKey(normalizedCurrent.x, normalizedCurrent.y)
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
			costs: new Map([[getVoxelTileKey(normalizedCurrent.x, normalizedCurrent.y), 0]]),
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
	targetY: number
): boolean {
	if (!isVoxelTileInBounds(terrain, targetX, targetY)) return false;

	let budget = getMoveSpeedBudget(moveSpeed);

	if (isCombatActive) {
		if (!turnStart) return false;

		const { costs: startCosts } = calculateVoxelMovementRange(
			terrain,
			turnStart,
			budget,
			canFly,
			movementSettings
		);
		const normalizedCurrent = normalizeVoxelPosition(current);
		const spentCost = startCosts.get(
			getVoxelTileKey(normalizedCurrent.x, normalizedCurrent.y)
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

	return tiles.some((tile) => tile.x === targetX && tile.y === targetY);
}
