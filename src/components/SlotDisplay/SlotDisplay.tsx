// components/SlotDisplay/SlotDisplay.tsx
//
// Shared, config-driven detail panel for a single actor "slot" (an inventory
// item, equipped item, skill, or status). Each domain builds a SlotDisplayConfig
// (data + callbacks) and renders <SlotDisplay>; this shell owns all the repeated
// scaffold and stateful behavior:
//   - the DetailDrawer layout (image column + Actions column + Description +
//     Properties + Restore Rules),
//   - the numeric adjuster (local value, clamp, commit-on-blur, commit-on-close),
//   - the optional target-picker modal (an ActorPicker that any action can open).
//
// It is intentionally domain-agnostic: it never imports a domain model or
// dispatches an action directly. All action keys / payloads live in the per-domain
// builders (SkillSlotDisplay, ItemSlotDisplay, StatusSlotDisplay).

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useSnapshot } from "valtio";
import { ImageDisplay } from "../../domains/Image/ImageDisplay";
import { ImagePicker } from "../pickers/ImagePicker";
import { ActorPicker } from "../pickers/ActorPicker";
import { targetingStore } from "../Map/Targeting/targetingStore";
import { DetailDrawer } from "../ui/DetailDrawer";
import { SectionCard } from "../ui/SectionCard";
import { PropertyRow } from "../ui/PropertyRow";
import { ImageThumb } from "../ui/ImageThumb";
import { ConfirmButton } from "../ui/ConfirmButton";
import { CostWarning } from "../ui/CostWarning";

/** An ActorPicker opened by an action to choose a transfer/target actor. */
export interface SlotActorPicker {
	title: string;
	excludeActorId?: string;
	includeSharedInventories?: boolean;
	onSelect: (targetId: string) => void;
}

export interface SlotDisplayAction {
	/** Stable key (ConfirmButton reset + React list key). */
	key: string;
	label: string;
	/** Iconify class, e.g. "icon-[mdi--play]". */
	icon: string;
	/** DaisyUI btn color; defaults to "neutral". */
	variant?: "primary" | "secondary" | "accent" | "ghost" | "neutral";
	/** Falsy hides the action entirely. Default true. */
	visible?: boolean;
	disabled?: boolean;
	/** Marks this action as belonging to the destructive group (rendered after a divider). */
	dividerBefore?: boolean;
	/** Render via ConfirmButton (two-click). */
	confirm?: boolean;
	confirmLabel?: string;
	/** Call onClose() after running. */
	closeOnRun?: boolean;
	/** Direct handler. */
	onRun?: () => void;
	/** OR: opens an ActorPicker and dispatches with the chosen target. */
	picker?: SlotActorPicker;
}

export interface SlotDisplayCostWarning {
	kind: string;
	name: string;
	current: number;
	required: number;
}

export interface SlotDisplayAdjuster {
	title: string;
	unit: string;
	/** Committed value from the slot. */
	value: number;
	min?: number;
	max?: number;
	/** Commit a clamped value (dispatch the adjust action). */
	onCommit: (value: number) => void;
}

export interface SlotDisplayProperty {
	label: ReactNode;
	value: ReactNode;
	valueClassName?: string;
}

export interface SlotDisplayConfig {
	title: ReactNode;
	image: {
		imageId?: string;
		alt: string;
		onChange: (imageId: string | undefined) => void;
	};
	description?: string;
	actions: SlotDisplayAction[];
	costWarnings?: SlotDisplayCostWarning[];
	adjuster?: SlotDisplayAdjuster;
	properties: SlotDisplayProperty[];
	restoreRules?: string[];
}

interface SlotDisplayProps {
	isOpen: boolean;
	onClose: () => void;
	config: SlotDisplayConfig;
}

export function SlotDisplay({ isOpen, onClose, config }: SlotDisplayProps) {
	const { image, adjuster } = config;

	const [activePicker, setActivePicker] = useState<SlotActorPicker | null>(null);

	// This drawer is a full-screen overlay, so it must get out of the way when
	// map targeting starts (e.g. the user picked "on the map" from the transfer
	// ActorPicker, or used a targetable item/skill from here).
	const { request: targetingRequest } = useSnapshot(targetingStore);
	useEffect(() => {
		if (targetingRequest && isOpen) onClose();
	}, [targetingRequest, isOpen, onClose]);

	// --- Adjuster state (uses / duration) ---------------------------------
	const adjusterValue = adjuster?.value;
	const [localValue, setLocalValue] = useState(adjusterValue ?? 0);
	const dirtyRef = useRef(false);
	// Refs hold the latest value/commit so the unmount cleanup persists the
	// final edit even when the drawer closes without the input blurring.
	const valueRef = useRef(localValue);
	const commitRef = useRef(adjuster?.onCommit);
	valueRef.current = localValue;
	commitRef.current = adjuster?.onCommit;

	// Reset when a different slot is shown (its committed value changes).
	useEffect(() => {
		setLocalValue(adjusterValue ?? 0);
		dirtyRef.current = false;
	}, [adjusterValue]);

	// Commit the latest value once on unmount if it was edited but not blurred.
	useEffect(() => {
		return () => {
			if (dirtyRef.current) commitRef.current?.(valueRef.current);
		};
	}, []);

	const handleAdjusterChange = (raw: number) => {
		if (!adjuster) return;
		const min = adjuster.min ?? 0;
		const max = adjuster.max ?? Number.MAX_SAFE_INTEGER;
		setLocalValue(Math.min(max, Math.max(min, raw)));
		dirtyRef.current = true;
	};

	const handleAdjusterBlur = () => {
		if (!adjuster) return;
		adjuster.onCommit(localValue);
		dirtyRef.current = false;
	};

	// --- Actions ----------------------------------------------------------
	const runAction = (action: SlotDisplayAction) => {
		if (action.picker) {
			setActivePicker(action.picker);
			return;
		}
		action.onRun?.();
		if (action.closeOnRun) onClose();
	};

	const renderButton = (action: SlotDisplayAction) => {
		if (action.confirm) {
			return (
				<ConfirmButton
					key={action.key}
					onConfirm={() => runAction(action)}
					disabled={action.disabled}
					icon={action.icon}
					confirmLabel={action.confirmLabel}
					className="w-full justify-start"
				>
					{action.label}
				</ConfirmButton>
			);
		}
		return (
			<button
				key={action.key}
				type="button"
				onClick={() => runAction(action)}
				disabled={action.disabled}
				className={`btn btn-${action.variant ?? "neutral"} w-full justify-start`}
			>
				<span className={`${action.icon} w-5 h-5`} />
				{action.label}
			</button>
		);
	};

	const visibleActions = config.actions.filter((a) => a.visible !== false);
	// Destructive actions (confirm or flagged) render after the adjuster, behind
	// a single divider; everything else renders above it in array order.
	const isDestructive = (a: SlotDisplayAction) => a.confirm || a.dividerBefore;
	const regularActions = visibleActions.filter((a) => !isDestructive(a));
	const destructiveActions = visibleActions.filter(isDestructive);

	const restoreRules = config.restoreRules ?? [];

	const handlePickerConfirm = (targetId: string) => {
		activePicker?.onSelect(targetId);
		setActivePicker(null);
		onClose();
	};

	const imageEditable = !image.imageId;

	return (
		<>
			<DetailDrawer isOpen={isOpen} onClose={onClose} title={config.title}>
				{/* Top Row: Image + Actions */}
				<div className="flex gap-6">
					{/* Image */}
					<div className="w-64 shrink-0">
						{imageEditable ? (
							<ImagePicker value={image.imageId} onChange={image.onChange} />
						) : (
							<ImageThumb className="w-full aspect-square">
								<ImageDisplay
									imageId={image.imageId}
									className="w-full h-full object-cover"
									alt={image.alt}
								/>
							</ImageThumb>
						)}
					</div>

					{/* Actions */}
					<div className="flex-1 space-y-3">
						<h3 className="font-semibold text-sm opacity-70">Actions</h3>

						{regularActions.map(renderButton)}

						{config.costWarnings?.map((warning, index) => (
							<CostWarning
								key={index}
								kind={warning.kind}
								name={warning.name}
								current={warning.current}
								required={warning.required}
							/>
						))}

						{adjuster && (
							<SectionCard title={adjuster.title}>
								<div className="flex gap-2 items-center">
									<input
										type="number"
										value={localValue}
										onChange={(e) =>
											handleAdjusterChange(Number(e.target.value) || 0)
										}
										onBlur={handleAdjusterBlur}
										className="input input-bordered input-sm flex-1"
										min={adjuster.min ?? 0}
										max={adjuster.max}
										placeholder={adjuster.unit}
									/>
									<span className="text-sm opacity-70">{adjuster.unit}</span>
								</div>
							</SectionCard>
						)}

						{destructiveActions.length > 0 && (
							<>
								<div className="divider my-2"></div>
								{destructiveActions.map(renderButton)}
							</>
						)}
					</div>
				</div>

				{/* Description - Full Width */}
				{config.description && (
					<SectionCard title="Description">
						<p className="text-sm whitespace-pre-wrap leading-relaxed">
							{config.description}
						</p>
					</SectionCard>
				)}

				{/* Properties - Full Width */}
				<SectionCard title="Properties">
					{config.properties.map((prop, index) => (
						<PropertyRow
							key={index}
							label={prop.label}
							valueClassName={prop.valueClassName}
						>
							{prop.value}
						</PropertyRow>
					))}

					{restoreRules.length > 0 && (
						<div className="py-2">
							<span className="font-semibold block mb-2">Restore Rules</span>
							<ul className="text-sm list-disc list-inside space-y-1">
								{restoreRules.map((line, index) => (
									<li key={index}>{line}</li>
								))}
							</ul>
						</div>
					)}
				</SectionCard>
			</DetailDrawer>

			{/* Target Picker Modal */}
			<ActorPicker
				isOpen={activePicker !== null}
				onConfirm={handlePickerConfirm}
				onCancel={() => setActivePicker(null)}
				title={activePicker?.title}
				excludeActorId={activePicker?.excludeActorId}
				includeSharedInventories={activePicker?.includeSharedInventories}
			/>
		</>
	);
}
