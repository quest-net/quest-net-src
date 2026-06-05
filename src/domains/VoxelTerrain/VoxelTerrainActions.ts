// domains/VoxelTerrain/VoxelTerrainActions.ts

import type { Actor, Position } from "../Actor/Actor";
import type { Character } from "../Character/Character";
import { CampaignActions } from "../Campaign/CampaignActions";
import type { Campaign } from "../Campaign/Campaign";
import type { Context } from "../Context/Context";
import { isItemEntity } from "../Item/ItemDropUtils";
import { LogActions } from "../Log/LogActions";
import {
	getActiveVoxelTerrain,
	getMaxVoxelSurfaceHeight,
} from "../../utils/terrain/data/VoxelTerrainUtils";
import {
	getVoxelTerrainIndex,
	type VoxelTerrainIndex,
} from "../../utils/terrain/data/VoxelTerrainIndex";
import { createFlatVoxelTerrain } from "../../utils/terrain/editor/VoxelTerrainEditorUtils";
import { canStandVoxel } from "../../utils/terrain/movement/VoxelMovementUtilities";
import type { VoxelTerrain } from "./VoxelTerrain";
import { TerrainStorageService } from "../../services/TerrainStorageService";

const POSITION_HEIGHT_EPSILON = 1e-6;

type ActorPositionValidationResult =
	| {
			ok: true;
			position: Position;
			mode: "standing" | "flying" | "item";
	  }
	| {
			ok: false;
			position?: Position;
			reason: string;
	  };

function isInBounds(x: number, y: number, terrain: VoxelTerrain): boolean {
	return x >= 0 && x < terrain.Width && y >= 0 && y < terrain.Length;
}

function clampTileCoordinate(value: number, maxExclusive: number): number {
	if (!Number.isFinite(value)) return Math.max(0, Math.floor(maxExclusive / 2));
	return Math.max(0, Math.min(maxExclusive - 1, Math.round(value)));
}

function findTileFromOrigin<T>(
	terrain: VoxelTerrain,
	origin: { x: number; y: number },
	findAtTile: (x: number, y: number) => T | null
): T | null {
	const startX = clampTileCoordinate(origin.x, terrain.Width);
	const startY = clampTileCoordinate(origin.y, terrain.Length);
	const maxRadius = Math.max(terrain.Width, terrain.Length);

	for (let radius = 0; radius <= maxRadius; radius++) {
		for (let y = startY - radius; y <= startY + radius; y++) {
			for (let x = startX - radius; x <= startX + radius; x++) {
				if (Math.max(Math.abs(x - startX), Math.abs(y - startY)) !== radius) {
					continue;
				}
				if (!isInBounds(x, y, terrain)) {
					continue;
				}

				const result = findAtTile(x, y);
				if (result !== null) {
					return result;
				}
			}
		}
	}

	return null;
}

function getPreferredSurfaceHeights(
	surfaces: readonly number[],
	preferredH: number
): number[] {
	const belowOrEqual = surfaces
		.filter((surface) => surface <= preferredH)
		.sort((a, b) => b - a);
	const above = surfaces
		.filter((surface) => surface > preferredH)
		.sort((a, b) => a - b);
	return [...belowOrEqual, ...above];
}

function getSurfaceHeights(
	index: VoxelTerrainIndex,
	x: number,
	y: number
): readonly number[] {
	return index.allSurfaces.get(`${x},${y}`) ?? [];
}

function normalizeHeight(height: number): number {
	const rounded = Math.round(height);
	return Math.abs(height - rounded) <= POSITION_HEIGHT_EPSILON
		? rounded
		: height;
}

function normalizePositionForValidation(position: Position): Position | null {
	if (
		!Number.isFinite(position.x) ||
		!Number.isFinite(position.y) ||
		!Number.isFinite(position.h)
	) {
		return null;
	}

	return {
		x: Math.round(position.x),
		y: Math.round(position.y),
		h: normalizeHeight(position.h),
	};
}

function positionKey(position: Position): string {
	return `${position.x},${position.y},${normalizeHeight(position.h)}`;
}

function getMaxActorHeight(terrain: VoxelTerrain): number {
	return Math.ceil(Math.max(terrain.Height, getMaxVoxelSurfaceHeight(terrain)));
}

function getStandingSurfaceHeight(
	index: VoxelTerrainIndex,
	x: number,
	y: number,
	h: number
): number | null {
	const exactSurfaces = index.allSurfaceHeights.get(`${x},${y}`) ?? [];
	let rulesHeightSurface: number | null = null;

	for (const surfaceHeight of exactSurfaces) {
		if (Math.abs(surfaceHeight - h) <= POSITION_HEIGHT_EPSILON) {
			return surfaceHeight;
		}

		if (Math.abs(Math.floor(surfaceHeight) - h) <= POSITION_HEIGHT_EPSILON) {
			rulesHeightSurface = surfaceHeight;
		}
	}

	return rulesHeightSurface;
}

function validateActorPositionForTerrain(
	actor: Actor,
	position: Position,
	terrain: VoxelTerrain,
	index: VoxelTerrainIndex,
	occupiedTiles?: ReadonlySet<string>
): ActorPositionValidationResult {
	const normalized = normalizePositionForValidation(position);
	if (!normalized) {
		return { ok: false, reason: "position is not finite" };
	}

	if (!isInBounds(normalized.x, normalized.y, terrain)) {
		return {
			ok: false,
			position: normalized,
			reason: "position is outside the active terrain",
		};
	}

	if (normalized.h < 0 || normalized.h > getMaxActorHeight(terrain)) {
		return {
			ok: false,
			position: normalized,
			reason: "height is outside the active terrain",
		};
	}

	const standingSurfaceHeight = getStandingSurfaceHeight(
		index,
		normalized.x,
		normalized.y,
		normalized.h
	);

	if (standingSurfaceHeight !== null) {
		const standingPosition = {
			...normalized,
			h: Math.floor(standingSurfaceHeight),
		};
		if (!isItemEntity(actor) && occupiedTiles?.has(positionKey(standingPosition))) {
			return {
				ok: false,
				position: standingPosition,
				reason: "position is occupied",
			};
		}
		return {
			ok: true,
			position: standingPosition,
			mode: isItemEntity(actor) ? "item" : "standing",
		};
	}

	if (isItemEntity(actor)) {
		if (
			normalized.h === 0 &&
			getSurfaceHeights(index, normalized.x, normalized.y).length === 0
		) {
			return { ok: true, position: normalized, mode: "item" };
		}

		return {
			ok: false,
			position: normalized,
			reason: "item position is not on a terrain surface",
		};
	}

	if (actor.CanFly) {
		if (occupiedTiles?.has(positionKey(normalized))) {
			return {
				ok: false,
				position: normalized,
				reason: "position is occupied",
			};
		}

		if (canStandVoxel(terrain, index, normalized.x, normalized.y, normalized.h, true)) {
			return { ok: true, position: normalized, mode: "flying" };
		}

		return {
			ok: false,
			position: normalized,
			reason: "flying position is blocked by terrain",
		};
	}

	return {
		ok: false,
		position: normalized,
		reason: "position is not on a walkable surface",
	};
}

function getOccupiedActorPositionKeys(
	campaign: Campaign,
	terrain: VoxelTerrain,
	index: VoxelTerrainIndex,
	excludeActorId?: string
): Set<string> {
	const occupied = new Set<string>();
	const actors = [
		...campaign.GameState.Entities,
		...campaign.GameState.Characters,
	];

	for (const actor of actors) {
		if (actor.Id === excludeActorId || isItemEntity(actor)) continue;

		const validation = validateActorPositionForTerrain(
			actor,
			actor.Position,
			terrain,
			index
		);
		const position =
			validation.ok
				? validation.position
				: normalizePositionForValidation(actor.Position);
		if (position) {
			occupied.add(positionKey(position));
		}
	}

	return occupied;
}

function returnCharacterToRoster(
	campaign: Campaign,
	character: Character,
	context: Context
): void {
	const alreadyInRoster = campaign.CharacterRoster.some(
		(candidate) => candidate.Id === character.Id
	);
	if (!alreadyInRoster) {
		campaign.CharacterRoster.push(character);
	}

	const impersonated = (context.User.ImpersonatedActors ?? {})[campaign.RoomCode];
	if (impersonated === character.Id && context.User.ImpersonatedActors) {
		delete context.User.ImpersonatedActors[campaign.RoomCode];
	}

	LogActions.create(
		{
			action: "Character despawned",
			details: `${character.Name} returned to roster due to invalid voxel position`,
			category: "system",
			level: "important",
			visibility: ["all"],
			actorId: character.Id,
		},
		context
	);
}

type RepairActorEntry = {
	actor: Actor;
	type: "character" | "entity";
};

function getRepairActorEntries(campaign: Campaign): RepairActorEntry[] {
	return [
		...campaign.GameState.Characters.map((actor) => ({
			actor,
			type: "character" as const,
		})),
		...campaign.GameState.Entities.map((actor) => ({
			actor,
			type: "entity" as const,
		})),
	];
}

function removeInvalidActor(
	entry: RepairActorEntry,
	campaign: Campaign,
	context: Context
): void {
	if (entry.type === "character") {
		const arrayIndex = campaign.GameState.Characters.findIndex(
			(actor) => actor.Id === entry.actor.Id
		);
		if (arrayIndex === -1) return;

		const [character] = campaign.GameState.Characters.splice(arrayIndex, 1);
		returnCharacterToRoster(campaign, character, context);
		return;
	}

	const arrayIndex = campaign.GameState.Entities.findIndex(
		(actor) => actor.Id === entry.actor.Id
	);
	if (arrayIndex === -1) return;

	const [actor] = campaign.GameState.Entities.splice(arrayIndex, 1);
	LogActions.create(
		{
			action: `${entry.type} despawned`,
			details: `${actor.Name} was removed due to invalid voxel position`,
			category: "system",
			level: "verbose",
			visibility: ["dm"],
			actorId: actor.Id,
		},
		context
	);
}

export const VoxelTerrainActions = {
	/**
	 * Creates the default voxel terrain that every campaign starts with.
	 */
	createDefault(): VoxelTerrain {
		return createFlatVoxelTerrain({
			id: crypto.randomUUID(),
			name: "Default Terrain",
			width: 16,
			length: 16,
			height: 4,
			maxHeight: 8,
		});
	},

	createNew(): VoxelTerrain {
		return createFlatVoxelTerrain({
			id: crypto.randomUUID(),
			name: "New Terrain",
			width: 20,
			length: 20,
		});
	},

	create(params: { terrain: VoxelTerrain }, context: Context): void {
		const campaign = CampaignActions.getActiveCampaign(context);

		campaign.VoxelTerrains.push(params.terrain);

		LogActions.create(
			{
				action: "Terrain created",
				details: `${params.terrain.Name} (${params.terrain.Width}x${params.terrain.Length})`,
				category: "system",
				level: "info",
				visibility: ["dm"],
			},
			context
		);
	},

	edit(
		params: {
			terrainId: string;
			updates: Partial<VoxelTerrain>;
			repairActors?: boolean;
		},
		context: Context
	): void {
		const campaign = CampaignActions.getActiveCampaign(context);
		const terrain = campaign.VoxelTerrains.find((t) => t.Id === params.terrainId);
		if (!terrain) {
			console.warn(`Voxel terrain not found: ${params.terrainId}`);
			return;
		}

		Object.assign(terrain, params.updates);

		LogActions.create(
			{
				action: "Terrain updated",
				details: terrain.Name,
				category: "system",
				level: "info",
				visibility: ["dm"],
			},
			context
		);

		if (params.repairActors !== false) {
			VoxelTerrainActions.repairActors(context);
		}
	},

	async delete(params: { terrainId: string }, context: Context): Promise<void> {
		const campaign = CampaignActions.getActiveCampaign(context);
		const arrayIndex = campaign.VoxelTerrains.findIndex((t) => t.Id === params.terrainId);
		if (arrayIndex === -1) {
			console.warn(`Voxel terrain not found: ${params.terrainId}`);
			return;
		}

		if (campaign.GameState.VoxelTerrainId === params.terrainId) {
			console.warn("Cannot delete active terrain. Switch to another terrain first.");
			return;
		}

		const terrain = campaign.VoxelTerrains[arrayIndex];
		campaign.VoxelTerrains.splice(arrayIndex, 1);
		await TerrainStorageService.deleteTerrain(campaign, terrain);

		LogActions.create(
			{
				action: "Terrain deleted",
				details: terrain.Name,
				category: "system",
				level: "info",
				visibility: ["dm"],
			},
			context
		);
	},

	async setActive(
		params: { terrainId: string | undefined; repairActors?: boolean },
		context: Context
	): Promise<void> {
		const campaign = CampaignActions.getActiveCampaign(context);

		if (!params.terrainId) {
			const fallback = campaign.VoxelTerrains[0];
			if (!fallback) {
				console.warn("No voxel terrain available to activate");
				return;
			}
			params.terrainId = fallback.Id;
		}

		const terrain = await TerrainStorageService.hydrateTerrain(
			campaign,
			params.terrainId
		);
		if (!terrain) {
			console.warn(`Voxel terrain not found: ${params.terrainId}`);
			return;
		}

		campaign.GameState.VoxelTerrainId = terrain.Id;
		await TerrainStorageService.packInactiveTerrains(campaign);

		LogActions.create(
			{
				action: "Terrain activated",
				details: terrain.Name,
				category: "system",
				level: "important",
				visibility: ["all"],
			},
			context
		);

		if (params.repairActors !== false) {
			VoxelTerrainActions.repairActors(context);
		}
	},

	bulkEditTags(
		params: { updates: Array<{ terrainId: string; tags: string[] }> },
		context: Context
	): void {
		const campaign = CampaignActions.getActiveCampaign(context);

		let successCount = 0;
		for (const update of params.updates) {
			const terrain = campaign.VoxelTerrains.find((t) => t.Id === update.terrainId);
			if (terrain) {
				terrain.Tags = update.tags;
				successCount++;
			} else {
				console.warn(`Voxel terrain not found for bulk update: ${update.terrainId}`);
			}
		}

		LogActions.create(
			{
				action: "terrains organized",
				details: `Updated tags for ${successCount} terrain(s)`,
				category: "scene",
				level: "verbose",
				visibility: ["dm"],
			},
			context
		);
	},

	repairActors(context: Context): void {
		const campaign = CampaignActions.getActiveCampaign(context);
		const terrain = getActiveVoxelTerrain(campaign);
		if (!terrain) {
			console.warn("No active voxel terrain found for actor repair");
			return;
		}

		const occupiedTiles = new Set<string>();
		const index = getVoxelTerrainIndex(terrain);
		const entries = getRepairActorEntries(campaign);
		const needsRepair: RepairActorEntry[] = [];

		// First keep every already-valid actor in priority order (characters, then
		// entities). This preserves stable occupants before repairing invalid or
		// overlapping actors into the remaining space.
		for (const entry of entries) {
			const validation = validateActorPositionForTerrain(
				entry.actor,
				entry.actor.Position,
				terrain,
				index
			);

			if (!validation.ok) {
				needsRepair.push(entry);
				continue;
			}

			entry.actor.Position = validation.position;
			if (isItemEntity(entry.actor)) continue;

			const key = positionKey(validation.position);
			if (occupiedTiles.has(key)) {
				needsRepair.push(entry);
				continue;
			}

			occupiedTiles.add(key);
		}

		const toRemove: RepairActorEntry[] = [];
		for (const entry of needsRepair) {
			const validPosition = VoxelTerrainActions.findValidPosition(
				entry.actor,
				terrain,
				occupiedTiles,
				index
			);
			if (validPosition) {
				entry.actor.Position = validPosition;
				if (!isItemEntity(entry.actor)) {
					occupiedTiles.add(positionKey(validPosition));
				}
			} else {
				toRemove.push(entry);
			}
		}

		for (const entry of toRemove) {
			removeInvalidActor(entry, campaign, context);
		}
	},

	isInBounds(x: number, y: number, terrain: VoxelTerrain): boolean {
		return isInBounds(x, y, terrain);
	},

	validateActorMove(
		actor: Actor,
		position: Position,
		campaign: Campaign
	): ActorPositionValidationResult {
		const terrain = getActiveVoxelTerrain(campaign);
		if (!terrain) {
			const normalized = normalizePositionForValidation(position);
			return normalized
				? { ok: true, position: normalized, mode: isItemEntity(actor) ? "item" : "standing" }
				: { ok: false, reason: "position is not finite" };
		}

		const index = getVoxelTerrainIndex(terrain);
		const occupiedTiles = getOccupiedActorPositionKeys(
			campaign,
			terrain,
			index,
			actor.Id
		);

		return validateActorPositionForTerrain(
			actor,
			position,
			terrain,
			index,
			occupiedTiles
		);
	},

	findValidPosition(
		actor: Actor,
		terrain: VoxelTerrain,
		occupiedTiles: Set<string>,
		index: VoxelTerrainIndex = getVoxelTerrainIndex(terrain)
	): { x: number; y: number; h: number } | null {
		const maxHeight = getMaxActorHeight(terrain);
		const normalizedCurrent =
			normalizePositionForValidation(actor.Position) ?? {
				x: clampTileCoordinate(actor.Position.x, terrain.Width),
				y: clampTileCoordinate(actor.Position.y, terrain.Length),
				h: 0,
			};
		const searchOrigin = {
			x: clampTileCoordinate(normalizedCurrent.x, terrain.Width),
			y: clampTileCoordinate(normalizedCurrent.y, terrain.Length),
		};
		const isPositionAvailable = (x: number, y: number, h: number): Position | null => {
			const validation = validateActorPositionForTerrain(
				actor,
				{ x, y, h },
				terrain,
				index,
				occupiedTiles
			);
			return validation.ok ? validation.position : null;
		};

		const findAvailablePosition = (x: number, y: number): Position | null => {
			if (!isInBounds(x, y, terrain)) return null;

			if (isItemEntity(actor)) {
				const surfaces = getSurfaceHeights(index, x, y);
				return isPositionAvailable(x, y, surfaces[0] ?? 0);
			}

			if (!actor.CanFly) {
				const surfaces = getSurfaceHeights(index, x, y);
				for (const h of getPreferredSurfaceHeights(
					surfaces,
					normalizedCurrent.h
				)) {
					const position = isPositionAvailable(x, y, h);
					if (position) return position;
				}
				return null;
			}

			const preferredH = Math.max(0, Math.min(maxHeight, normalizedCurrent.h));
			const triedHeights = new Set<number>();
			const tryHeight = (h: number): Position | null => {
				const normalizedH = normalizeHeight(h);
				if (triedHeights.has(normalizedH)) return null;
				triedHeights.add(normalizedH);
				return isPositionAvailable(x, y, normalizedH);
			};

			const preferredPosition = tryHeight(preferredH);
			if (preferredPosition) return preferredPosition;

			for (let h = Math.ceil(preferredH); h <= maxHeight; h++) {
				const position = tryHeight(h);
				if (position) return position;
			}
			for (let h = Math.floor(preferredH); h >= 0; h--) {
				const position = tryHeight(h);
				if (position) return position;
			}
			return null;
		};

		// Step 1: keep the actor exactly where they are if the requested
		// position is valid and available.
		const currentPosition = isPositionAvailable(
			normalizedCurrent.x,
			normalizedCurrent.y,
			normalizedCurrent.h
		);
		if (currentPosition) return currentPosition;

		// Step 2: try the same column before horizontal displacement. This is what
		// makes a flyer who loses CanFly drop onto the floor below when possible.
		const sameColumn = findAvailablePosition(
			normalizedCurrent.x,
			normalizedCurrent.y
		);
		if (sameColumn) return sameColumn;

		// Step 3: search outward from the actor's current/nearest tile, not the
		// terrain center, so repair moves are as local as possible.
		const skipOriginalColumn = isInBounds(
			normalizedCurrent.x,
			normalizedCurrent.y,
			terrain
		);
		return findTileFromOrigin(terrain, searchOrigin, (x, y) => {
			if (
				skipOriginalColumn &&
				x === normalizedCurrent.x &&
				y === normalizedCurrent.y
			) {
				return null;
			}
			return findAvailablePosition(x, y);
		});
	},
};
