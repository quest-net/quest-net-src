// domains/Status/StatusSlotDisplay.tsx

import { useState, useEffect } from "react";
import { useQuestContext } from "../Context/ContextProvider";
import { useActionService } from "../../services/Actions/ActionServiceProvider";
import { CampaignActions } from "../Campaign/CampaignActions";
import { ImageDisplay } from "../Image/ImageDisplay";
import { ImagePicker } from "../../components/inputs/ImagePicker";
import { Actor, StatusSlot } from "../Actor/Actor";

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
	const campaign = CampaignActions.getActiveCampaign(context);
	const isDM = context.User.Role === "dm";

	const [removeClickCount, setRemoveClickCount] = useState(0);
	const [isPermanent, setIsPermanent] = useState(slot.turnsLeft === undefined);
	const [localTurnsLeft, setLocalTurnsLeft] = useState(slot.turnsLeft ?? 3);

	// Find the status template
	const status = campaign.StatusTemplates.find((s) => s.Id === slot.Id);

	// Reset state when drawer closes or slot changes
	useEffect(() => {
		setRemoveClickCount(0);
		setIsPermanent(slot.turnsLeft === undefined);
		setLocalTurnsLeft(slot.turnsLeft ?? 3);
	}, [isOpen, slot.Id, slot.turnsLeft]);

	// Auto-reset remove after 2 seconds
	useEffect(() => {
		if (removeClickCount > 0) {
			const timer = setTimeout(() => {
				setRemoveClickCount(0);
			}, 2000);
			return () => clearTimeout(timer);
		}
	}, [removeClickCount]);

	if (!status) {
		return null;
	}

	const handleRemove = () => {
		if (!actionService || !isDM) return;

		if (removeClickCount === 0) {
			setRemoveClickCount(1);
		} else {
			// Second click - execute remove
			actionService.execute("status:remove", {
				actorId: actor.Id,
				statusId: slot.Id,
			});
			onClose();
		}
	};

	const handleAdjustDuration = () => {
		if (!actionService || !isDM) return;

		const newDuration = isPermanent ? undefined : localTurnsLeft;
		
		actionService.execute("status:adjustDuration", {
			actorId: actor.Id,
			statusId: slot.Id,
			turnsLeft: newDuration,
		});
	};

	const handleImageChange = (imageId: string | undefined) => {
		if (!actionService || !isDM) return;

		// Update the status template's image
		actionService.execute("status:edit", {
			statusId: status.Id,
			updates: { Image: imageId },
		});
	};

	// Format duration text
	const durationText = slot.turnsLeft !== undefined
		? `${slot.turnsLeft} turn${slot.turnsLeft === 1 ? '' : 's'} remaining`
		: "Permanent (never expires)";

	// Determine if image is editable (only if no image is set and user is DM)
	const imageEditable = !status.Image && isDM;

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
						<h2 className="text-3xl font-bold">{status.Name}</h2>
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
									value={status.Image}
									onChange={handleImageChange}
								/>
							) : (
								<div className="w-full aspect-square bg-base-300 rounded-lg overflow-hidden flex items-center justify-center">
									<ImageDisplay
										imageId={status.Image}
										className="w-full h-full object-cover"
										alt={status.Name}
									/>
								</div>
							)}
						</div>

						{/* Actions */}
						{isDM && (
							<div className="flex-1 space-y-3">
								<h3 className="font-semibold text-sm opacity-70 mb-4">Actions</h3>

								{/* Duration Adjuster */}
								<div className="card bg-base-100 border-2 border-base-300 p-4">
									<h4 className="font-semibold text-sm mb-3">Adjust Duration</h4>
									
									<div className="form-control mb-3">
										<label className="label cursor-pointer justify-start gap-2">
											<input
												type="checkbox"
												className="toggle toggle-primary"
												checked={isPermanent}
												onChange={(e) => setIsPermanent(e.target.checked)}
											/>
											<span className="label-text">Permanent (never expires)</span>
										</label>
									</div>

									{!isPermanent && (
										<div className="flex gap-2 items-center mb-3">
											<input
												type="number"
												value={localTurnsLeft}
												onChange={(e) => setLocalTurnsLeft(Math.max(0, Number(e.target.value) || 0))}
												className="input input-bordered input-sm flex-1"
												min={0}
												placeholder="Turns"
											/>
											<span className="text-sm opacity-70">turns</span>
										</div>
									)}

									<button
										onClick={handleAdjustDuration}
										disabled={!actionService}
										className="btn btn-sm btn-primary w-full"
									>
										<span className="icon-[mdi--clock-edit] w-4 h-4" />
										Apply Duration
									</button>
								</div>

								{/* Divider */}
								<div className="divider my-2"></div>

								{/* Remove Button */}
								<button
									onClick={handleRemove}
									disabled={!actionService}
									className={`btn w-full justify-start ${
										removeClickCount > 0 ? "btn-error" : "btn-ghost"
									}`}
								>
									<span className="icon-[mdi--delete] w-5 h-5" />
									{removeClickCount > 0 ? "Confirm Remove?" : "Remove Status"}
								</button>
							</div>
						)}
					</div>

					{/* Description - Full Width */}
					{status.Description && (
						<div className="card bg-base-100 border-2 border-base-300 mb-6">
							<div className="card-body p-4">
								<h3 className="card-title text-sm mb-2">Description</h3>
								<p className="text-sm whitespace-pre-wrap leading-relaxed">
									{status.Description}
								</p>
							</div>
						</div>
					)}

					{/* Properties - Full Width */}
					<div className="card bg-base-100 border-2 border-base-300">
						<div className="card-body p-4 space-y-3">
							<h3 className="card-title text-sm">Properties</h3>

							{/* Current Duration */}
							<div className="flex justify-between items-center py-2 border-b border-base-300">
								<span className="font-semibold">Current Duration</span>
								<span className={slot.turnsLeft === undefined ? "badge badge-primary" : ""}>
									{durationText}
								</span>
							</div>

							{/* Template Default Duration */}
							<div className="flex justify-between items-center py-2 border-b border-base-300">
								<span className="font-semibold">Template Default</span>
								<span className="opacity-70">
									{status.Duration === undefined 
										? "Permanent" 
										: `${status.Duration} turn${status.Duration === 1 ? '' : 's'}`
									}
								</span>
							</div>

							{/* Applied To */}
							<div className="flex justify-between items-center py-2">
								<span className="font-semibold">Applied To</span>
								<span>{actor.Name}</span>
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}