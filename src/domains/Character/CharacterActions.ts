// domains/Character/CharacterActions.ts

import { Context } from "../Context/Context";
import { Character } from "./Character";
import { CampaignActions } from "../Campaign/CampaignActions";
import { LogActions } from "../Log/LogActions";
import { ActorActions } from "../Actor/ActorActions";
import { ACTOR_DEFAULT_COLORS, Position } from "../Actor/Actor";
import { createDefaultStatSlots, createDefaultActionSlots, createDefaultAttributeSlots } from "../../utils/ActorResolvers";
import { getVoxelSpawnPosition, getVoxelTerrainById } from "../../utils/terrain/data/VoxelTerrainUtils";
import { VoxelTerrainActions } from "../VoxelTerrain/VoxelTerrainActions";

/**
 * Character action handlers
 * Characters are unique, persistent actors that move between Roster and GameState
 * Unlike Entities, Characters are never cloned - they MOVE between locations
 */
export const CharacterActions = {
	/**
	 * Creates a default character with campaign stat definitions
	 */
	createDefault(context: Context): Character {
		const campaign = CampaignActions.getActiveCampaign(context);
		const settings = campaign.Settings;

		return {
			Id: crypto.randomUUID(),
			Name: "New Character",
			Description: "",
			Image: undefined,
			Color: ACTOR_DEFAULT_COLORS.CHARACTER,
			Stats: createDefaultStatSlots(settings.StatDefinitions),
			Actions: createDefaultActionSlots(settings.ActionDefinitions),
			Attributes: createDefaultAttributeSlots(settings.AttributeDefinitions ?? []),
			// Roster default; terrainId is assigned when the character is spawned.
			Position: { terrainId: "", x: 0, y: 0, h: 0 },
			MoveSpeed: 5,
			CanFly: false,
			Size: "small",
			Inventory: [],
			Equipment: [],
			Skills: [],
			Statuses: [],
			Tags: [],
			Notes: [],
			CritMessage: undefined,
		};
	},

	create(
		params: { character: Character },
		context: Context
	): void {
		const campaign = CampaignActions.getActiveCampaign(context);

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
		const campaign = CampaignActions.getActiveCampaign(context);
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
			VoxelTerrainActions.repairActors(context);
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
		const campaign = CampaignActions.getActiveCampaign(context);

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
			VoxelTerrainActions.repairActors(context);
		}
	},

	/**
	 * Removes a character from the field (MOVE operation)
	 * Moves character back to roster, preserving all state changes
	 * DM only - handled by ACTION_REGISTRY
	 */
	remove(params: { characterId: string }, context: Context): void {
		const campaign = CampaignActions.getActiveCampaign(context);

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

	edit(
		params: { characterId: string; updates: Partial<Character> },
		context: Context
	): void {
		ActorActions.editActor(
			"character",
			{ actorId: params.characterId, updates: params.updates },
			context
		);
	},

	delete(params: { characterId: string }, context: Context): void {
		const campaign = CampaignActions.getActiveCampaign(context);

		const isSpawned = campaign.GameState.Characters.some(
			(c) => c.Id === params.characterId
		);
		if (isSpawned) {
			console.warn(
				`Cannot delete spawned character: ${params.characterId}. Remove from field first.`
			);
			return;
		}

		ActorActions.deleteActor(
			"character",
			{ actorId: params.characterId },
			context
		);
	},

	/**
	 * Moves a character to a new position
	 * Players can only move their own characters
	 */
	move(
		params: { characterId: string; position: Position },
		context: Context
	): void {
		const campaign = CampaignActions.getActiveCampaign(context);
		const character = campaign.GameState.Characters.find(
			(c) => c.Id === params.characterId
		);

		if (!character) {
			console.warn(`Character not found in GameState: ${params.characterId}`);
			return;
		}

		if (!ActorActions.isValidPosition(params.position)) {
			console.warn(`Invalid character move position: ${params.characterId}`);
			return;
		}

		if (context.User.Role === "player") {
			if (
				context.User.SelectedCharacters?.[campaign.RoomCode] !==
				params.characterId
			) {
				console.warn(
					`Player ${context.User.Id} cannot move character: ${params.characterId}`
				);
				return;
			}

			// Movement-range restriction is enforced entirely client-side now (world
			// view blocks out-of-range clicks; first-person applies a soft pull-back
			// toward the turn-start position). The DM trusts the requested position
			// rather than re-validating range here.
		}

		ActorActions.moveActor(
			"character",
			{ actorId: params.characterId, position: params.position },
			context
		);
	},

	/**
	 * Bulk edit tags for multiple characters
	 */
	bulkEditTags(
		params: { updates: Array<{ characterId: string; tags: string[] }> },
		context: Context
	): void {
		ActorActions.bulkEditTags(
			"character",
			{
				updates: params.updates.map((update) => ({
					actorId: update.characterId,
					tags: update.tags,
				})),
			},
			context
		);
	},
};
