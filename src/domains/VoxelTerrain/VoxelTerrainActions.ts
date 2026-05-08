// domains/VoxelTerrain/VoxelTerrainActions.ts

import type { Actor } from "../Actor/Actor";
import { CampaignActions } from "../Campaign/CampaignActions";
import type { Context } from "../Context/Context";
import { isItemEntity } from "../Item/ItemDropUtils";
import { LogActions } from "../Log/LogActions";
import {
	getActiveVoxelTerrain,
	getMaxVoxelSurfaceHeight,
	getVoxelRulesSurfaceHeight,
	getVoxelTerrainSurfaceData,
	type VoxelTerrainSurfaceData,
} from "../../utils/VoxelTerrainUtils";
import { createFlatVoxelTerrain } from "../../utils/VoxelTerrainEditorUtils";
import type { VoxelTerrain } from "./VoxelTerrain";

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
	surfaceData: VoxelTerrainSurfaceData,
	x: number,
	y: number
): number[] {
	return surfaceData.allSurfaces.get(`${x},${y}`) ?? [];
}

function getClosestHeight(heights: number[], target: number): number {
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
	surfaceData: VoxelTerrainSurfaceData
): number {
	const surfaces = getSurfaceHeights(
		surfaceData,
		actor.Position.x,
		actor.Position.y
	);
	if (surfaces.includes(actor.Position.h)) return actor.Position.h;

	if (actor.CanFly) {
		return actor.Position.h;
	}

	if (surfaces.length === 0) {
		return getVoxelRulesSurfaceHeight(terrain, actor.Position.x, actor.Position.y);
	}

	return getClosestHeight(surfaces, actor.Position.h);
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
			maxHeight: 4,
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
		params: { terrainId: string; updates: Partial<VoxelTerrain> },
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

		VoxelTerrainActions.validateActors(context);
	},

	delete(params: { terrainId: string }, context: Context): void {
		const campaign = CampaignActions.getActiveCampaign(context);
		const index = campaign.VoxelTerrains.findIndex((t) => t.Id === params.terrainId);
		if (index === -1) {
			console.warn(`Voxel terrain not found: ${params.terrainId}`);
			return;
		}

		if (campaign.GameState.VoxelTerrainId === params.terrainId) {
			console.warn("Cannot delete active terrain. Switch to another terrain first.");
			return;
		}

		const terrain = campaign.VoxelTerrains[index];
		campaign.VoxelTerrains.splice(index, 1);

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

	setActive(params: { terrainId: string | undefined }, context: Context): void {
		const campaign = CampaignActions.getActiveCampaign(context);

		if (!params.terrainId) {
			const fallback = campaign.VoxelTerrains[0];
			if (!fallback) {
				console.warn("No voxel terrain available to activate");
				return;
			}
			params.terrainId = fallback.Id;
		}

		const terrain = campaign.VoxelTerrains.find((t) => t.Id === params.terrainId);
		if (!terrain) {
			console.warn(`Voxel terrain not found: ${params.terrainId}`);
			return;
		}

		campaign.GameState.VoxelTerrainId = terrain.Id;

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

		VoxelTerrainActions.validateActors(context);
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

		VoxelTerrainActions.validateActorArray(
			campaign.GameState.Entities,
			terrain,
			occupiedTiles,
			"entity",
			context
		);
		VoxelTerrainActions.validateActorArray(
			campaign.GameState.Characters,
			terrain,
			occupiedTiles,
			"character",
			context
		);
	},

	validateActorArray(
		actors: Actor[],
		terrain: VoxelTerrain,
		occupiedTiles: Set<string>,
		type: "entity" | "character",
		context: Context
	): void {
		const toRemove: string[] = [];
		const surfaceData = getVoxelTerrainSurfaceData(terrain);

		for (const actor of actors) {
			actor.Position.x = Math.round(actor.Position.x);
			actor.Position.y = Math.round(actor.Position.y);
			actor.Position.h = Math.round(actor.Position.h);

			if (!VoxelTerrainActions.isInBounds(actor.Position.x, actor.Position.y, terrain)) {
				const validPosition = VoxelTerrainActions.findValidPosition(actor, terrain, occupiedTiles);
				if (validPosition) {
					actor.Position = validPosition;
					occupiedTiles.add(
						`${validPosition.x},${validPosition.y},${validPosition.h}`
					);
				} else {
					toRemove.push(actor.Id);
				}
				continue;
			}

			const isItem = isItemEntity(actor);
			if (
				!isItem &&
				!actor.CanFly &&
				getSurfaceHeights(surfaceData, actor.Position.x, actor.Position.y).length === 0
			) {
				const validPosition = VoxelTerrainActions.findValidPosition(actor, terrain, occupiedTiles);
				if (validPosition) {
					actor.Position = validPosition;
					occupiedTiles.add(
						`${validPosition.x},${validPosition.y},${validPosition.h}`
					);
				} else {
					toRemove.push(actor.Id);
				}
				continue;
			}

			VoxelTerrainActions.adjustHeight(actor, terrain, surfaceData);

			if (isItem) {
				continue;
			}

			const tileKey = `${actor.Position.x},${actor.Position.y},${actor.Position.h}`;
			if (occupiedTiles.has(tileKey)) {
				const validPosition = VoxelTerrainActions.findValidPosition(actor, terrain, occupiedTiles);
				if (validPosition) {
					actor.Position = validPosition;
					occupiedTiles.add(
						`${validPosition.x},${validPosition.y},${validPosition.h}`
					);
				} else {
					toRemove.push(actor.Id);
				}
			} else {
				occupiedTiles.add(tileKey);
			}
		}

		for (const actorId of toRemove) {
			const index = actors.findIndex((actor) => actor.Id === actorId);
			if (index === -1) continue;

			const actor = actors[index];
			actors.splice(index, 1);
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
		surfaceData = getVoxelTerrainSurfaceData(terrain)
	): void {
		actor.Position.h = getAdjustedActorHeight(actor, terrain, surfaceData);
	},

	findValidPosition(
		actor: Actor,
		terrain: VoxelTerrain,
		occupiedTiles: Set<string>
	): { x: number; y: number; h: number } | null {
		const maxHeight = Math.ceil(Math.max(terrain.Height, getMaxVoxelSurfaceHeight(terrain)));
		const surfaceData = getVoxelTerrainSurfaceData(terrain);
		const isPositionAvailable = (x: number, y: number, h: number): boolean =>
			VoxelTerrainActions.isInBounds(x, y, terrain) && !occupiedTiles.has(`${x},${y},${h}`);

		const findAvailableHeight = (x: number, y: number): number | null => {
			if (!VoxelTerrainActions.isInBounds(x, y, terrain)) return null;

			if (!actor.CanFly) {
				const surfaces = getSurfaceHeights(surfaceData, x, y);
				if (surfaces.length === 0) {
					return null;
				}
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
