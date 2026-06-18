// domains/Status/StatusSlotDisplay.tsx

import { useState, useEffect, useRef } from "react";
import { useQuestContext } from "../Context/ContextProvider";
import { useActionService } from "../../services/Actions/ActionServiceProvider";
import { CampaignUtils } from "../Campaign/CampaignUtils";
import { ImageDisplay } from "../Image/ImageDisplay";
import { ImagePicker } from "../../components/pickers/ImagePicker";
import { DetailDrawer } from "../../components/ui/DetailDrawer";
import { SectionCard } from "../../components/ui/SectionCard";
import { PropertyRow } from "../../components/ui/PropertyRow";
import { ImageThumb } from "../../components/ui/ImageThumb";
import { ConfirmButton } from "../../components/ui/ConfirmButton";
import { Actor, StatusSlot } from "../Actor/Actor";
import { formatSlotExpiration, formatTemplateExpiration } from "./StatusUtils";

interface StatusSlotDisplayProps {
	isOpen: boolean;
	onClose: () => void;
	slot: StatusSlot;
	actor: Actor;
}

export function StatusSlotDisplay({
	isOpen,
	onClose,
	slot,
	actor,
}: StatusSlotDisplayProps) {
	const context = useQuestContext();
	const { actionService } = useActionService();
	const campaign = CampaignUtils.getActiveCampaign(context);

	const [localCountValue, setLocalCountValue] = useState(() => {
		if (slot.expiration.type === "turns") return slot.expiration.turnsLeft;
		if (slot.expiration.type === "days") return slot.expiration.daysLeft;
		return 0;
	});
	const hasUnsavedChanges = useRef(false);

	// Find the status template
	const status = campaign.StatusTemplates.find((s) => s.Id === slot.Id);

	// Reset state when drawer closes or slot changes
	useEffect(() => {
		if (slot.expiration.type === "turns") {
			setLocalCountValue(slot.expiration.turnsLeft);
		} else if (slot.expiration.type === "days") {
			setLocalCountValue(slot.expiration.daysLeft);
		}
		hasUnsavedChanges.current = false;
	}, [isOpen, slot.Id, slot.expiration]);

	// Save on drawer close if there are unsaved changes
	useEffect(() => {
		return () => {
			if (hasUnsavedChanges.current && actionService) {
				const exp = slot.expiration;
				if (exp.type === "turns") {
					actionService.execute("status:adjustDuration", {
						actorId: actor.Id,
						statusId: slot.Id,
						expiration: { type: "turns", turnsLeft: localCountValue },
					});
				} else if (exp.type === "days") {
					actionService.execute("status:adjustDuration", {
						actorId: actor.Id,
						statusId: slot.Id,
						expiration: { type: "days", daysLeft: localCountValue },
					});
				}
			}
		};
	}, [localCountValue, actionService, actor.Id, slot.Id, slot.expiration]);

	if (!status) {
		return null;
	}

	const handleRemove = () => {
		if (!actionService) return;

		actionService.execute("status:remove", {
			actorId: actor.Id,
			statusId: slot.Id,
		});
		onClose();
	};

	const handleCountBlur = () => {
		if (!actionService) return;

		const exp = slot.expiration;
		if (exp.type === "turns") {
			actionService.execute("status:adjustDuration", {
				actorId: actor.Id,
				statusId: slot.Id,
				expiration: { type: "turns", turnsLeft: localCountValue },
			});
		} else if (exp.type === "days") {
			actionService.execute("status:adjustDuration", {
				actorId: actor.Id,
				statusId: slot.Id,
				expiration: { type: "days", daysLeft: localCountValue },
			});
		}
		hasUnsavedChanges.current = false;
	};

	const handleCountChange = (value: number) => {
		const clamped = Math.min(999, Math.max(0, value));
		setLocalCountValue(clamped);
		hasUnsavedChanges.current = true;
	};

	const handleImageChange = (imageId: string | undefined) => {
		if (!actionService) return;

		// Update the status template's image
		actionService.execute("status:edit", {
			statusId: status.Id,
			updates: { Image: imageId },
		});
	};

	// Format duration text
	const durationText = formatSlotExpiration(slot.expiration);

	// Show count adjuster for turns and days types
	const showCountAdjuster = slot.expiration.type === "turns" || slot.expiration.type === "days";
	const countUnit = slot.expiration.type === "turns" ? "turns" : "days";

	// Determine if image is editable (only if no image is set)
	const imageEditable = !status.Image;

	return (
		<DetailDrawer isOpen={isOpen} onClose={onClose} title={status.Name}>
			{/* Top Row: Image + Actions */}
			<div className="flex gap-6">
				{/* Image */}
				<div className="w-64 shrink-0">
					{imageEditable ? (
						<ImagePicker
							value={status.Image}
							onChange={handleImageChange}
						/>
					) : (
						<ImageThumb className="w-full aspect-square">
							<ImageDisplay
								imageId={status.Image}
								className="w-full h-full object-cover"
								alt={status.Name}
							/>
						</ImageThumb>
					)}
				</div>

				{/* Actions */}
				<div className="flex-1 space-y-3">
					<h3 className="font-semibold text-sm opacity-70">Actions</h3>

					{/* Duration Adjuster - Only show for turns and days types */}
					{showCountAdjuster && (
						<SectionCard title="Adjust Duration">
							<div className="flex gap-2 items-center">
								<input
									type="number"
									value={localCountValue}
									onChange={(e) => handleCountChange(Number(e.target.value) || 0)}
									onBlur={handleCountBlur}
									className="input input-bordered input-sm flex-1"
									min={0}
									max={999}
									placeholder={countUnit}
								/>
								<span className="text-sm opacity-70">{countUnit}</span>
							</div>
						</SectionCard>
					)}

					{/* Divider */}
					<div className="divider my-2"></div>

					{/* Remove Button */}
					<ConfirmButton
						key={slot.Id}
						onConfirm={handleRemove}
						disabled={!actionService}
						icon="icon-[mdi--delete]"
						confirmLabel="Confirm Remove?"
						className="w-full justify-start"
					>
						Remove Status
					</ConfirmButton>
				</div>
			</div>

			{/* Description - Full Width */}
			{status.Description && (
				<SectionCard title="Description">
					<p className="text-sm whitespace-pre-wrap leading-relaxed">
						{status.Description}
					</p>
				</SectionCard>
			)}

			{/* Properties - Full Width */}
			<SectionCard title="Properties">
				<PropertyRow
					label="Current Duration"
					valueClassName={
						slot.expiration.type === "permanent" ? "badge badge-primary" : undefined
					}
				>
					{durationText}
				</PropertyRow>

				<PropertyRow label="Template Default" valueClassName="opacity-70">
					{formatTemplateExpiration(status.Expiration)}
				</PropertyRow>

				<PropertyRow label="Applied To">{actor.Name}</PropertyRow>
			</SectionCard>
		</DetailDrawer>
	);
}
