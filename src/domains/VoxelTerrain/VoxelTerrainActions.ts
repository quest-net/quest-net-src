// domains/VoxelTerrain/VoxelTerrainActions.ts

import { CampaignUtils } from "../Campaign/CampaignUtils";
import type { Context } from "../Context/Context";
import { LogActions } from "../Log/LogActions";
import {
	getMaterializedContentHash,
	getTerrainVoxels,
} from "../../utils/terrain/data/terrainPayloadStore";
import type { EditableVoxelTerrain } from "./VoxelTerrain";
import { terrainLinkReferencesTerrain } from "../TerrainLink/TerrainLink";
import { TerrainStorageService } from "../../services/TerrainStorageService";
import { VoxelTerrainUtils } from "./VoxelTerrainUtils";

export const VoxelTerrainActions = {
	async create(
		params: { terrain: EditableVoxelTerrain },
		context: Context
	): Promise<void> {
		const campaign = CampaignUtils.getActiveCampaign(context);

		// Split the authored payload off the canonical object: voxels go to the
		// per-client store + IndexedDB; only metadata (incl. ContentHash) lands on
		// the campaign and travels through state sync.
		const { Voxels, ...meta } = params.terrain;
		TerrainStorageService.materialize(meta, Voxels);
		campaign.VoxelTerrains.push(meta);
		await TerrainStorageService.saveTerrain(campaign, meta);

		LogActions.create(
			{
				action: "Terrain created",
				details: `${meta.Name} (${meta.Width}x${meta.Length})`,
				category: "system",
				level: "info",
				visibility: ["dm"],
			},
			context
		);
	},

	async edit(
		params: {
			terrainId: string;
			updates: Partial<EditableVoxelTerrain>;
			repairActors?: boolean;
		},
		context: Context
	): Promise<void> {
		const campaign = CampaignUtils.getActiveCampaign(context);
		const terrain = campaign.VoxelTerrains.find((t) => t.Id === params.terrainId);
		if (!terrain) {
			console.warn(`Voxel terrain not found: ${params.terrainId}`);
			return;
		}

		const { Voxels, ...metaUpdates } = params.updates;

		// Capture the pre-edit base BEFORE materialize overwrites the buffer, so the
		// DM can broadcast a delta (changed voxels only) instead of forcing every
		// player to re-fetch the full payload. Empty base / missing hash -> no delta
		// (broadcastTerrainDelta skips), and players fall back to the full fetch.
		const oldBytes = getTerrainVoxels(terrain.Id);
		const baseHash = getMaterializedContentHash(terrain.Id);
		const oldWidth = terrain.Width;
		const oldLength = terrain.Length;
		const oldHeight = terrain.Height;
		const oldResolution = terrain.Resolution ?? 1;

		Object.assign(terrain, metaUpdates);

		// A voxel edit re-materializes the payload and stamps a fresh ContentHash
		// (which is what tells every client their cached payload is now stale).
		if (Voxels !== undefined) {
			const newHash = TerrainStorageService.materialize(terrain, Voxels);
			await TerrainStorageService.saveTerrain(campaign, terrain);

			// A dimension/resolution change rewrites the coordinate space wholesale;
			// skip the delta and let players full-fetch (the threshold guard would
			// reject it anyway, but this avoids the diff work).
			const dimensionsChanged =
				terrain.Width !== oldWidth ||
				terrain.Length !== oldLength ||
				terrain.Height !== oldHeight ||
				(terrain.Resolution ?? 1) !== oldResolution;

			if (!dimensionsChanged) {
				TerrainStorageService.broadcastTerrainDelta({
					terrainId: terrain.Id,
					oldBytes,
					newBytes: Voxels,
					baseHash,
					newHash,
				});
			}
		}

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
			VoxelTerrainUtils.repairActors(context);
		}
	},

	async delete(params: { terrainId: string }, context: Context): Promise<void> {
		const campaign = CampaignUtils.getActiveCampaign(context);
		const arrayIndex = campaign.VoxelTerrains.findIndex((t) => t.Id === params.terrainId);
		if (arrayIndex === -1) {
			console.warn(`Voxel terrain not found: ${params.terrainId}`);
			return;
		}

		const terrain = campaign.VoxelTerrains[arrayIndex];

		// Protected terrains (last spawnable, or referenced by a scenario) can't
		// be deleted. The UI already hides the control in these cases; this is the
		// authoritative backstop.
		if (VoxelTerrainUtils.isDeleteProtected(campaign, terrain.Id)) {
			console.warn(`Terrain delete blocked (protected): ${terrain.Name}`);
			return;
		}

		campaign.VoxelTerrains.splice(arrayIndex, 1);
		await TerrainStorageService.deleteTerrain(campaign, terrain);

		// Cascade: purge any terrain link that anchors to the deleted terrain,
		// otherwise the world-map graph and hover logic would carry dangling edges.
		// Geometry edits never touch links; only deletion does.
		if (Array.isArray(campaign.TerrainLinks)) {
			campaign.TerrainLinks = campaign.TerrainLinks.filter(
				(link) => !terrainLinkReferencesTerrain(link, terrain.Id)
			);
		}

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

	/**
	 * Relocates a specific set of actors (by id, characters and/or entities) to
	 * `toTerrainId`, then validates/snaps them against the destination geometry.
	 * This is the DM's actor-management "move" gesture, driven by selection in the
	 * Overview/Inspector rather than by which terrain is being viewed. Actors not
	 * named in `actorIds`, and any already on the destination, are untouched.
	 */
	async moveActors(
		params: { actorIds: string[]; toTerrainId: string },
		context: Context
	): Promise<void> {
		const campaign = CampaignUtils.getActiveCampaign(context);
		if (!params.actorIds?.length) return;

		// Hydrate the destination so positions can be validated against it.
		const destination = await TerrainStorageService.hydrateTerrain(
			campaign,
			params.toTerrainId
		);
		if (!destination) {
			console.warn(`Destination terrain not found: ${params.toTerrainId}`);
			return;
		}

		const combatActive = campaign.GameState.CombatState?.isActive ?? false;
		const idSet = new Set(params.actorIds);
		const actors = [
			...campaign.GameState.Characters,
			...campaign.GameState.Entities,
		];

		let movedCount = 0;
		for (const actor of actors) {
			if (!idSet.has(actor.Id)) continue;
			if (actor.Position.terrainId === params.toTerrainId) continue;
			actor.Position = { ...actor.Position, terrainId: params.toTerrainId };
			// Re-anchor the combat movement budget to the new terrain (section 5.7).
			if (combatActive && actor.TurnStartPosition) {
				actor.TurnStartPosition = { ...actor.Position };
			}
			movedCount++;
		}

		if (movedCount === 0) return;

		VoxelTerrainUtils.repairActors(context);

		LogActions.create(
			{
				action: "Actors moved",
				details: `${movedCount} actor(s) moved to ${destination.Name}`,
				category: "system",
				level: "important",
				visibility: ["all"],
			},
			context
		);
	},

	bulkEditTags(
		params: { updates: Array<{ terrainId: string; tags: string[] }> },
		context: Context
	): void {
		const campaign = CampaignUtils.getActiveCampaign(context);

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
};
