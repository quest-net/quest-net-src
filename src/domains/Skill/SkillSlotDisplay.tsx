// domains/Skill/SkillSlotDisplay.tsx

import { useState, useEffect } from "react";
import { useQuestContext } from "../Context/ContextProvider";
import { useActionService } from "../../services/Actions/ActionServiceProvider";
import { CampaignActions } from "../Campaign/CampaignActions";
import { formatRestoreRule } from "../CampaignSetting/CampaignSettingActions";
import { ImageDisplay } from "../Image/ImageDisplay";
import { ImagePicker } from "../../components/inputs/ImagePicker";
import { Actor, SkillSlot } from "../Actor/Actor";

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
	const campaign = CampaignActions.getActiveCampaign(context);

	const [discardClickCount, setDiscardClickCount] = useState(0);
	const [isUnlimited, setIsUnlimited] = useState(slot.UsesLeft === undefined);
	const [localUsesLeft, setLocalUsesLeft] = useState(slot.UsesLeft ?? 1);

	// Find the skill template
	const skill = campaign.SkillTemplates.find((s) => s.Id === slot.Id);

	// Reset state when drawer closes or slot changes
	useEffect(() => {
		setDiscardClickCount(0);
		setIsUnlimited(slot.UsesLeft === undefined);
		setLocalUsesLeft(slot.UsesLeft ?? skill?.MaxUses ?? 1);
	}, [isOpen, slot.Id, slot.UsesLeft, skill?.MaxUses]);

	// Auto-reset discard after 2 seconds
	useEffect(() => {
		if (discardClickCount > 0) {
			const timer = setTimeout(() => {
				setDiscardClickCount(0);
			}, 2000);
			return () => clearTimeout(timer);
		}
	}, [discardClickCount]);

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

		if (discardClickCount === 0) {
			setDiscardClickCount(1);
		} else {
			// Second click - execute discard
			actionService.execute("skill:discard", {
				actorId: actor.Id,
				skillId: slot.Id,
			});
			onClose();
		}
	};

	const handleAdjustUses = () => {
		if (!actionService) return;

		const newUses = isUnlimited ? undefined : localUsesLeft;
		
		actionService.execute("skill:adjustUses", {
			actorId: actor.Id,
			skillId: slot.Id,
			usesLeft: newUses,
		});
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

	// Format stat cost
	let statCostText = "No stat cost";
	let statCostStat = null;
	if (skill.StatCost) {
		const stat = campaign.Settings.StatDefinitions.find(
			(s) => s.Id === skill.StatCost!.statId
		);
		if (stat) {
			statCostStat = stat;
			statCostText = `${skill.StatCost.amount} ${stat.Name}`;
		}
	}

	// Check if actor has enough of the stat
	let hasEnoughStat = true;
	let currentStatValue = 0;
	if (skill.StatCost && statCostStat) {
		const actorStat = actor.Stats.find((s) => s.Id === statCostStat.Id);
		if (actorStat) {
			currentStatValue = actorStat.Current ?? actorStat.Max;
			hasEnoughStat = currentStatValue >= skill.StatCost.amount;
		}
	}

	// Format restore rules
	const restoreLines = formatRestoreRule(skill.RestoreRule);

	// Determine if image is editable (only if no image is set)
	const imageEditable = !skill.Image;

	return (
		<div className="drawer drawer-start z-50">
			<input
				type="checkbox"
				className="drawer-toggle"
				checked={isOpen}
				onChange={() => {}}
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
						<h2 className="text-3xl font-bold">{skill.Name}</h2>
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
									value={skill.Image}
									onChange={handleImageChange}
								/>
							) : (
								<div className="w-full aspect-square bg-base-300 rounded-lg overflow-hidden flex items-center justify-center">
									<ImageDisplay
										imageId={skill.Image}
										className="w-full h-full object-cover"
										alt={skill.Name}
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

							{/* Stat Cost Warning */}
							{skill.StatCost && !hasEnoughStat && (
								<div className="alert alert-warning text-sm py-2">
									<span className="icon-[mdi--alert] w-4 h-4" />
									<span>
										Not enough {statCostStat?.Name} ({currentStatValue} / {skill.StatCost.amount})
										<br />
										<span className="text-xs opacity-70">
											Skill will still activate but cost will be reduced
										</span>
									</span>
								</div>
							)}

							{/* Uses Adjuster */}
							<div className="card bg-base-100 border-2 border-base-300 p-4">
								<h4 className="font-semibold text-sm mb-3">Adjust Uses</h4>
								
								<div className="form-control mb-3">
									<label className="label cursor-pointer justify-start gap-2">
										<input
											type="checkbox"
											className="toggle toggle-primary"
											checked={isUnlimited}
											onChange={(e) => setIsUnlimited(e.target.checked)}
										/>
										<span className="label-text">Unlimited uses</span>
									</label>
								</div>

								{!isUnlimited && (
									<div className="flex gap-2 items-center mb-3">
										<input
											type="number"
											value={localUsesLeft}
											onChange={(e) => {
												const maxUses = skill.MaxUses ?? 999;
												setLocalUsesLeft(Math.min(maxUses, Math.max(0, Number(e.target.value) || 0)));
											}}
											className="input input-bordered input-sm flex-1"
											min={0}
											max={skill.MaxUses ?? 999}
											placeholder="Uses"
										/>
										<span className="text-sm opacity-70">uses</span>
									</div>
								)}

								<button
									onClick={handleAdjustUses}
									disabled={!actionService}
									className="btn btn-sm btn-primary w-full"
								>
									<span className="icon-[mdi--clock-edit] w-4 h-4" />
									Apply Uses
								</button>
							</div>

							{/* Divider */}
							<div className="divider my-2"></div>

							{/* Discard Button */}
							<button
								onClick={handleDiscard}
								disabled={!actionService}
								className={`btn w-full justify-start ${
									discardClickCount > 0 ? "btn-error" : "btn-ghost"
								}`}
							>
								<span className="icon-[mdi--delete] w-5 h-5" />
								{discardClickCount > 0 ? "Confirm?" : "Discard"}
							</button>
						</div>
					</div>

					{/* Description - Full Width */}
					{skill.Description && (
						<div className="card bg-base-100 border-2 border-base-300 mb-6">
							<div className="card-body p-4">
								<h3 className="card-title text-sm mb-2">Description</h3>
								<p className="text-sm whitespace-pre-wrap leading-relaxed">
									{skill.Description}
								</p>
							</div>
						</div>
					)}

					{/* Properties - Full Width */}
					<div className="card bg-base-100 border-2 border-base-300">
						<div className="card-body p-4 space-y-3">
							<h3 className="card-title text-sm">Properties</h3>

							{/* Stat Cost */}
							<div className="flex justify-between items-center py-2 border-b border-base-300">
								<span className="font-semibold">Stat Cost</span>
								<span className={skill.StatCost ? "font-bold" : ""}>
									{statCostText}
								</span>
							</div>

							{/* Uses */}
							<div className="flex justify-between items-center py-2 border-b border-base-300">
								<span className="font-semibold">Uses</span>
								<span>{usesText}</span>
							</div>

							{/* Dice Roll */}
							{skill.DiceRoll && skill.DiceRoll.trim() !== "" && (
								<div className="flex justify-between items-center py-2 border-b border-base-300">
									<span className="font-semibold">Dice Roll</span>
									<span className="font-mono">{skill.DiceRoll}</span>
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
	);
}