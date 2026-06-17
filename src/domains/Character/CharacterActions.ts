// domains/Character/CharacterActions.ts

import { Context } from "../Context/Context";
import { Character } from "./Character";
import { CampaignUtils } from "../Campaign/CampaignUtils";
import { LogActions } from "../Log/LogActions";
import { ACTOR_DEFAULT_COLORS, Position } from "../Actor/Actor";
import { getVoxelSpawnPosition, getVoxelTerrainById } from "../VoxelTerrain/VoxelTerrainQueries";
import { VoxelTerrainUtils } from "../VoxelTerrain/VoxelTerrainUtils";

/**
 * Character action handlers
 * Characters are unique, persistent actors that move between Roster and GameState
 * Unlike Entities, Characters are never cloned - they MOVE between locations
 */
export const CharacterActions = {
	create(
		params: { character: Character },
		context: Context
	): void {
		const campaign = CampaignUtils.getActiveCampaign(context);

		const character: Character = {
			...params.character,
			Color: params.character.Color ?? ACTOR_DEFAULT_COLORS.CHARACTER,
			Notes: params.character.Notes || [],
			// Ensure stats are fully healed upon creation
			Stats: params.character.Stats.map((stat) => ({
				...stat,
				Current: stat.Max,
			})),
		};

		campaign.CharacterRoster.push(character);

		LogActions.create(
			{
				action: "Character created",
				details: `${character.Name} added to roster`,
				category: "character",
				level: "info",
				visibility: ["dm", "owner"],
				actorId: character.Id,
			},
			context
		);
	},
	/**
	 * Creates a new character and immediately spawns them into the game
	 * Used by players during character selection
	 */
	createAndSpawn(
		params: { character: Character; terrainId?: string },
		context: Context
	): void {
		const campaign = CampaignUtils.getActiveCampaign(context);
		// A player creating a character cannot know the world layout, so default
		// to the first terrain in the list (§5.4). The DM may relocate later.
		const terrainId = params.terrainId ?? campaign.VoxelTerrains[0]?.Id ?? "";
		const voxelSpawnPosition = getVoxelSpawnPosition(
			campaign,
			terrainId,
			params.character.CanFly
		);

		const character: Character = {
			...params.character,
			Color: params.character.Color ?? ACTOR_DEFAULT_COLORS.CHARACTER,
			Notes: params.character.Notes || [],
			Position: voxelSpawnPosition ?? { terrainId, x: 0, y: 0, h: 0 },
			// Ensure stats are fully healed upon creation
			Stats: params.character.Stats.map((stat) => ({
				...stat,
				Current: stat.Max,
			})),
		};

		// Add directly to GameState (skip roster entirely)
		campaign.GameState.Characters.push(character);

		LogActions.create(
			{
				action: "Character created and spawned",
				details: `${character.Name} joined the game`,
				category: "character",
				level: "important",
				visibility: ["all"],
				actorId: character.Id,
			},
			context
		);

		if (getVoxelTerrainById(campaign, terrainId)) {
			VoxelTerrainUtils.repairActors(context);
		}
	},

	/**
	 * Spawns a character from roster onto the field (MOVE operation)
	 * Position defaults to a spawn point on the target terrain if not provided
	 * DM only - handled by ACTION_REGISTRY
	 */
	spawn(
		params: { characterId: string; terrainId?: string; position?: Position },
		context: Context
	): void {
		const campaign = CampaignUtils.getActiveCampaign(context);

		const rosterIndex = campaign.CharacterRoster.findIndex(
			(c) => c.Id === params.characterId
		);
		if (rosterIndex === -1) {
			console.warn(`Character not found in roster: ${params.characterId}`);
			return;
		}

		const alreadySpawned = campaign.GameState.Characters.some(
			(c) => c.Id === params.characterId
		);
		if (alreadySpawned) {
			console.warn(`Character already spawned: ${params.characterId}`);
			return;
		}
		// MOVE: Remove from roster
		const [character] = campaign.CharacterRoster.splice(rosterIndex, 1);
		// Prefer an explicit position's terrain, then a caller terrain, then the
		// first terrain in the list as the default landing (§5.4).
		const terrainId =
			params.position?.terrainId ??
			params.terrainId ??
			campaign.VoxelTerrains[0]?.Id ??
			"";
		const voxelSpawnPosition = getVoxelSpawnPosition(
			campaign,
			terrainId,
			character.CanFly
		);

		// Set position from the target voxel terrain if not provided.
		if (params.position) {
			character.Position = params.position;
		} else {
			character.Position = voxelSpawnPosition ?? { terrainId, x: 0, y: 0, h: 0 };
		}

		// Add to GameState
		campaign.GameState.Characters.push(character);

		LogActions.create(
			{
				action: "Character spawned",
				details: `${character.Name} entered the field`,
				category: "character",
				level: "important",
				visibility: ["all"],
				actorId: character.Id,
			},
			context
		);

		if (getVoxelTerrainById(campaign, terrainId)) {
			VoxelTerrainUtils.repairActors(context);
		}
	},

	/**
	 * Removes a character from the field (MOVE operation)
	 * Moves character back to roster, preserving all state changes
	 * DM only - handled by ACTION_REGISTRY
	 */
	remove(params: { characterId: string }, context: Context): void {
		const campaign = CampaignUtils.getActiveCampaign(context);

		const gameStateIndex = campaign.GameState.Characters.findIndex(
			(c) => c.Id === params.characterId
		);
		if (gameStateIndex === -1) {
			console.warn(`Character not found in GameState: ${params.characterId}`);
			return;
		}

		// Clear impersonation if DM was impersonating this character
		const impersonated = (context.User.ImpersonatedActors ?? {})[campaign.RoomCode];
		if (impersonated === params.characterId) {
			if (!context.User.ImpersonatedActors) context.User.ImpersonatedActors = {};
			delete context.User.ImpersonatedActors[campaign.RoomCode];
		}

		const alreadyInRoster = campaign.CharacterRoster.some(
			(c) => c.Id === params.characterId
		);
		if (alreadyInRoster) {
			console.warn(
				`Character already in roster: ${params.characterId}. Removing from GameState only.`
			);
			campaign.GameState.Characters.splice(gameStateIndex, 1);
			return;
		}

		// MOVE: Remove from GameState
		const [character] = campaign.GameState.Characters.splice(gameStateIndex, 1);

		// Add back to roster
		campaign.CharacterRoster.push(character);

		LogActions.create(
			{
				action: "Character removed",
				details: `${character.Name} left the field and returned to roster`,
				category: "character",
				level: "important",
				visibility: ["all"],
				actorId: params.characterId,
			},
			context
		);
	},

};
