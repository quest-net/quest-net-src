// domains/VoxelTerrain/VoxelTerrainActions.ts

import type { Actor, Position } from "../Actor/Actor";
import type { Character } from "../Character/Character";
import { CampaignActions } from "../Campaign/CampaignActions";
import type { Campaign } from "../Campaign/Campaign";
import type { Context } from "../Context/Context";
import { isItemEntity } from "../Item/ItemDropUtils";
import { LogActions } from "../Log/LogActions";
import {
	getVoxelTerrainById,
	getMaxVoxelSurfaceHeight,
} from "../../utils/terrain/data/VoxelTerrainUtils";
import {
	getVoxelTerrainIndex,
	type VoxelTerrainIndex,
} from "../../utils/terrain/data/VoxelTerrainIndex";
import { createFlatVoxelTerrain } from "../../utils/terrain/editor/VoxelTerrainEditorUtils";
import { isStampTerrain } from "../../utils/terrain/editor/VoxelStampUtils";
import type { EditableVoxelTerrain, VoxelTerrain } from "./VoxelTerrain";
import { getScenarioTerrainIds } from "../Scenario/Scenario";
import { doorReferencesTerrain } from "../Door/Door";
import { TerrainStorageService } from "../../services/TerrainStorageService";

const FLYING_ACTOR_CLEARANCE_BY_SIZE = {
	"extra-small": 1,
	small: 1.25,
	medium: 1.5,
	large: 1.75,
} as const;

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

function getCenterTile(terrain: VoxelTerrain): { x: number; y: number } {
	return {
		x: Math.max(0, Math.min(terrain.Width - 1, Math.floor(terrain.Width / 2))),
		y: Math.max(0, Math.min(terrain.Length - 1, Math.floor(terrain.Length / 2))),
	};
}

function isInBounds(x: number, y: number, terrain: VoxelTerrain): boolean {
	return x >= 0 && x < terrain.Width && y >= 0 && y < terrain.Length;
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

function getSurfaceHeights(
	index: VoxelTerrainIndex,
	x: number,
	y: number
): readonly number[] {
	return index.allSurfaces.get(`${x},${y}`) ?? [];
}

function getFlyingActorClearance(actor: Actor): number {
	return FLYING_ACTOR_CLEARANCE_BY_SIZE[actor.Size ?? "small"];
}

function normalizeHeight(height: number): number {
	const rounded = Math.round(height);
	return Math.abs(height - rounded) <= POSITION_HEIGHT_EPSILON
		? rounded
		: height;
}

function normalizePositionForValidation(
	position: Position,
	terrain: VoxelTerrain
): Position | null {
	if (
		!Number.isFinite(position.x) ||
		!Number.isFinite(position.y) ||
		!Number.isFinite(position.h)
	) {
		return null;
	}

	return {
		terrainId: terrain.Id,
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

function isFlyingHeightClear(
	actor: Actor,
	terrain: VoxelTerrain,
	index: VoxelTerrainIndex,
	x: number,
	y: number,
	h: number
): boolean {
	if (!isInBounds(x, y, terrain)) return false;
	if (h < 0) return false;
	if (h > getMaxActorHeight(terrain)) return false;

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

function validateActorPositionForTerrain(
	actor: Actor,
	position: Position,
	terrain: VoxelTerrain,
	index: VoxelTerrainIndex,
	occupiedTiles?: ReadonlySet<string>
): ActorPositionValidationResult {
	const normalized = normalizePositionForValidation(position, terrain);
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

		if (isFlyingHeightClear(actor, terrain, index, normalized.x, normalized.y, normalized.h)) {
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
		// Only actors that actually live on this terrain occupy its tiles.
		if (actor.Position.terrainId !== terrain.Id) continue;

		const validation = validateActorPositionForTerrain(
			actor,
			actor.Position,
			terrain,
			index
		);
		const position =
			validation.ok
				? validation.position
				: normalizePositionForValidation(actor.Position, terrain);
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

export const VoxelTerrainActions = {
	/**
	 * Creates the default voxel terrain that every campaign starts with.
	 */
	createDefault(): EditableVoxelTerrain {
		return createFlatVoxelTerrain({
			id: crypto.randomUUID(),
			name: "Default Terrain",
			width: 16,
			length: 16,
			height: 4,
			maxHeight: 8,
		});
	},

	createNew(): EditableVoxelTerrain {
		return createFlatVoxelTerrain({
			id: crypto.randomUUID(),
			name: "New Terrain",
			width: 20,
			length: 20,
		});
	},

	async create(
		params: { terrain: EditableVoxelTerrain },
		context: Context
	): Promise<void> {
		const campaign = CampaignActions.getActiveCampaign(context);

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
		const campaign = CampaignActions.getActiveCampaign(context);
		const terrain = campaign.VoxelTerrains.find((t) => t.Id === params.terrainId);
		if (!terrain) {
			console.warn(`Voxel terrain not found: ${params.terrainId}`);
			return;
		}

		const { Voxels, ...metaUpdates } = params.updates;
		Object.assign(terrain, metaUpdates);

		// A voxel edit re-materializes the payload and stamps a fresh ContentHash
		// (which is what tells every client their cached payload is now stale).
		if (Voxels !== undefined) {
			TerrainStorageService.materialize(terrain, Voxels);
			await TerrainStorageService.saveTerrain(campaign, terrain);
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
			VoxelTerrainActions.repairActors(context);
		}
	},

	/**
	 * Whether a terrain is shielded from deletion. Two reasons:
	 *  - it is the campaign's last non-stamp terrain (something must remain for
	 *    new characters to spawn on; stamp terrains are brushes, not places), or
	 *  - a scenario references it (deleting it would leave that scenario
	 *    unloadable).
	 * Used both to gate the delete action and to hide the delete control.
	 */
	isDeleteProtected(campaign: Campaign, terrainId: string): boolean {
		const terrain = campaign.VoxelTerrains.find((t) => t.Id === terrainId);
		if (!terrain) return false;

		const isLastSpawnable =
			!isStampTerrain(terrain) &&
			campaign.VoxelTerrains.filter((t) => !isStampTerrain(t)).length <= 1;

		const referencedByScenario = campaign.Scenarios.some((s) =>
			getScenarioTerrainIds(s).has(terrainId)
		);

		return isLastSpawnable || referencedByScenario;
	},

	async delete(params: { terrainId: string }, context: Context): Promise<void> {
		const campaign = CampaignActions.getActiveCampaign(context);
		const arrayIndex = campaign.VoxelTerrains.findIndex((t) => t.Id === params.terrainId);
		if (arrayIndex === -1) {
			console.warn(`Voxel terrain not found: ${params.terrainId}`);
			return;
		}

		const terrain = campaign.VoxelTerrains[arrayIndex];

		// Protected terrains (last spawnable, or referenced by a scenario) can't
		// be deleted. The UI already hides the control in these cases; this is the
		// authoritative backstop.
		if (VoxelTerrainActions.isDeleteProtected(campaign, terrain.Id)) {
			console.warn(`Terrain delete blocked (protected): ${terrain.Name}`);
			return;
		}

		campaign.VoxelTerrains.splice(arrayIndex, 1);
		await TerrainStorageService.deleteTerrain(campaign, terrain);

		// Cascade: purge any door that anchors to the deleted terrain, otherwise
		// the world-map graph and hover logic would carry dangling edges. Geometry
		// edits never touch doors; only deletion does. See multi-terrain-world §4.3.
		if (Array.isArray(campaign.Doors)) {
			campaign.Doors = campaign.Doors.filter(
				(door) => !doorReferencesTerrain(door, terrain.Id)
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
	 * See docs/multi-terrain-world.md §5.3.
	 */
	async moveActors(
		params: { actorIds: string[]; toTerrainId: string },
		context: Context
	): Promise<void> {
		const campaign = CampaignActions.getActiveCampaign(context);
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
			// Re-anchor the combat movement budget to the new terrain (§5.7).
			if (combatActive && actor.TurnStartPosition) {
				actor.TurnStartPosition = { ...actor.Position };
			}
			movedCount++;
		}

		if (movedCount === 0) return;

		VoxelTerrainActions.repairActors(context);

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

	/**
	 * Validates and snaps every on-field actor against the geometry of the
	 * terrain it actually lives in. Runs one pass per distinct, hydrated terrain
	 * that has occupants; terrains that are not hydrated on this client are
	 * skipped (their actors are validated by whoever is rendering them). See
	 * docs/multi-terrain-world.md §6.2.
	 */
	repairActors(context: Context): void {
		const campaign = CampaignActions.getActiveCampaign(context);

		const terrainIds = new Set<string>();
		for (const actor of campaign.GameState.Characters) {
			terrainIds.add(actor.Position.terrainId);
		}
		for (const actor of campaign.GameState.Entities) {
			terrainIds.add(actor.Position.terrainId);
		}

		for (const terrainId of terrainIds) {
			const terrain = getVoxelTerrainById(campaign, terrainId);
			if (!terrain || !TerrainStorageService.isHydrated(terrain)) continue;

			const occupiedTiles = new Set<string>();
			const index = getVoxelTerrainIndex(terrain);

			VoxelTerrainActions.repairActorArray(
				campaign.GameState.Entities,
				terrain,
				index,
				occupiedTiles,
				"entity",
				campaign,
				context
			);
			VoxelTerrainActions.repairActorArray(
				campaign.GameState.Characters,
				terrain,
				index,
				occupiedTiles,
				"character",
				campaign,
				context
			);
		}
	},

	/**
	 * Repairs the subset of `actors` that live on `terrain` (matched by
	 * `Position.terrainId`). Operates on the live GameState array so removals of
	 * unplaceable actors take effect, but only touches actors on this terrain.
	 */
	repairActorArray(
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
				occupiedTiles.add(positionKey(validPosition));
			} else {
				toRemove.push(actor.Id);
			}
		};

		for (const actor of actors) {
			if (actor.Position.terrainId !== terrain.Id) continue;
			const isItem = isItemEntity(actor);
			const validation = validateActorPositionForTerrain(
				actor,
				actor.Position,
				terrain,
				index,
				occupiedTiles
			);

			if (!validation.ok) {
				reposition(actor);
				continue;
			}

			actor.Position = validation.position;

			if (!isItem) {
				occupiedTiles.add(positionKey(validation.position));
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
		return isInBounds(x, y, terrain);
	},

	validateActorMove(
		actor: Actor,
		position: Position,
		campaign: Campaign
	): ActorPositionValidationResult {
		// Moves are intra-terrain: validate against the actor's OWN terrain, never
		// a global "active" one. The target keeps the actor's terrainId.
		const terrainId = actor.Position.terrainId;
		const terrain = getVoxelTerrainById(campaign, terrainId);

		// If this client does not have the terrain hydrated (e.g. the DM
		// validating a player on a terrain it is not viewing and that is not
		// tactically loaded), trust the submitted position — the originating
		// client validated it locally against its own fully-hydrated terrain.
		// See docs/multi-terrain-world.md §6.2.
		if (!terrain || !TerrainStorageService.isHydrated(terrain)) {
			if (
				!Number.isFinite(position.x) ||
				!Number.isFinite(position.y) ||
				!Number.isFinite(position.h)
			) {
				return { ok: false, reason: "position is not finite" };
			}
			return {
				ok: true,
				position: {
					terrainId,
					x: position.x,
					y: position.y,
					h: position.h,
				},
				mode: isItemEntity(actor) ? "item" : "standing",
			};
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
	): Position | null {
		const maxHeight = getMaxActorHeight(terrain);
		const normalizedCurrent =
			normalizePositionForValidation(actor.Position, terrain) ?? actor.Position;
		const isPositionAvailable = (x: number, y: number, h: number): Position | null => {
			const validation = validateActorPositionForTerrain(
				actor,
				{ terrainId: terrain.Id, x, y, h },
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
				for (const h of surfaces) {
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

		// Step 2: prefer horizontal displacement to a nearby tile. We deliberately
		// skip the actor's own column here so a collision doesn't "teleport" them
		// up to the next surface in the same column.
		const displaced = findTileFromCenter(terrain, (x, y) => {
			if (x === normalizedCurrent.x && y === normalizedCurrent.y) return null;
			return findAvailablePosition(x, y);
		});
		if (displaced) return displaced;

		// Step 3: last resort -- fall back to another valid height in the original
		// column.
		return findAvailablePosition(normalizedCurrent.x, normalizedCurrent.y);
	},
};
