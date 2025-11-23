// domains/Item/ItemSlotDisplay.tsx

import { useState, useEffect, useRef } from "react";
import { useQuestContext } from "../Context/ContextProvider";
import { useActionService } from "../../services/Actions/ActionServiceProvider";
import { CampaignActions } from "../Campaign/CampaignActions";
import { formatRestoreRule } from "../CampaignSetting/CampaignSettingActions";
import { ImageDisplay } from "../Image/ImageDisplay";
import { ImagePicker } from "../../components/inputs/ImagePicker";
import { ActorPicker } from "../../components/inputs/ActorPicker";
import { Actor, InventorySlot, EquipmentSlot } from "../Actor/Actor";

interface ItemSlotDisplayProps {
	isOpen: boolean;
	onClose: () => void;
	slot: InventorySlot | EquipmentSlot;
	actor: Actor;
	mode: "inventory" | "equipment";
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
	const campaign = CampaignActions.getActiveCampaign(context);

	const [discardClickCount, setDiscardClickCount] = useState(0);
	const [localUsesLeft, setLocalUsesLeft] = useState(slot.UsesLeft ?? 1);
	const [isTransferPickerOpen, setIsTransferPickerOpen] = useState(false);
	const hasUnsavedChanges = useRef(false);

	// Find the item template
	const item = campaign.ItemTemplates.find((i) => i.Id === slot.Id);

	// Reset state when drawer closes or slot changes
	useEffect(() => {
		setDiscardClickCount(0);
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

	// Auto-reset discard after 2 seconds
	useEffect(() => {
		if (discardClickCount > 0) {
			const timer = setTimeout(() => {
				setDiscardClickCount(0);
			}, 2000);
			return () => clearTimeout(timer);
		}
	}, [discardClickCount]);

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

		if (discardClickCount === 0) {
			setDiscardClickCount(1);
		} else {
			// Second click - execute discard
			actionService.execute("item:discard", {
				actorId: actor.Id,
				itemId: slot.Id,
			});
			onClose();
		}
	};

	const handleTransferClick = () => {
		setIsTransferPickerOpen(true);
	};

	const handleTransferConfirm = (targetActorId: string) => {
		if (!actionService) return;

		actionService.execute("item:transfer", {
			sourceActorId: actor.Id,
			targetActorId: targetActorId,
			itemId: slot.Id,
		});

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

	// Format restore rules
	const restoreLines = formatRestoreRule(item.RestoreRule);

	// Determine if image is editable (only if no image is set)
	const imageEditable = !item.Image;

	return (
		<>
			<div className="drawer drawer-start z-50">
				<input
					type="checkbox"
					className="drawer-toggle"
					checked={isOpen}
					onChange={() => { }}
				/>

				<div className="drawer-side">
					<label
						className="drawer-overlay"
						onClick={onClose}
						aria-label="Close drawer"
					></label>

					<div className="bg-base-200 min-h-full w-full max-w-3xl p-6 overflow-y-auto">
						{/* Header with close button */}
						<div className="flex justify-between items-center mb-6">
							<h2 className="text-3xl font-bold">{item.Name}</h2>
							<button
								onClick={onClose}
								className="btn btn-sm btn-circle btn-ghost"
								aria-label="Close"
							>
								<span className="icon-[mdi--close] w-5 h-5" />
							</button>
						</div>

						{/* Top Row: Image + Actions */}
						<div className="flex gap-6 mb-6">
							{/* Image */}
							<div className="w-64 shrink-0">
								{imageEditable ? (
									<ImagePicker
										value={item.Image}
										onChange={handleImageChange}
									/>
								) : (
									<div className="w-full aspect-square bg-base-300 rounded-lg overflow-hidden flex items-center justify-center">
										<ImageDisplay
											imageId={item.Image}
											className="w-full h-full object-cover"
											alt={item.Name}
										/>
									</div>
								)}
							</div>

							{/* Actions */}
							<div className="flex-1 space-y-3">
								<h3 className="font-semibold text-sm opacity-70 mb-4">Actions</h3>

								{/* Use Button */}
								<button
									onClick={handleUse}
									disabled={!canUse || !actionService}
									className="btn btn-primary w-full justify-start"
								>
									<span className="icon-[mdi--play] w-5 h-5" />
									Use
								</button>

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
								{slot.UsesLeft !== undefined && (
									<div className="card bg-base-100 border-2 border-base-300 p-4">
										<h4 className="font-semibold text-sm mb-3">Adjust Uses</h4>

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
									</div>
								)}

								{/* Divider */}
								<div className="divider my-2"></div>

								{/* Discard Button */}
								<button
									onClick={handleDiscard}
									disabled={!actionService}
									className={`btn w-full justify-start ${discardClickCount > 0 ? "btn-error" : "btn-ghost"
										}`}
								>
									<span className="icon-[mdi--delete] w-5 h-5" />
									{discardClickCount > 0 ? "Confirm?" : "Discard"}
								</button>
							</div>
						</div>

						{/* Description - Full Width */}
						{item.Description && (
							<div className="card bg-base-100 border-2 border-base-300 mb-6">
								<div className="card-body p-4">
									<h3 className="card-title text-sm mb-2">Description</h3>
									<p className="text-sm whitespace-pre-wrap leading-relaxed">
										{item.Description}
									</p>
								</div>
							</div>
						)}

						{/* Properties - Full Width */}
						<div className="card bg-base-100 border-2 border-base-300">
							<div className="card-body p-4 space-y-3">
								<h3 className="card-title text-sm">Properties</h3>

								{/* Uses */}
								<div className="flex justify-between items-center py-2 border-b border-base-300">
									<span className="font-semibold">Uses</span>
									<span>{usesText}</span>
								</div>

								{/* Equippable */}
								<div className="flex justify-between items-center py-2 border-b border-base-300">
									<span className="font-semibold">Equippable</span>
									<span>{item.IsEquippable ? "Yes" : "No"}</span>
								</div>

								{/* Dice Roll */}
								{item.DiceRoll && item.DiceRoll.trim() !== "" && (
									<div className="flex justify-between items-center py-2 border-b border-base-300">
										<span className="font-semibold">Dice Roll</span>
										<span className="font-mono">{item.DiceRoll}</span>
									</div>
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
							</div>
						</div>
					</div>
				</div>
			</div>

			{/* Actor Picker Modal */}
			<ActorPicker
				isOpen={isTransferPickerOpen}
				onConfirm={handleTransferConfirm}
				onCancel={handleTransferCancel}
				title="Transfer Item To"
				excludeActorId={actor.Id}
			/>
		</>
	);
}