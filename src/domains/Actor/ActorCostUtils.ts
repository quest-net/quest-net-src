import type { Actor } from "./Actor";
import type {
	ActionCost,
	CampaignSettings,
	StatCost,
} from "../CampaignSetting/CampaignSetting";

interface CostAvailability {
	current: number;
	hasEnough: boolean;
	name?: string;
}

export function formatStatCost(
	cost: StatCost | undefined,
	settings: CampaignSettings,
	emptyText = "No stat cost"
): string {
	if (!cost) return emptyText;

	const stat = settings.StatDefinitions.find((s) => s.Id === cost.statId);
	if (!stat) return "Unknown stat cost";

	return `${cost.amount} ${stat.Name}`;
}

export function formatActionCost(
	cost: ActionCost | undefined,
	settings: CampaignSettings,
	emptyText = "No action cost"
): string {
	if (!cost) return emptyText;

	const action = settings.ActionDefinitions.find((a) => a.Id === cost.actionId);
	if (!action) return "Unknown action cost";

	return `${cost.amount} ${action.Name}`;
}

/**
 * The "N/M uses • Costs X • Costs Y" summary line shown under a consumable slot
 * in a CollectionView. Shared by the item and skill collections, whose slots and
 * templates carry the same uses/cost shape.
 */
export function formatSlotDetails(
	slot: { UsesLeft?: number },
	template: {
		MaxUses?: number;
		StatCost?: StatCost;
		ActionCost?: ActionCost;
	},
	settings: CampaignSettings
): string {
	const usesText =
		slot.UsesLeft !== undefined
			? `${slot.UsesLeft}/${template.MaxUses || "∞"}`
			: "∞";

	return [
		`${usesText} uses`,
		template.StatCost ? `Costs ${formatStatCost(template.StatCost, settings, "")}` : "",
		template.ActionCost
			? `Costs ${formatActionCost(template.ActionCost, settings, "")}`
			: "",
	]
		.filter(Boolean)
		.join(" • ");
}

export function getStatCostAvailability(
	actor: Pick<Actor, "Stats">,
	cost: StatCost | undefined,
	settings: CampaignSettings
): CostAvailability {
	if (!cost) return { current: 0, hasEnough: true };

	const stat = actor.Stats?.find((s) => s.Id === cost.statId);
	const statDef = settings.StatDefinitions.find((s) => s.Id === cost.statId);
	const current = stat?.Current ?? 0;

	return {
		current,
		hasEnough: current >= cost.amount,
		name: statDef?.Name,
	};
}

export function getActionCostAvailability(
	actor: Pick<Actor, "Actions">,
	cost: ActionCost | undefined,
	settings: CampaignSettings
): CostAvailability {
	if (!cost) return { current: 0, hasEnough: true };

	const action = actor.Actions?.find((a) => a.Id === cost.actionId);
	const actionDef = settings.ActionDefinitions.find((a) => a.Id === cost.actionId);
	const current = action?.Current ?? 0;

	return {
		current,
		hasEnough: current >= cost.amount,
		name: actionDef?.Name,
	};
}

