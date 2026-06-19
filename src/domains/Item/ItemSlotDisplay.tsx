// domains/Item/ItemSlotDisplay.tsx
//
// Builds the SlotDisplay config for an inventory / equipment / shared-inventory
// item slot. The `mode` gates which actions are included; the shared shell owns
// the layout, the uses adjuster, and the transfer (target-picker) modal.

import { useQuestContext } from "../Context/ContextProvider";
import { useActionService } from "../../services/Actions/ActionServiceProvider";
import { CampaignUtils } from "../Campaign/CampaignUtils";
import { formatRestoreRule } from "../CampaignSetting/CampaignSettingUtils";
import {
	SlotDisplay,
	SlotDisplayAction,
	SlotDisplayConfig,
	SlotDisplayCostWarning,
	SlotDisplayProperty,
} from "../../components/SlotDisplay/SlotDisplay";
import { Actor, InventorySlot, EquipmentSlot } from "../Actor/Actor";
import { beginTargeting } from "../../components/Map/Targeting/targetingStore";
import {
	formatActionCost,
	formatStatCost,
	getActionCostAvailability,
	getStatCostAvailability,
} from "../Actor/ActorCostUtils";

interface ItemSlotDisplayProps {
	isOpen: boolean;
	onClose: () => void;
	slot: InventorySlot | EquipmentSlot;
	actor: Actor;
	mode: "inventory" | "equipment" | "shared-inventory";
}

export function ItemSlotDisplay({
	isOpen,
	onClose,
	slot,
	actor,
	mode,
}: ItemSlotDisplayProps) {
	const context = useQuestContext();
	const { actionService } = useActionService();
	const campaign = CampaignUtils.getActiveCampaign(context);

	const item = campaign.ItemTemplates.find((i) => i.Id === slot.Id);
	if (!item) {
		return null;
	}

	const isShared = mode === "shared-inventory";

	// Check if actor is spawned on the map (needed for Drop).
	const isSpawned =
		campaign.GameState.Characters.some((c) => c.Id === actor.Id) ||
		campaign.GameState.Entities.some((e) => e.Id === actor.Id);

	const canUse = slot.UsesLeft === undefined || slot.UsesLeft > 0;

	const usesText =
		slot.UsesLeft !== undefined
			? `${slot.UsesLeft} / ${item.MaxUses || "∞"} uses`
			: "Unlimited uses";

	const statCostText = formatStatCost(item.StatCost, campaign.Settings);
	const actionCostText = formatActionCost(item.ActionCost, campaign.Settings);
	const statAvailability = getStatCostAvailability(
		actor,
		item.StatCost,
		campaign.Settings
	);
	const actionAvailability = getActionCostAvailability(
		actor,
		item.ActionCost,
		campaign.Settings
	);

	const costWarnings: SlotDisplayCostWarning[] = [];
	if (!isShared && item.StatCost && !statAvailability.hasEnough) {
		costWarnings.push({
			kind: "Item",
			name: statAvailability.name ?? "stat",
			current: statAvailability.current,
			required: item.StatCost.amount,
		});
	}
	if (!isShared && item.ActionCost && !actionAvailability.hasEnough) {
		costWarnings.push({
			kind: "Item",
			name: actionAvailability.name ?? "action",
			current: actionAvailability.current,
			required: item.ActionCost.amount,
		});
	}

	// Build the action list in display order; the shell groups destructive
	// actions (Drop / Discard) below a divider.
	const actions: SlotDisplayAction[] = [];

	const isTargetable = !!item.CanTargetActor || !!item.CanTargetPosition;

	if (!isShared) {
		actions.push({
			key: "use",
			label: "Use",
			icon: "icon-[mdi--play]",
			variant: "primary",
			disabled: !canUse || !actionService,
			// Targetable items close the drawer and enter map targeting mode; the
			// resolved target is dispatched by the map. Non-targetable use fires now.
			closeOnRun: isTargetable,
			onRun: () => {
				if (isTargetable) {
					beginTargeting({
						actionKey: "item:use",
						baseParams: { actorId: actor.Id, itemId: slot.Id },
						allowActor: !!item.CanTargetActor,
						allowPosition: !!item.CanTargetPosition,
						label: item.Name,
					});
				} else {
					actionService?.execute("item:use", {
						actorId: actor.Id,
						itemId: slot.Id,
					});
				}
			},
		});
	}

	if (mode === "inventory" && item.IsEquippable) {
		actions.push({
			key: "equip",
			label: "Equip",
			icon: "icon-[mdi--sword]",
			variant: "secondary",
			disabled: !actionService,
			onRun: () =>
				actionService?.execute("item:equip", {
					actorId: actor.Id,
					itemId: slot.Id,
				}),
		});
	}

	if (mode === "equipment") {
		actions.push({
			key: "unequip",
			label: "Unequip",
			icon: "icon-[mdi--arrow-left]",
			variant: "secondary",
			disabled: !actionService,
			onRun: () =>
				actionService?.execute("item:unequip", {
					actorId: actor.Id,
					itemId: slot.Id,
				}),
		});
	}

	actions.push({
		key: "transfer",
		label: "Transfer",
		icon: "icon-[mdi--swap-horizontal]",
		variant: "accent",
		disabled: !actionService,
		picker: {
			title: "Transfer Item To",
			excludeActorId: actor.Id,
			includeSharedInventories: true,
			onSelect: (targetActorId) => {
				if (isShared) {
					actionService?.execute("sharedInventory:transferItem", {
						sourceInventoryId: actor.Id,
						targetId: targetActorId,
						itemId: slot.Id,
					});
				} else {
					actionService?.execute("item:transfer", {
						sourceActorId: actor.Id,
						targetId: targetActorId,
						itemId: slot.Id,
					});
				}
			},
		},
	});

	if (isSpawned && !isShared) {
		actions.push({
			key: "drop",
			label: "Drop",
			icon: "icon-[mdi--arrow-down-circle]",
			variant: "ghost",
			dividerBefore: true,
			closeOnRun: true,
			disabled: !actionService,
			onRun: () =>
				actionService?.execute("item:drop", {
					actorId: actor.Id,
					itemId: slot.Id,
				}),
		});
	}

	actions.push({
		key: slot.Id,
		label: "Discard",
		icon: "icon-[mdi--delete]",
		confirm: true,
		dividerBefore: true,
		closeOnRun: true,
		disabled: !actionService,
		onRun: () => {
			if (isShared) {
				actionService?.execute("sharedInventory:discardItem", {
					inventoryId: actor.Id,
					itemId: slot.Id,
				});
			} else {
				actionService?.execute("item:discard", {
					actorId: actor.Id,
					itemId: slot.Id,
				});
			}
		},
	});

	const properties: SlotDisplayProperty[] = [
		{
			label: "Stat Cost",
			value: statCostText,
			valueClassName: item.StatCost ? "font-bold" : undefined,
		},
		{
			label: "Action Cost",
			value: actionCostText,
			valueClassName: item.ActionCost ? "font-bold" : undefined,
		},
		{ label: "Uses", value: usesText },
		{ label: "Equippable", value: item.IsEquippable ? "Yes" : "No" },
	];
	if (item.DiceRoll && item.DiceRoll.trim() !== "") {
		properties.push({
			label: "Dice Roll",
			value: item.DiceRoll,
			valueClassName: "font-mono",
		});
	}

	const config: SlotDisplayConfig = {
		title: item.Name,
		image: {
			imageId: item.Image,
			alt: item.Name,
			onChange: (imageId) =>
				actionService?.execute("item:edit", {
					itemId: item.Id,
					updates: { Image: imageId },
				}),
		},
		description: item.Description,
		actions,
		costWarnings,
		adjuster:
			slot.UsesLeft !== undefined && !isShared
				? {
						title: "Adjust Uses",
						unit: "uses",
						value: slot.UsesLeft,
						max: item.MaxUses ?? 999,
						onCommit: (value) =>
							actionService?.execute("item:adjustUses", {
								actorId: actor.Id,
								itemId: slot.Id,
								usesLeft: value,
							}),
				  }
				: undefined,
		properties,
		restoreRules: formatRestoreRule(item.RestoreRule),
	};

	return <SlotDisplay isOpen={isOpen} onClose={onClose} config={config} />;
}
