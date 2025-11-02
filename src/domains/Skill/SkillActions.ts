// domains/Skill/SkillActions.ts

import { Context } from "../Context/Context";
import { CampaignActions } from "../Campaign/CampaignActions";
import { LogActions } from "../Log/LogActions";
import { Skill } from "./Skill";

/**
 * Skill action handlers
 * Skills are templates stored at Campaign.SkillTemplates
 */
export const SkillActions = {
	/**
	 * Creates a default skill template
	 */
	createDefault(_context: Context): Skill {
		return {
			Id: crypto.randomUUID(),
			Name: "New Skill",
			Description: "",
			Image: undefined,
			Tags: [],
			SPCost: 0,
			MaxUses: undefined,
			DiceRoll: "",
		};
	},

	/**
	 * Creates a new skill and adds to the campaign skill templates
	 */
	create(params: { skill: Skill }, context: Context): void {
		const campaign = CampaignActions.getActiveCampaign(context);
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
	 */
	edit(
		params: { skillId: string; updates: Partial<Skill> },
		context: Context
	): void {
		const campaign = CampaignActions.getActiveCampaign(context);
		const idx = campaign.SkillTemplates.findIndex((s) => s.Id === params.skillId);
		if (idx === -1) {
			console.warn(`Skill not found: ${params.skillId}`);
			return;
		}
		campaign.SkillTemplates[idx] = {
			...campaign.SkillTemplates[idx],
			...params.updates,
			Id: campaign.SkillTemplates[idx].Id, // guard against accidental Id overwrite
		};

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
		const campaign = CampaignActions.getActiveCampaign(context);
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
	 * Bulk edit tags for multiple skills
	 */
	bulkEditTags(
		params: { updates: Array<{ skillId: string; tags: string[] }> },
		context: Context
	): void {
		const campaign = CampaignActions.getActiveCampaign(context);

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
};