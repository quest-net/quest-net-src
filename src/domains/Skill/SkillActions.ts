// domains/Skill/SkillActions.ts

import { Context } from "../Context/Context";
import { CampaignUtils } from "../Campaign/CampaignUtils";
import { LogActions } from "../Log/LogActions";
import { Skill } from "./Skill";
import { Actor, Position } from "../Actor/Actor";
import { rollDiceFormula, getRollOutcome } from "../../utils/DiceUtils";
import { syncSkillSlotsAfterEdit } from "./SkillUtils";
import { getAllActors, applyActionCost, applyStatCost, describeUseTarget } from "../Actor/ActorUtils";

/**
 * Skill action handlers
 * Skills are templates stored at Campaign.SkillTemplates
 */
export const SkillActions = {
	/**
	 * Creates a new skill and adds to the campaign skill templates
	 */
	create(params: { skill: Skill }, context: Context): void {
		const campaign = CampaignUtils.getActiveCampaign(context);
		campaign.SkillTemplates.push(params.skill);

		LogActions.create(
			{
				action: "Skill created",
				details: `${params.skill.Name} added to skill templates`,
				category: "skill",
				level: "info",
				visibility: ["dm", "owner"],
			},
			context
		);
	},

	/**
	 * Edits an existing skill
	 * Syncs all actor slots if MaxUses changes
	 */
	edit(
		params: { skillId: string; updates: Partial<Skill> },
		context: Context
	): void {
		const campaign = CampaignUtils.getActiveCampaign(context);
		const idx = campaign.SkillTemplates.findIndex((s) => s.Id === params.skillId);
		if (idx === -1) {
			console.warn(`Skill not found: ${params.skillId}`);
			return;
		}

		const oldMaxUses = campaign.SkillTemplates[idx].MaxUses;
		const newMaxUses = params.updates.MaxUses;

		// Apply updates
		campaign.SkillTemplates[idx] = {
			...campaign.SkillTemplates[idx],
			...params.updates,
			Id: campaign.SkillTemplates[idx].Id, // guard against accidental Id overwrite
		};

		// If MaxUses changed, sync all actor slots
		if (newMaxUses !== oldMaxUses) {
			const allActors = getAllActors(campaign);
			syncSkillSlotsAfterEdit(params.skillId, newMaxUses, allActors);
		}

		LogActions.create(
			{
				action: "Skill edited",
				details: `${campaign.SkillTemplates[idx].Name} updated`,
				category: "skill",
				level: "info",
				visibility: ["dm"],
			},
			context
		);
	},

	/**
	 * Deletes a skill template permanently
	 */
	delete(params: { skillId: string }, context: Context): void {
		const campaign = CampaignUtils.getActiveCampaign(context);
		const idx = campaign.SkillTemplates.findIndex((s) => s.Id === params.skillId);
		if (idx === -1) {
			console.warn(`Skill not found: ${params.skillId}`);
			return;
		}
		const [removed] = campaign.SkillTemplates.splice(idx, 1);

		LogActions.create(
			{
				action: "Skill deleted",
				details: `${removed?.Name ?? "Skill"} removed from templates`,
				category: "skill",
				level: "important",
				visibility: ["dm"],
			},
			context
		);
	},

	/**
	 * Gives skills to actors (characters or entities)
	 * Each actor receives `count` copies of each skill
	 * 
	 * Example: give(["fireball", "heal"], ["hero1", "hero2"], 2)
	 * Result: hero1 and hero2 each receive 2 fireball skills and 2 heal skills
	 */
	give(
		params: {
			skillIds: string[];
			actorIds: string[];
			count: number;
		},
		context: Context
	): void {
		const campaign = CampaignUtils.getActiveCampaign(context);
		
		// Validate count
		const count = Math.max(1, Math.floor(params.count));

		// Combine all actors (IDs are unique)
		const actors: Actor[] = getAllActors(campaign);

		let totalGiven = 0;
		const actorNames: string[] = [];

		// For each actor
		params.actorIds.forEach((actorId) => {
			const actor = actors.find((a) => a.Id === actorId);
			if (!actor) {
				console.warn(`Actor not found: ${actorId}`);
				return;
			}

			actorNames.push(actor.Name);

			// For each skill
			params.skillIds.forEach((skillId) => {
				const skillTemplate = campaign.SkillTemplates.find((s) => s.Id === skillId);
				if (!skillTemplate) {
					console.warn(`Skill template not found: ${skillId}`);
					return;
				}

				// Give `count` copies of this skill to this actor
				for (let i = 0; i < count; i++) {
					actor.Skills.push({
						Id: skillId,
						UsesLeft: skillTemplate.MaxUses, // undefined if MaxUses is undefined
					});
					totalGiven++;
				}
			});
		});

		// Log the action
		if (totalGiven > 0) {
			const skillNames = params.skillIds
				.map((id) => campaign.SkillTemplates.find((s) => s.Id === id)?.Name)
				.filter(Boolean)
				.join(", ");

			LogActions.create(
				{
					action: "Skills given",
					details: `${skillNames} (${totalGiven} total) given to ${actorNames.join(", ")}`,
					category: "skill",
					level: "info",
					visibility: ["dm", "owner"],
				},
				context
			);
		}
	},

	/**
	 * Bulk edit tags for multiple skills
	 */
	bulkEditTags(
		params: { updates: Array<{ skillId: string; tags: string[] }> },
		context: Context
	): void {
		const campaign = CampaignUtils.getActiveCampaign(context);

		let successCount = 0;
		params.updates.forEach((update) => {
			const skill = campaign.SkillTemplates.find((s) => s.Id === update.skillId);
			if (skill) {
				skill.Tags = update.tags;
				successCount++;
			} else {
				console.warn(`Skill not found for bulk update: ${update.skillId}`);
			}
		});

		LogActions.create(
			{
				action: "Skills organized",
				details: `Updated tags for ${successCount} skill(s)`,
				category: "skill",
				level: "info",
				visibility: ["dm"],
			},
			context
		);
	},

	/**
	 * Uses a skill from an actor's skill list
	 * Deducts stat cost (gracefully - doesn't block if insufficient)
	 * Decrements UsesLeft if the skill has limited uses
	 * Rolls dice if the skill has a DiceRoll property
	 * Works with any actor (characters or entities, in any location)
	 */
	use(
		params: {
			actorId: string;
			skillId: string;
			targetActorId?: string;
			targetPosition?: Position;
			/**
			 * Optional dice-formula override. Normally absent (the skill's own
			 * DiceRoll is used); a "before"-phase script may set it to intercept
			 * and rewrite the roll (e.g. a "bless" status adding "+1d4").
			 */
			diceFormula?: string;
		},
		context: Context
	): void {
		const campaign = CampaignUtils.getActiveCampaign(context);

		// Find actor in all possible locations
		const actors: Actor[] = getAllActors(campaign);

		const actor = actors.find((a) => a.Id === params.actorId);
		if (!actor) {
			console.warn(`Actor not found: ${params.actorId}`);
			return;
		}

		// Find the skill template
		const skillTemplate = campaign.SkillTemplates.find((s) => s.Id === params.skillId);
		if (!skillTemplate) {
			console.warn(`Skill template not found: ${params.skillId}`);
			return;
		}

		// Find the skill slot in actor's skills
		const slot = actor.Skills.find((s) => s.Id === params.skillId);
		if (!slot) {
			console.warn(`Skill not found in actor's skills: ${params.skillId}`);
			return;
		}

		// Check if skill has uses left
		if (slot.UsesLeft !== undefined && slot.UsesLeft <= 0) {
			console.warn(`Skill has no uses left: ${skillTemplate.Name}`);
			return;
		}

		// Decrement uses if applicable
		if (slot.UsesLeft !== undefined) {
			slot.UsesLeft--;
		}

		// Handle costs gracefully: deduct to 0, don't block use.
		// If the actor doesn't have the target stat/action, skip that deduction.
		const costDetails =
			applyStatCost(actor, skillTemplate.StatCost, campaign.Settings) +
			applyActionCost(actor, skillTemplate.ActionCost, campaign.Settings);

		// Append the chosen target (actor or position) to the log line. No
		// mechanical effect yet -- the params are carried for the scripting system.
		const targetText = describeUseTarget(campaign, params);

		// Determine visibility based on the ACTOR TYPE
		const visibilitySettings = campaign.Settings.VisibilitySettings;
		let visibility: ("dm" | "player" | "owner" | "all")[];

		// Check if this actor is a character (player-controlled) or entity (DM-controlled)
		const isCharacter = campaign.GameState.Characters.some((c) => c.Id === params.actorId) ||
							campaign.CharacterRoster.some((c) => c.Id === params.actorId);

		if (isCharacter) {
			// Character action - use player visibility rules
			visibility = visibilitySettings.playersSeePeerRolls
				? ["all"]
				: ["dm", "owner"];
		} else {
			// Entity action - use DM visibility rules
			visibility = visibilitySettings.playersSeeDMRolls ? ["all"] : ["dm"];
		}

		// Roll dice if a formula is present. A "before"-phase script may override the
		// skill's own DiceRoll via params.diceFormula (e.g. a "bless" status adding +1d4).
		const diceFormula = (params.diceFormula ?? skillTemplate.DiceRoll ?? "").trim();
		if (diceFormula !== "") {
			try {
				const rollResult = rollDiceFormula(diceFormula);

				LogActions.create(
					{
						action: `${actor.Name} used ${skillTemplate.Name}${targetText} : ${rollResult.total}`,
						details: `${rollResult.formula} : ${rollResult.breakdown}${costDetails}`,
						category: "dice",
						level: "important",
						visibility,
						actorId: params.actorId,
						rollOutcome: getRollOutcome(rollResult),
					},
					context
				);
			} catch (error) {
				console.error(`Failed to roll dice for skill ${skillTemplate.Name}:`, error);

				// Log without dice roll if it fails
				LogActions.create(
					{
						action: `${actor.Name} used ${skillTemplate.Name}${targetText}`,
						details: `${costDetails}${slot.UsesLeft !== undefined ? ` (${slot.UsesLeft} uses left)` : ""}`,
						category: "skill",
						level: "info",
						visibility,
						actorId: params.actorId,
					},
					context
				);
			}
		} else {
			// No dice roll - just log the use
			LogActions.create(
				{
					action: `${actor.Name} used ${skillTemplate.Name}${targetText}`,
					details: `${costDetails}${slot.UsesLeft !== undefined ? ` (${slot.UsesLeft} uses left)` : ""}`,
					category: "skill",
					level: "info",
					visibility,
					actorId: params.actorId,
				},
				context
			);
		}
	},

	/**
	 * Discards a skill from an actor's skill list
	 * Removes the skill entirely
	 * Works with any actor (characters or entities, in any location)
	 */
	discard(
		params: { actorId: string; skillId: string },
		context: Context
	): void {
		const campaign = CampaignUtils.getActiveCampaign(context);

		// Find actor in all possible locations
		const actors: Actor[] = getAllActors(campaign);

		const actor = actors.find((a) => a.Id === params.actorId);
		if (!actor) {
			console.warn(`Actor not found: ${params.actorId}`);
			return;
		}

		// Find the skill template for logging
		const skillTemplate = campaign.SkillTemplates.find((s) => s.Id === params.skillId);
		const skillName = skillTemplate?.Name || "Unknown Skill";

		// Find and remove the skill
		const skillIndex = actor.Skills.findIndex((s) => s.Id === params.skillId);
		if (skillIndex !== -1) {
			actor.Skills.splice(skillIndex, 1);

			LogActions.create(
				{
					action: "Skill discarded",
					details: `${actor.Name} discarded ${skillName}`,
					category: "skill",
					level: "info",
					visibility: ["all"],
					actorId: params.actorId,
				},
				context
			);
			return;
		}

		console.warn(`Skill not found in actor's skills: ${params.skillId}`);
	},

	/**
	 * Adjusts the uses of a skill on an actor
	 * Can set UsesLeft to a specific value or undefined (unlimited)
	 */
	adjustUses(
		params: { actorId: string; skillId: string; usesLeft: number | undefined },
		context: Context
	): void {
		const campaign = CampaignUtils.getActiveCampaign(context);

		// Find actor in all possible locations
		const actors: Actor[] = getAllActors(campaign);

		const actor = actors.find((a) => a.Id === params.actorId);
		if (!actor) {
			console.warn(`Actor not found: ${params.actorId}`);
			return;
		}

		// Find the skill slot (first instance)
		const slot = actor.Skills.find((s) => s.Id === params.skillId);
		if (!slot) {
			console.warn(`Skill not found in actor's skills: ${params.skillId}`);
			return;
		}

		// Update uses
		slot.UsesLeft = params.usesLeft;

		// Find the skill template for logging
		const skillTemplate = campaign.SkillTemplates.find((s) => s.Id === params.skillId);
		const skillName = skillTemplate?.Name || "Unknown Skill";

		const usesText = params.usesLeft === undefined 
			? "unlimited" 
			: `${params.usesLeft} use(s)`;

		LogActions.create(
			{
				action: "Skill uses adjusted",
				details: `${skillName} on ${actor.Name} set to ${usesText}`,
				category: "skill",
				level: "info",
				visibility: ["dm", "owner"],
				actorId: params.actorId,
			},
			context
		);
	},
};
