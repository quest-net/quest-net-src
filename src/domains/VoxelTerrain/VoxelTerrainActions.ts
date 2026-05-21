// domains/VoxelTerrain/VoxelTerrainActions.ts

import type { Actor } from "../Actor/Actor";
import type { Character } from "../Character/Character";
import { CampaignActions } from "../Campaign/CampaignActions";
import type { Campaign } from "../Campaign/Campaign";
import type { Context } from "../Context/Context";
import { isItemEntity } from "../Item/ItemDropUtils";
import { LogActions } from "../Log/LogActions";
import {
	getActiveVoxelTerrain,
	getMaxVoxelSurfaceHeight,
	getVoxelRulesSurfaceHeight,
} from "../../utils/terrain/data/VoxelTerrainUtils";
import {
	getVoxelTerrainIndex,
	type VoxelTerrainIndex,
} from "../../utils/terrain/data/VoxelTerrainIndex";
import { createFlatVoxelTerrain } from "../../utils/terrain/editor/VoxelTerrainEditorUtils";
import type { VoxelTerrain } from "./VoxelTerrain";
import { TerrainStorageService } from "../../services/TerrainStorageService";

const FLYING_ACTOR_CLEARANCE_BY_SIZE = {
	"extra-small": 1,
	small: 1.25,
	medium: 1.5,
	large: 1.75,
} as const;

function getCenterTile(terrain: VoxelTerrain): { x: number; y: number } {
	return {
		x: Math.max(0, Math.min(terrain.Width - 1, Math.floor(terrain.Width / 2))),
		y: Math.max(0, Math.min(terrain.Length - 1, Math.floor(terrain.Length / 2))),
	};
}

function findTileFromCenter<T>(
	terrain: VoxelTerrain,
	findAtTile: (x: number, y: number) => T | null
): T | null {
	const center = getCenterTile(terrain);
	const maxRadius = Math.max(terrain.Width, terrain.Length);

	for (let radius = 0; radius <= maxRadius; radius++) {
		for (let y = center.y - radius; y <= center.y + radius; y++) {
			for (let x = center.x - radius; x <= center.x + radius; x++) {
				if (Math.max(Math.abs(x - center.x), Math.abs(y - center.y)) !== radius) {
					continue;
				}
				if (!VoxelTerrainActions.isInBounds(x, y, terrain)) {
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

function getSurfaceHeights(
	index: VoxelTerrainIndex,
	x: number,
	y: number
): readonly number[] {
	return index.allSurfaces.get(`${x},${y}`) ?? [];
}

function getClosestHeight(heights: readonly number[], target: number): number {
	let closest = heights[0];
	let minDiff = Math.abs(target - closest);

	for (const height of heights) {
		const diff = Math.abs(target - height);
		if (diff < minDiff) {
			minDiff = diff;
			closest = height;
		}
	}

	return closest;
}

function getAdjustedActorHeight(
	actor: Actor,
	terrain: VoxelTerrain,
	index: VoxelTerrainIndex
): number {
	const surfaces = getSurfaceHeights(index, actor.Position.x, actor.Position.y);
	if (surfaces.includes(actor.Position.h)) return actor.Position.h;

	if (actor.CanFly) {
		return actor.Position.h;
	}

	if (surfaces.length === 0) {
		return getVoxelRulesSurfaceHeight(terrain, actor.Position.x, actor.Position.y);
	}

	return getClosestHeight(surfaces, actor.Position.h);
}

function getFlyingActorClearance(actor: Actor): number {
	return FLYING_ACTOR_CLEARANCE_BY_SIZE[actor.Size ?? "small"];
}

function isFlyingHeightClear(
	actor: Actor,
	terrain: VoxelTerrain,
	index: VoxelTerrainIndex,
	x: number,
	y: number,
	h: number
): boolean {
	if (!VoxelTerrainActions.isInBounds(x, y, terrain)) return false;
	if (h < 0) return false;
	if (
		h > Math.ceil(Math.max(terrain.Height, getMaxVoxelSurfaceHeight(terrain)))
	) {
		return false;
	}

	const { resolution } = index;
	const startVoxelY = Math.max(0, Math.floor(h * resolution));
	const endVoxelY = Math.max(
		startVoxelY,
		Math.ceil((h + getFlyingActorClearance(actor)) * resolution) - 1
	);

	for (let voxelY = startVoxelY; voxelY <= endVoxelY; voxelY++) {
		if (index.isVoxelOccupiedAtTile(x, y, voxelY)) return false;
	}

	return true;
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
			validateActors?: boolean;
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

		if (params.validateActors !== false) {
			VoxelTerrainActions.validateActors(context);
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
		params: { terrainId: string | undefined; validateActors?: boolean },
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

		if (params.validateActors !== false) {
			VoxelTerrainActions.validateActors(context);
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

	validateActors(context: Context): void {
		const campaign = CampaignActions.getActiveCampaign(context);
		const terrain = getActiveVoxelTerrain(campaign);
		if (!terrain) {
			console.warn("No active voxel terrain found for validation");
			return;
		}

		const occupiedTiles = new Set<string>();
		const index = getVoxelTerrainIndex(terrain);

		VoxelTerrainActions.validateActorArray(
			campaign.GameState.Entities,
			terrain,
			index,
			occupiedTiles,
			"entity",
			campaign,
			context
		);
		VoxelTerrainActions.validateActorArray(
			campaign.GameState.Characters,
			terrain,
			index,
			occupiedTiles,
			"character",
			campaign,
			context
		);
	},

	validateActorArray(
		actors: Actor[],
		terrain: VoxelTerrain,
		index: VoxelTerrainIndex,
		occupiedTiles: Set<string>,
		type: "entity" | "character",
		campaign: Campaign,
		context: Context
	): void {
		const toRemove: string[] = [];

		const reposition = (actor: Actor): void => {
			const validPosition = VoxelTerrainActions.findValidPosition(
				actor,
				terrain,
				occupiedTiles,
				index
			);
			if (validPosition) {
				actor.Position = validPosition;
				occupiedTiles.add(
					`${validPosition.x},${validPosition.y},${validPosition.h}`
				);
			} else {
				toRemove.push(actor.Id);
			}
		};

		for (const actor of actors) {
			actor.Position.x = Math.round(actor.Position.x);
			actor.Position.y = Math.round(actor.Position.y);
			actor.Position.h = Math.round(actor.Position.h);

			if (!VoxelTerrainActions.isInBounds(actor.Position.x, actor.Position.y, terrain)) {
				reposition(actor);
				continue;
			}

			const isItem = isItemEntity(actor);
			if (
				!isItem &&
				!actor.CanFly &&
				getSurfaceHeights(index, actor.Position.x, actor.Position.y).length === 0
			) {
				reposition(actor);
				continue;
			}

			VoxelTerrainActions.adjustHeight(actor, terrain, index);

			if (
				actor.CanFly &&
				!isFlyingHeightClear(
					actor,
					terrain,
					index,
					actor.Position.x,
					actor.Position.y,
					actor.Position.h
				)
			) {
				reposition(actor);
				continue;
			}

			if (isItem) continue;

			const tileKey = `${actor.Position.x},${actor.Position.y},${actor.Position.h}`;
			if (occupiedTiles.has(tileKey)) {
				reposition(actor);
			} else {
				occupiedTiles.add(tileKey);
			}
		}

		for (const actorId of toRemove) {
			const arrayIndex = actors.findIndex((actor) => actor.Id === actorId);
			if (arrayIndex === -1) continue;

			const actor = actors[arrayIndex];
			actors.splice(arrayIndex, 1);
			if (type === "character") {
				returnCharacterToRoster(campaign, actor as Character, context);
				continue;
			}

			LogActions.create(
				{
					action: `${type} despawned`,
					details: `${actor.Name} was removed due to invalid voxel position`,
					category: "system",
					level: "verbose",
					visibility: ["dm"],
					actorId: actor.Id,
				},
				context
			);
		}
	},

	isInBounds(x: number, y: number, terrain: VoxelTerrain): boolean {
		return x >= 0 && x < terrain.Width && y >= 0 && y < terrain.Length;
	},

	adjustHeight(
		actor: Actor,
		terrain: VoxelTerrain,
		index: VoxelTerrainIndex = getVoxelTerrainIndex(terrain)
	): void {
		actor.Position.h = getAdjustedActorHeight(actor, terrain, index);
	},

	findValidPosition(
		actor: Actor,
		terrain: VoxelTerrain,
		occupiedTiles: Set<string>,
		index: VoxelTerrainIndex = getVoxelTerrainIndex(terrain)
	): { x: number; y: number; h: number } | null {
		const maxHeight = Math.ceil(Math.max(terrain.Height, getMaxVoxelSurfaceHeight(terrain)));
		const isPositionAvailable = (x: number, y: number, h: number): boolean =>
			VoxelTerrainActions.isInBounds(x, y, terrain) &&
			!occupiedTiles.has(`${x},${y},${h}`) &&
			(!actor.CanFly || isFlyingHeightClear(actor, terrain, index, x, y, h));

		const findAvailableHeight = (x: number, y: number): number | null => {
			if (!VoxelTerrainActions.isInBounds(x, y, terrain)) return null;

			if (!actor.CanFly) {
				const surfaces = getSurfaceHeights(index, x, y);
				if (surfaces.length === 0) return null;
				for (const h of surfaces) {
					if (isPositionAvailable(x, y, h)) return h;
				}
				return null;
			}

			const preferredH = Math.max(0, Math.min(maxHeight, actor.Position.h));
			for (let h = preferredH; h <= maxHeight; h++) {
				if (isPositionAvailable(x, y, h)) return h;
			}
			for (let h = preferredH - 1; h >= 0; h--) {
				if (isPositionAvailable(x, y, h)) return h;
			}
			return null;
		};

		const currentH = findAvailableHeight(actor.Position.x, actor.Position.y);
		if (currentH !== null) {
			return { x: actor.Position.x, y: actor.Position.y, h: currentH };
		}

		return findTileFromCenter(terrain, (x, y) => {
			const h = findAvailableHeight(x, y);
			return h === null ? null : { x, y, h };
		});
	},
};
