import { Actor, SkillSlot } from "../Actor/Actor";
import { Context } from "../Context/Context";
import { Campaign } from "../Campaign/Campaign";
import { Skill } from "./Skill";
import { resolveByNameOrId } from "../../utils/resolveByNameOrId";

/**
 * Syncs all skill slots across all actors when a skill template is edited
 * Updates UsesLeft to match new MaxUses behavior
 */
export function syncSkillSlotsAfterEdit(
	skillId: string,
	newMaxUses: number | undefined,
	actors: Actor[]
): void {
	actors.forEach((actor) => {
		actor.Skills.forEach((slot) => {
			if (slot.Id === skillId) {
				syncSkillSlot(slot, newMaxUses);
			}
		});
	});
}

/**
 * Syncs a single skill slot to match template's MaxUses
 */
function syncSkillSlot(slot: SkillSlot, maxUses: number | undefined): void {
	if (maxUses === undefined) {
		// Template now has unlimited uses - clear UsesLeft
		slot.UsesLeft = undefined;
	} else if (slot.UsesLeft === undefined) {
		// Template now has limited uses, but slot was unlimited - set to max
		slot.UsesLeft = maxUses;
	} else {
		// Both have values - clamp current to new max
		slot.UsesLeft = Math.min(slot.UsesLeft, maxUses);
	}
}

export const SkillUtils = {
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
			MaxUses: undefined,
			DiceRoll: "",
		};
	},

	/**
	 * Resolve a skill NAME or template Id to its template record on the campaign.
	 * Tier-1 read used by the scripting facade. Order: Id -> Name -> first glob ->
	 * undefined (via the shared resolveByNameOrId). Returns undefined when nothing
	 * matches.
	 */
	findTemplate(campaign: Campaign, ref: string): Skill | undefined {
		return resolveByNameOrId(campaign.SkillTemplates, ref);
	},

	/**
	 * Resolve a skill ref (name|id) to the actor's first matching skill slot.
	 * A slot's `Id` references its template, so this resolves the template Id first
	 * (over the campaign's SkillTemplates) then finds the slot whose `Id` equals it.
	 * Returns undefined when the template can't be resolved or the actor lacks it.
	 */
	findSlot(actor: Actor, campaign: Campaign, ref: string): SkillSlot | undefined {
		const template = SkillUtils.findTemplate(campaign, ref);
		if (!template) return undefined;
		return actor.Skills.find((s) => s.Id === template.Id);
	},
};
