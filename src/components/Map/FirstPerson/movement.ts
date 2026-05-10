import type { Character } from "../../../domains/Character/Character";
import type { Entity } from "../../../domains/Entity/Entity";
import type { MovementSettings } from "../../../domains/CampaignSetting/CampaignSetting";
import { FLYING_SPAWN_ELEVATION } from "../../../domains/VoxelTerrain/voxelTerrainConstants";
import type { VoxelTerrain } from "../../../domains/VoxelTerrain/VoxelTerrain";
import {
	calculateVoxelMovementRange,
	calculateVoxelRemainingMovementRange,
	getVoxelTileHeightKey,
	isVoxelTileOccupiedAtHeight,
} from "../../../utils/VoxelMovementUtilities";
import {
	getVoxelTerrainSurfaceData,
} from "../../../utils/VoxelTerrainUtils";
import { ACTOR_TOKEN_DESCRIPTOR_DEFAULTS } from "../Actors3D/actorTokenConstants";
import type { FirstPersonActor, LegalTile } from "./types";

export function createColumnLookup(tiles: LegalTile[]): Map<string, LegalTile[]> {
	const lookup = new Map<string, LegalTile[]>();
	for (const tile of tiles) {
		const key = `${tile.x},${tile.y}`;
		const existing = lookup.get(key);
		if (existing) {
			existing.push(tile);
		} else {
			lookup.set(key, [tile]);
		}
	}
	for (const column of lookup.values()) {
		column.sort((a, b) => a.h - b.h);
	}
	return lookup;
}

export function clampHeightToLegalColumn(
	tile: Pick<LegalTile, "x" | "y" | "h">,
	preferredH: number,
	legalTilesByColumn: Map<string, LegalTile[]>
): number {
	const column = legalTilesByColumn.get(`${tile.x},${tile.y}`);
	if (!column || column.length === 0) return tile.h;

	return Math.max(column[0].h, Math.min(column[column.length - 1].h, preferredH));
}

export function createUnrestrictedLegalTiles(
	terrain: VoxelTerrain,
	actor: FirstPersonActor,
	characters: Character[],
	entities: Entity[]
): LegalTile[] {
	const surfaceData = getVoxelTerrainSurfaceData(terrain);
	const canFly = actor.actor.CanFly ?? false;
	const maxHeight = Math.ceil(
		Math.max(
			terrain.Height,
			canFly
				? surfaceData.maxSurfaceHeight + FLYING_SPAWN_ELEVATION
				: surfaceData.maxSurfaceHeight,
			actor.actor.Position.h
		)
	);
	const tiles: LegalTile[] = [];

	for (let x = 0; x < terrain.Width; x++) {
		for (let y = 0; y < terrain.Length; y++) {
			const addTile = (h: number, cost = 0) => {
				if (
					isVoxelTileOccupiedAtHeight(
						x,
						y,
						h,
						characters,
						entities,
						actor.id
					)
				) {
					return;
				}
				tiles.push({ x, y, h, cost });
			};

			if (canFly) {
				for (let h = 0; h <= maxHeight; h++) {
					addTile(h);
				}
			} else {
				for (const h of surfaceData.allSurfaces.get(`${x},${y}`) ?? []) {
					addTile(h);
				}
			}
		}
	}

	return tiles;
}

export function expandFlightTiles(
	terrain: VoxelTerrain,
	actor: FirstPersonActor,
	baseTiles: LegalTile[],
	characters: Character[],
	entities: Entity[]
): LegalTile[] {
	if (!actor.actor.CanFly || baseTiles.length === 0) return baseTiles;

	const surfaceData = getVoxelTerrainSurfaceData(terrain);
	const maxFlightHeight = Math.ceil(
		Math.max(
			terrain.Height,
			surfaceData.maxSurfaceHeight + FLYING_SPAWN_ELEVATION,
			actor.actor.Position.h
		)
	);
	const byKey = new Map<string, LegalTile>();
	const columns = new Map<string, { x: number; y: number; maxCost: number }>();

	for (const tile of baseTiles) {
		byKey.set(getVoxelTileHeightKey(tile.x, tile.y, tile.h), tile);
		const columnKey = `${tile.x},${tile.y}`;
		const column = columns.get(columnKey);
		if (column) {
			column.maxCost = Math.max(column.maxCost, tile.cost);
		} else {
			columns.set(columnKey, { x: tile.x, y: tile.y, maxCost: tile.cost });
		}
	}

	for (const column of columns.values()) {
		for (let h = 0; h <= maxFlightHeight; h++) {
			const key = getVoxelTileHeightKey(column.x, column.y, h);
			if (byKey.has(key)) continue;
			if (
				isVoxelTileOccupiedAtHeight(
					column.x,
					column.y,
					h,
					characters,
					entities,
					actor.id
				)
			) {
				continue;
			}
			byKey.set(key, {
				x: column.x,
				y: column.y,
				h,
				cost: column.maxCost,
			});
		}
	}

	return Array.from(byKey.values());
}

interface CreateMovementTilesArgs {
	terrain: VoxelTerrain;
	actor: FirstPersonActor;
	characters: Character[];
	entities: Entity[];
	isCombatActive: boolean;
	restrictMovementToRange: boolean;
	movementSettings: MovementSettings;
}

export function createFirstPersonMovementTiles({
	terrain,
	actor,
	characters,
	entities,
	isCombatActive,
	restrictMovementToRange,
	movementSettings,
}: CreateMovementTilesArgs): LegalTile[] {
	const filterOccupiedTiles = (tiles: LegalTile[]) =>
		tiles.filter(
			(tile) =>
				!isVoxelTileOccupiedAtHeight(
					tile.x,
					tile.y,
					tile.h,
					characters,
					entities,
					actor.id
				)
		);

	if (!restrictMovementToRange) {
		return createUnrestrictedLegalTiles(terrain, actor, characters, entities);
	}

	const moveSpeed =
		actor.actor.MoveSpeed ?? ACTOR_TOKEN_DESCRIPTOR_DEFAULTS.MOVE_SPEED;
	const canFly = actor.actor.CanFly ?? false;
	const range = isCombatActive
		? calculateVoxelRemainingMovementRange(
				terrain,
				actor.actor.Position,
				actor.actor.TurnStartPosition,
				moveSpeed,
				canFly,
				movementSettings
		  )?.tiles ?? []
		: calculateVoxelMovementRange(
				terrain,
				actor.actor.Position,
				moveSpeed,
				canFly,
				movementSettings
		  ).tiles;

	return expandFlightTiles(
		terrain,
		actor,
		filterOccupiedTiles(range),
		characters,
		entities
	);
}

export function createMovementCostLookup(
	terrain: VoxelTerrain,
	actor: FirstPersonActor,
	isCombatActive: boolean,
	movementSettings: MovementSettings
): Map<string, number> {
	const moveSpeed =
		actor.actor.MoveSpeed ?? ACTOR_TOKEN_DESCRIPTOR_DEFAULTS.MOVE_SPEED;
	const canFly = actor.actor.CanFly ?? false;
	const anchor =
		isCombatActive && actor.actor.TurnStartPosition
			? actor.actor.TurnStartPosition
			: actor.actor.Position;
	return calculateVoxelMovementRange(
		terrain,
		anchor,
		moveSpeed,
		canFly,
		movementSettings
	).costs;
}

export function formatMovementValue(value: number): string {
	return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
