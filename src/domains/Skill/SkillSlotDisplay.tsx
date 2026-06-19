// domains/Skill/SkillSlotDisplay.tsx
//
// Builds the SlotDisplay config for a skill slot; the shared shell owns the
// layout and stateful behavior.

import { useQuestContext } from "../Context/ContextProvider";
import { useActionService } from "../../services/Actions/ActionServiceProvider";
import { CampaignUtils } from "../Campaign/CampaignUtils";
import { formatRestoreRule } from "../CampaignSetting/CampaignSettingUtils";
import {
	SlotDisplay,
	SlotDisplayConfig,
	SlotDisplayCostWarning,
	SlotDisplayProperty,
} from "../../components/SlotDisplay/SlotDisplay";
import { Actor, SkillSlot } from "../Actor/Actor";
import { beginTargeting } from "../../components/Map/Targeting/targetingStore";
import {
	formatActionCost,
	formatStatCost,
	getActionCostAvailability,
	getStatCostAvailability,
} from "../Actor/ActorCostUtils";

interface SkillSlotDisplayProps {
	isOpen: boolean;
	onClose: () => void;
	slot: SkillSlot;
	actor: Actor;
}

export function SkillSlotDisplay({
	isOpen,
	onClose,
	slot,
	actor,
}: SkillSlotDisplayProps) {
	const context = useQuestContext();
	const { actionService } = useActionService();
	const campaign = CampaignUtils.getActiveCampaign(context);

	const skill = campaign.SkillTemplates.find((s) => s.Id === slot.Id);
	if (!skill) {
		return null;
	}

	const canUse = slot.UsesLeft === undefined || slot.UsesLeft > 0;
	const isTargetable = !!skill.CanTargetActor || !!skill.CanTargetPosition;

	const usesText =
		slot.UsesLeft !== undefined
			? `${slot.UsesLeft} / ${skill.MaxUses || "∞"} uses`
			: "Unlimited uses";

	const statCostText = formatStatCost(skill.StatCost, campaign.Settings);
	const actionCostText = formatActionCost(skill.ActionCost, campaign.Settings);
	const statAvailability = getStatCostAvailability(
		actor,
		skill.StatCost,
		campaign.Settings
	);
	const actionAvailability = getActionCostAvailability(
		actor,
		skill.ActionCost,
		campaign.Settings
	);

	const costWarnings: SlotDisplayCostWarning[] = [];
	if (skill.StatCost && !statAvailability.hasEnough) {
		costWarnings.push({
			kind: "Skill",
			name: statAvailability.name ?? "stat",
			current: statAvailability.current,
			required: skill.StatCost.amount,
		});
	}
	if (skill.ActionCost && !actionAvailability.hasEnough) {
		costWarnings.push({
			kind: "Skill",
			name: actionAvailability.name ?? "action",
			current: actionAvailability.current,
			required: skill.ActionCost.amount,
		});
	}

	const properties: SlotDisplayProperty[] = [
		{
			label: "Stat Cost",
			value: statCostText,
			valueClassName: skill.StatCost ? "font-bold" : undefined,
		},
		{
			label: "Action Cost",
			value: actionCostText,
			valueClassName: skill.ActionCost ? "font-bold" : undefined,
		},
		{ label: "Uses", value: usesText },
	];
	if (skill.DiceRoll && skill.DiceRoll.trim() !== "") {
		properties.push({
			label: "Dice Roll",
			value: skill.DiceRoll,
			valueClassName: "font-mono",
		});
	}

	const config: SlotDisplayConfig = {
		title: skill.Name,
		image: {
			imageId: skill.Image,
			alt: skill.Name,
			onChange: (imageId) =>
				actionService?.execute("skill:edit", {
					skillId: skill.Id,
					updates: { Image: imageId },
				}),
		},
		description: skill.Description,
		actions: [
			{
				key: "use",
				label: "Use",
				icon: "icon-[mdi--play]",
				variant: "primary",
				disabled: !canUse || !actionService,
				// Targetable skills close the drawer and enter map targeting mode;
				// the resolved target is dispatched by the map. Otherwise fire now.
				closeOnRun: isTargetable,
				onRun: () => {
					if (isTargetable) {
						beginTargeting({
							actionKey: "skill:use",
							baseParams: { actorId: actor.Id, skillId: slot.Id },
							allowActor: !!skill.CanTargetActor,
							allowPosition: !!skill.CanTargetPosition,
							label: skill.Name,
						});
					} else {
						actionService?.execute("skill:use", {
							actorId: actor.Id,
							skillId: slot.Id,
						});
					}
				},
			},
			{
				key: slot.Id,
				label: "Discard",
				icon: "icon-[mdi--delete]",
				confirm: true,
				dividerBefore: true,
				closeOnRun: true,
				disabled: !actionService,
				onRun: () =>
					actionService?.execute("skill:discard", {
						actorId: actor.Id,
						skillId: slot.Id,
					}),
			},
		],
		costWarnings,
		adjuster:
			slot.UsesLeft !== undefined
				? {
						title: "Adjust Uses",
						unit: "uses",
						value: slot.UsesLeft,
						max: skill.MaxUses ?? 999,
						onCommit: (value) =>
							actionService?.execute("skill:adjustUses", {
								actorId: actor.Id,
								skillId: slot.Id,
								usesLeft: value,
							}),
				  }
				: undefined,
		properties,
		restoreRules: formatRestoreRule(skill.RestoreRule),
	};

	return <SlotDisplay isOpen={isOpen} onClose={onClose} config={config} />;
}
