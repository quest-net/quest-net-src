import { Actor, SkillSlot } from "../Actor/Actor";
import { Context } from "../Context/Context";
import { Skill } from "./Skill";

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
};
