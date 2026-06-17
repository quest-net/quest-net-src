// domains/Item/ItemSlotDisplay.tsx

import { useState, useEffect, useRef } from "react";
import { useQuestContext } from "../Context/ContextProvider";
import { useActionService } from "../../services/Actions/ActionServiceProvider";
import { CampaignUtils } from "../Campaign/CampaignUtils";
import { formatRestoreRule } from "../CampaignSetting/CampaignSettingUtils";
import { ImageDisplay } from "../Image/ImageDisplay";
import { ImagePicker } from "../../components/inputs/ImagePicker";
import { ActorPicker } from "../../components/inputs/ActorPicker";
import { DetailDrawer } from "../../components/ui/DetailDrawer";
import { SectionCard } from "../../components/ui/SectionCard";
import { PropertyRow } from "../../components/ui/PropertyRow";
import { ImageThumb } from "../../components/ui/ImageThumb";
import { ConfirmButton } from "../../components/ui/ConfirmButton";
import { CostWarning } from "../../components/ui/CostWarning";
import { Actor, InventorySlot, EquipmentSlot } from "../Actor/Actor";
import {
	formatActionCost,
	formatStatCost,
	getActionCostAvailability,
	getStatCostAvailability,
} from "../../utils/ActorCostUtils";

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

	const [localUsesLeft, setLocalUsesLeft] = useState(slot.UsesLeft ?? 1);
	const [isTransferPickerOpen, setIsTransferPickerOpen] = useState(false);
	const hasUnsavedChanges = useRef(false);

	// Find the item template
	const item = campaign.ItemTemplates.find((i) => i.Id === slot.Id);

	// Check if actor is spawned on the map (needed for Drop)
	const isSpawned =
		campaign.GameState.Characters.some((c) => c.Id === actor.Id) ||
		campaign.GameState.Entities.some((e) => e.Id === actor.Id);

	// Reset state when drawer closes or slot changes
	useEffect(() => {
		setLocalUsesLeft(slot.UsesLeft ?? item?.MaxUses ?? 1);
		setIsTransferPickerOpen(false);
		hasUnsavedChanges.current = false;
	}, [isOpen, slot.Id, slot.UsesLeft, item?.MaxUses]);

	// Save on drawer close if there are unsaved changes
	useEffect(() => {
		return () => {
			if (hasUnsavedChanges.current && actionService && slot.UsesLeft !== undefined) {
				actionService.execute("item:adjustUses", {
					actorId: actor.Id,
					itemId: slot.Id,
					usesLeft: localUsesLeft,
				});
			}
		};
	}, [localUsesLeft, actionService, actor.Id, slot.Id, slot.UsesLeft]);

	if (!item) {
		return null;
	}

	const handleUse = () => {
		if (!actionService) return;

		actionService.execute("item:use", {
			actorId: actor.Id,
			itemId: slot.Id,
		});
	};

	const handleEquip = () => {
		if (!actionService) return;

		actionService.execute("item:equip", {
			actorId: actor.Id,
			itemId: slot.Id,
		});
	};

	const handleUnequip = () => {
		if (!actionService) return;

		actionService.execute("item:unequip", {
			actorId: actor.Id,
			itemId: slot.Id,
		});
	};

	const handleDiscard = () => {
		if (!actionService) return;

		if (mode === "shared-inventory") {
			actionService.execute("sharedInventory:discardItem", {
				inventoryId: actor.Id,
				itemId: slot.Id,
			});
		} else {
			actionService.execute("item:discard", {
				actorId: actor.Id,
				itemId: slot.Id,
			});
		}
		onClose();
	};

	const handleDrop = () => {
		if (!actionService) return;

		actionService.execute("item:drop", {
			actorId: actor.Id,
			itemId: slot.Id,
		});
		onClose();
	};

	const handleTransferClick = () => {
		setIsTransferPickerOpen(true);
	};

	const handleTransferConfirm = (targetActorId: string) => {
		if (!actionService) return;

		if (mode === "shared-inventory") {
			actionService.execute("sharedInventory:transferItem", {
				sourceInventoryId: actor.Id,
				targetId: targetActorId,
				itemId: slot.Id,
			});
		} else {
			actionService.execute("item:transfer", {
				sourceActorId: actor.Id,
				targetId: targetActorId,
				itemId: slot.Id,
			});
		}

		setIsTransferPickerOpen(false);
		onClose();
	};

	const handleTransferCancel = () => {
		setIsTransferPickerOpen(false);
	};

	const handleUsesBlur = () => {
		if (!actionService || slot.UsesLeft === undefined) return;

		actionService.execute("item:adjustUses", {
			actorId: actor.Id,
			itemId: slot.Id,
			usesLeft: localUsesLeft,
		});
		hasUnsavedChanges.current = false;
	};

	const handleUsesChange = (value: number) => {
		const maxUses = item.MaxUses ?? 999;
		const clamped = Math.min(maxUses, Math.max(0, value));
		setLocalUsesLeft(clamped);
		hasUnsavedChanges.current = true;
	};

	const handleImageChange = (imageId: string | undefined) => {
		if (!actionService) return;

		// Update the item template's image
		actionService.execute("item:edit", {
			itemId: item.Id,
			updates: { Image: imageId },
		});
	};

	// Check if item can be used
	const canUse = slot.UsesLeft === undefined || slot.UsesLeft > 0;

	// Format uses text
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

	// Format restore rules
	const restoreLines = formatRestoreRule(item.RestoreRule);

	// Determine if image is editable (only if no image is set)
	const imageEditable = !item.Image;

	return (
		<>
			<DetailDrawer isOpen={isOpen} onClose={onClose} title={item.Name}>
				{/* Top Row: Image + Actions */}
				<div className="flex gap-6">
					{/* Image */}
					<div className="w-64 shrink-0">
						{imageEditable ? (
							<ImagePicker
								value={item.Image}
								onChange={handleImageChange}
							/>
						) : (
							<ImageThumb className="w-full aspect-square">
								<ImageDisplay
									imageId={item.Image}
									className="w-full h-full object-cover"
									alt={item.Name}
								/>
							</ImageThumb>
						)}
					</div>

					{/* Actions */}
					<div className="flex-1 space-y-3">
						<h3 className="font-semibold text-sm opacity-70">Actions</h3>

						{/* Use Button - hidden for shared inventories */}
						{mode !== "shared-inventory" && (
							<button
								onClick={handleUse}
								disabled={!canUse || !actionService}
								className="btn btn-primary w-full justify-start"
							>
								<span className="icon-[mdi--play] w-5 h-5" />
								Use
							</button>
						)}

						{/* Cost Warnings */}
						{mode !== "shared-inventory" && item.StatCost && !statAvailability.hasEnough && (
							<CostWarning
								kind="Item"
								name={statAvailability.name ?? "stat"}
								current={statAvailability.current}
								required={item.StatCost.amount}
							/>
						)}

						{mode !== "shared-inventory" && item.ActionCost && !actionAvailability.hasEnough && (
							<CostWarning
								kind="Item"
								name={actionAvailability.name ?? "action"}
								current={actionAvailability.current}
								required={item.ActionCost.amount}
							/>
						)}

						{/* Equip/Unequip Button */}
						{mode === "inventory" && item.IsEquippable && (
							<button
								onClick={handleEquip}
								disabled={!actionService}
								className="btn btn-secondary w-full justify-start"
							>
								<span className="icon-[mdi--sword] w-5 h-5" />
								Equip
							</button>
						)}

						{mode === "equipment" && (
							<button
								onClick={handleUnequip}
								disabled={!actionService}
								className="btn btn-secondary w-full justify-start"
							>
								<span className="icon-[mdi--arrow-left] w-5 h-5" />
								Unequip
							</button>
						)}

						{/* Transfer Button */}
						<button
							onClick={handleTransferClick}
							disabled={!actionService}
							className="btn btn-accent w-full justify-start"
						>
							<span className="icon-[mdi--swap-horizontal] w-5 h-5" />
							Transfer
						</button>

						{/* Uses Adjuster - Only show if uses are limited */}
						{slot.UsesLeft !== undefined && mode !== "shared-inventory" && (
							<SectionCard title="Adjust Uses">
								<div className="flex gap-2 items-center">
									<input
										type="number"
										value={localUsesLeft}
										onChange={(e) => handleUsesChange(Number(e.target.value) || 0)}
										onBlur={handleUsesBlur}
										className="input input-bordered input-sm flex-1"
										min={0}
										max={item.MaxUses ?? 999}
										placeholder="Uses"
									/>
									<span className="text-sm opacity-70">uses</span>
								</div>
							</SectionCard>
						)}

						{/* Divider */}
						<div className="divider my-2"></div>

						{/* Drop Button - only for spawned actors with a map position */}
						{isSpawned && mode !== "shared-inventory" && (
							<button
								onClick={handleDrop}
								disabled={!actionService}
								className="btn w-full justify-start btn-ghost"
							>
								<span className="icon-[mdi--arrow-down-circle] w-5 h-5" />
								Drop
							</button>
						)}

						{/* Discard Button */}
						<ConfirmButton
							key={slot.Id}
							onConfirm={handleDiscard}
							disabled={!actionService}
							icon="icon-[mdi--delete]"
							className="w-full justify-start"
						>
							Discard
						</ConfirmButton>
					</div>
				</div>

				{/* Description - Full Width */}
				{item.Description && (
					<SectionCard title="Description">
						<p className="text-sm whitespace-pre-wrap leading-relaxed">
							{item.Description}
						</p>
					</SectionCard>
				)}

				{/* Properties - Full Width */}
				<SectionCard title="Properties">
					<PropertyRow
						label="Stat Cost"
						valueClassName={item.StatCost ? "font-bold" : undefined}
					>
						{statCostText}
					</PropertyRow>

					<PropertyRow
						label="Action Cost"
						valueClassName={item.ActionCost ? "font-bold" : undefined}
					>
						{actionCostText}
					</PropertyRow>

					<PropertyRow label="Uses">{usesText}</PropertyRow>

					<PropertyRow label="Equippable">
						{item.IsEquippable ? "Yes" : "No"}
					</PropertyRow>

					{item.DiceRoll && item.DiceRoll.trim() !== "" && (
						<PropertyRow label="Dice Roll" valueClassName="font-mono">
							{item.DiceRoll}
						</PropertyRow>
					)}

					{/* Restore Rules */}
					{restoreLines.length > 0 && (
						<div className="py-2">
							<span className="font-semibold block mb-2">
								Restore Rules
							</span>
							<ul className="text-sm list-disc list-inside space-y-1">
								{restoreLines.map((line, index) => (
									<li key={index}>{line}</li>
								))}
							</ul>
						</div>
					)}
				</SectionCard>
			</DetailDrawer>

			{/* Actor Picker Modal */}
			<ActorPicker
				isOpen={isTransferPickerOpen}
				onConfirm={handleTransferConfirm}
				onCancel={handleTransferCancel}
				title="Transfer Item To"
				excludeActorId={actor.Id}
				includeSharedInventories={true}
			/>
		</>
	);
}
