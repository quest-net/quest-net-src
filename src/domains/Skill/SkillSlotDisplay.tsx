// domains/Skill/SkillSlotDisplay.tsx

import { useState, useEffect, useRef } from "react";
import { useQuestContext } from "../Context/ContextProvider";
import { useActionService } from "../../services/Actions/ActionServiceProvider";
import { CampaignUtils } from "../Campaign/CampaignUtils";
import { formatRestoreRule } from "../CampaignSetting/CampaignSettingUtils";
import { ImageDisplay } from "../Image/ImageDisplay";
import { ImagePicker } from "../../components/inputs/ImagePicker";
import { DetailDrawer } from "../../components/ui/DetailDrawer";
import { SectionCard } from "../../components/ui/SectionCard";
import { PropertyRow } from "../../components/ui/PropertyRow";
import { ImageThumb } from "../../components/ui/ImageThumb";
import { ConfirmButton } from "../../components/ui/ConfirmButton";
import { CostWarning } from "../../components/ui/CostWarning";
import { Actor, SkillSlot } from "../Actor/Actor";
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

	const [localUsesLeft, setLocalUsesLeft] = useState(slot.UsesLeft ?? 1);
	const hasUnsavedChanges = useRef(false);

	// Find the skill template
	const skill = campaign.SkillTemplates.find((s) => s.Id === slot.Id);

	// Reset state when drawer closes or slot changes
	useEffect(() => {
		setLocalUsesLeft(slot.UsesLeft ?? skill?.MaxUses ?? 1);
		hasUnsavedChanges.current = false;
	}, [isOpen, slot.Id, slot.UsesLeft, skill?.MaxUses]);

	// Save on drawer close if there are unsaved changes
	useEffect(() => {
		return () => {
			if (hasUnsavedChanges.current && actionService && slot.UsesLeft !== undefined) {
				actionService.execute("skill:adjustUses", {
					actorId: actor.Id,
					skillId: slot.Id,
					usesLeft: localUsesLeft,
				});
			}
		};
	}, [localUsesLeft, actionService, actor.Id, slot.Id, slot.UsesLeft]);

	if (!skill) {
		return null;
	}

	const handleUse = () => {
		if (!actionService) return;

		actionService.execute("skill:use", {
			actorId: actor.Id,
			skillId: slot.Id,
		});
	};

	const handleDiscard = () => {
		if (!actionService) return;

		actionService.execute("skill:discard", {
			actorId: actor.Id,
			skillId: slot.Id,
		});
		onClose();
	};

	const handleUsesBlur = () => {
		if (!actionService || slot.UsesLeft === undefined) return;

		actionService.execute("skill:adjustUses", {
			actorId: actor.Id,
			skillId: slot.Id,
			usesLeft: localUsesLeft,
		});
		hasUnsavedChanges.current = false;
	};

	const handleUsesChange = (value: number) => {
		const maxUses = skill.MaxUses ?? 999;
		const clamped = Math.min(maxUses, Math.max(0, value));
		setLocalUsesLeft(clamped);
		hasUnsavedChanges.current = true;
	};

	const handleImageChange = (imageId: string | undefined) => {
		if (!actionService) return;

		// Update the skill template's image
		actionService.execute("skill:edit", {
			skillId: skill.Id,
			updates: { Image: imageId },
		});
	};

	// Check if skill can be used
	const canUse = slot.UsesLeft === undefined || slot.UsesLeft > 0;

	// Format uses text
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

	// Format restore rules
	const restoreLines = formatRestoreRule(skill.RestoreRule);

	// Determine if image is editable (only if no image is set)
	const imageEditable = !skill.Image;

	return (
		<DetailDrawer isOpen={isOpen} onClose={onClose} title={skill.Name}>
			{/* Top Row: Image + Actions */}
			<div className="flex gap-6">
				{/* Image */}
				<div className="w-64 shrink-0">
					{imageEditable ? (
						<ImagePicker
							value={skill.Image}
							onChange={handleImageChange}
						/>
					) : (
						<ImageThumb className="w-full aspect-square">
							<ImageDisplay
								imageId={skill.Image}
								className="w-full h-full object-cover"
								alt={skill.Name}
							/>
						</ImageThumb>
					)}
				</div>

				{/* Actions */}
				<div className="flex-1 space-y-3">
					<h3 className="font-semibold text-sm opacity-70">Actions</h3>

					{/* Use Button */}
					<button
						onClick={handleUse}
						disabled={!canUse || !actionService}
						className="btn btn-primary w-full justify-start"
					>
						<span className="icon-[mdi--play] w-5 h-5" />
						Use
					</button>

					{/* Cost Warnings */}
					{skill.StatCost && !statAvailability.hasEnough && (
						<CostWarning
							kind="Skill"
							name={statAvailability.name ?? "stat"}
							current={statAvailability.current}
							required={skill.StatCost.amount}
						/>
					)}

					{skill.ActionCost && !actionAvailability.hasEnough && (
						<CostWarning
							kind="Skill"
							name={actionAvailability.name ?? "action"}
							current={actionAvailability.current}
							required={skill.ActionCost.amount}
						/>
					)}

					{/* Uses Adjuster - Only show if uses are limited */}
					{slot.UsesLeft !== undefined && (
						<SectionCard title="Adjust Uses">
							<div className="flex gap-2 items-center">
								<input
									type="number"
									value={localUsesLeft}
									onChange={(e) => handleUsesChange(Number(e.target.value) || 0)}
									onBlur={handleUsesBlur}
									className="input input-bordered input-sm flex-1"
									min={0}
									max={skill.MaxUses ?? 999}
									placeholder="Uses"
								/>
								<span className="text-sm opacity-70">uses</span>
							</div>
						</SectionCard>
					)}

					{/* Divider */}
					<div className="divider my-2"></div>

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
			{skill.Description && (
				<SectionCard title="Description">
					<p className="text-sm whitespace-pre-wrap leading-relaxed">
						{skill.Description}
					</p>
				</SectionCard>
			)}

			{/* Properties - Full Width */}
			<SectionCard title="Properties">
				<PropertyRow
					label="Stat Cost"
					valueClassName={skill.StatCost ? "font-bold" : undefined}
				>
					{statCostText}
				</PropertyRow>

				<PropertyRow
					label="Action Cost"
					valueClassName={skill.ActionCost ? "font-bold" : undefined}
				>
					{actionCostText}
				</PropertyRow>

				<PropertyRow label="Uses">{usesText}</PropertyRow>

				{skill.DiceRoll && skill.DiceRoll.trim() !== "" && (
					<PropertyRow label="Dice Roll" valueClassName="font-mono">
						{skill.DiceRoll}
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
	);
}
