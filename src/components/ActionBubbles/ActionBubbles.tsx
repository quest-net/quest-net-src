// components/ActionBubbles.tsx

import { useRef, useState, useEffect } from "react";
import type { ResolvedAction } from "../../utils/ActorResolvers";

interface ActionBubblesProps {
	actions: ResolvedAction[];
	onChange: (actions: ResolvedAction[]) => void;
	readonly?: boolean;
}

export function ActionBubbles({ actions, onChange, readonly }: ActionBubblesProps) {
	// Local state for optimistic updates
	const [localActions, setLocalActions] = useState(actions);
	const debounceTimer = useRef<NodeJS.Timeout | null>(null);

	// Sync local state when props change (from external updates)
	useEffect(() => {
		setLocalActions(actions);
	}, [actions]);

	const handleChange = (updatedActions: ResolvedAction[]) => {
		setLocalActions(updatedActions);

		if (debounceTimer.current) clearTimeout(debounceTimer.current);
		debounceTimer.current = setTimeout(() => {
			onChange(updatedActions);
		}, 300);
	};

	const handleSpend = (actionId: string) => {
		const updated = localActions.map((a) => {
			if (a.Id !== actionId) return a;
			if (a.Current <= 0) return a;
			return { ...a, Current: a.Current - 1 };
		});
		handleChange(updated);
	};

	const handleIncrement = (actionId: string) => {
		const updated = localActions.map((a) => {
			if (a.Id !== actionId) return a;
			return { ...a, Current: a.Current + 1 };
		});
		handleChange(updated);
	};

	// Calculate total bubbles to determine layout
	const totalBubbles = localActions.reduce((sum, a) => {
		return sum + Math.max(a.Current, a.Max);
	}, 0);

	const useVerticalLayout = totalBubbles > 8;

	if (localActions.length === 0) {
		return null;
	}

	if (useVerticalLayout) {
		return (
			<div className="space-y-2">
				{localActions.map((action) => (
					<ActionRow
						key={action.Id}
						action={action}
						onSpend={() => handleSpend(action.Id)}
						onIncrement={() => handleIncrement(action.Id)}
						showLabel
						readonly={readonly}
					/>
				))}
			</div>
		);
	}

	return (
		<div className="flex items-center gap-2 flex-wrap">
			{localActions.map((action, index) => (
				<div key={action.Id} className="flex items-center gap-2">
					{index > 0 && <span className="text-base-content/30">|</span>}
					<ActionRow
						action={action}
						onSpend={() => handleSpend(action.Id)}
						onIncrement={() => handleIncrement(action.Id)}
						showLabel={false}
						readonly={readonly}
					/>
				</div>
			))}
		</div>
	);
}

interface ActionRowProps {
	action: ResolvedAction;
	onSpend: () => void;
	onIncrement: () => void;
	showLabel: boolean;
	readonly?: boolean;
}

function ActionRow({ action, onSpend, onIncrement, showLabel, readonly }: ActionRowProps) {
	const current = action.Current;
	const maxDisplay = Math.max(current, action.Max);

	// Track which bubble is animating
	const [spendingIndex, setSpendingIndex] = useState<number | null>(null);

	const handleBubbleClick = () => {
		if (readonly) return;
		if (spendingIndex !== null) return; // Prevent double-clicks during animation

		// Start animation on the last filled bubble (rightmost)
		const lastFilledIndex = current - 1;
		setSpendingIndex(lastFilledIndex);

		// Delay the actual state change until animation completes
		setTimeout(() => {
			setSpendingIndex(null);
			onSpend();
		}, 200);
	};

	return (
		<div
			className="tooltip tooltip-right flex items-center gap-1"
			data-tip={action.Name}
		>
			{showLabel && (
				<span className="text-xs font-medium w-32 truncate" title={action.Name}>
					{action.Name}
				</span>
			)}
			<div className="flex items-center gap-0.5">
				{Array.from({ length: maxDisplay }).map((_, i) => {
					const isFilled = i < current;
					const isSpending = i === spendingIndex;
					const canInteract = isFilled && !isSpending && !readonly;

					return (
						<button
							key={i}
							onClick={canInteract ? () => handleBubbleClick() : undefined}
							disabled={!canInteract && !readonly ? true : undefined}
							// Logic cleanup:
							// if readonly: disable clicks, remove pointer cursor.
							// if not readonly: standard logic.
							className={`w-4 h-4 rounded-full border-2 transition-all duration-200 ${canInteract
								? "cursor-pointer hover:scale-110"
								: "cursor-default"
								} ${isSpending ? "animate-spend" : ""}`}
							style={{
								borderColor: action.Color,
								backgroundColor: isFilled && !isSpending ? action.Color : "transparent",
								opacity: isFilled ? 1 : 0.4,
							}}
						/>
					);
				})}
			</div>
			{!readonly && (
				<button
					onClick={onIncrement}
					className="btn btn-xs btn-circle hover:scale-110 transition-transform"
					title={`Add ${action.Name}`}
				>
					+
				</button>
			)}

			{/* Scoped keyframe animation */}
			<style>{`
				@keyframes spend {
					0% {
						transform: scale(1);
						opacity: 1;
					}
					50% {
						transform: scale(1.3);
						opacity: 0.7;
					}
					100% {
						transform: scale(0);
						opacity: 0;
					}
				}
				.animate-spend {
					animation: spend 200ms ease-out forwards;
				}
			`}</style>
		</div>
	);
}