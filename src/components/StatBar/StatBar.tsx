// components/StatBar/StatBar.tsx

import { useRef, useState, useEffect } from "react";
import type { ResolvedStat } from "../../domains/Actor/ActorResolvers";
import { useDebouncedCallback } from "../../hooks/useDebounced";

interface StatBarProps {
	stat: ResolvedStat;
	editingMax: boolean;
	onCurrentChange: (value: number) => void;
	onMaxChange: (value: number) => void;
	onTransfer?: () => void;
}

export function StatBar({
	stat,
	editingMax,
	onCurrentChange,
	onMaxChange,
	onTransfer,
}: StatBarProps) {
	// Treat null (unset) as 0 internally so local state stays numeric; the
	// component early-returns before rendering so the input value is never
	// exposed. Callers that want to keep unset stats in the DOM should filter
	// them out before reaching this component.
	const actualCurrent = stat.Current ?? 0;
	const barRef = useRef<HTMLDivElement>(null);

	// Local state for dragging - only syncs on mouseup
	const [isDragging, setIsDragging] = useState(false);
	const [localValue, setLocalValue] = useState<number | null>(null);

	// Local state for debounced values
	const [localCurrent, setLocalCurrent] = useState<number>(actualCurrent);
	const [localMax, setLocalMax] = useState(stat.Max);

	// Debounced commits (separate timers so a Current edit and a Max edit don't
	// coalesce into one and drop the other).
	const commitCurrent = useDebouncedCallback(onCurrentChange);
	const commitMax = useDebouncedCallback(onMaxChange);

	// Sync local state when props change (from external updates)
	useEffect(() => {
		setLocalCurrent(actualCurrent);
	}, [actualCurrent]);

	useEffect(() => {
		setLocalMax(stat.Max);
	}, [stat.Max]);

	// Use local value while dragging, local current otherwise
	const displayValue: number = isDragging && localValue !== null ? localValue : localCurrent;
	const percentage = (displayValue / localMax) * 100;

	useEffect(() => {
		if (!isDragging) return;

		const handleMouseMove = (e: MouseEvent) => {
			if (!barRef.current) return;
			const rect = barRef.current.getBoundingClientRect();
			const clickX = e.clientX - rect.left;
			const clickPercentage = Math.max(0, Math.min(100, (clickX / rect.width) * 100));
			const newValue = Math.round((clickPercentage / 100) * localMax);
			setLocalValue(Math.max(0, Math.min(localMax, newValue)));
		};

		const handleMouseUp = () => {
			setIsDragging(false);
			// Only call the change handler once when dragging ends
			if (localValue !== null && localValue !== actualCurrent) {
				setLocalCurrent(localValue);
				onCurrentChange(localValue);
			}
			setLocalValue(null);
		};

		document.addEventListener("mousemove", handleMouseMove);
		document.addEventListener("mouseup", handleMouseUp);

		return () => {
			document.removeEventListener("mousemove", handleMouseMove);
			document.removeEventListener("mouseup", handleMouseUp);
		};
	}, [isDragging, localValue, actualCurrent, localMax, onCurrentChange]);

	// Unset stat: render nothing. All hooks must run above this point.
	if (stat.Current === null) return null;

	const calculateValueFromPosition = (clientX: number): number => {
		if (!barRef.current) return displayValue;

		const rect = barRef.current.getBoundingClientRect();
		const clickX = clientX - rect.left;
		const clickPercentage = Math.max(0, Math.min(100, (clickX / rect.width) * 100));
		const newValue = Math.round((clickPercentage / 100) * localMax);

		return Math.max(0, Math.min(localMax, newValue));
	};

	const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
		const newValue = calculateValueFromPosition(e.clientX);
		setLocalValue(newValue);
		setIsDragging(true);
	};

	const handleCurrentChange = (value: number) => {
		const clamped = Math.max(0, Math.min(localMax, value));
		setLocalCurrent(clamped);
		commitCurrent(clamped);
	};

	const handleMaxChange = (value: number) => {
		const clamped = Math.max(1, value);
		setLocalMax(clamped);

		// Also clamp current value if it exceeds new max
		if (localCurrent > clamped) {
			setLocalCurrent(clamped);
			commitCurrent(clamped);
		}

		commitMax(clamped);
	};

	return (
		<div className="space-y-1">
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-2">
					<label className="text-sm font-medium">{stat.Name}</label>
					{onTransfer && (
						<button
							className="btn btn-xs btn-ghost btn-circle"
							onClick={onTransfer}
							title={`Transfer ${stat.Name}`}
						>
							<span className="icon-[mdi--swap-horizontal] h-4 w-4" />
						</button>
					)}
				</div>

				{/* Current Value Controls - Right side of label */}
				<div className="flex items-center gap-1">
					<button
						className="btn btn-xs btn-ghost"
						onClick={() => handleCurrentChange(localCurrent - 1)}
					>
						-
					</button>
					<input
						type="number"
						value={displayValue}
						onChange={(e) => handleCurrentChange(Number(e.target.value))}
						className="input input-bordered input-xs w-16 text-center"
						min={0}
						max={localMax}
					/>
					<button
						className="btn btn-xs btn-ghost"
						onClick={() => handleCurrentChange(localCurrent + 1)}
					>
						+
					</button>
					<span className="text-xs opacity-70 ml-1">/ {localMax}</span>
				</div>
			</div>

			{/* Progress Bar - Clickable/Draggable */}
			<div
				ref={barRef}
				className="relative w-full h-6 bg-base-300 rounded overflow-hidden cursor-pointer select-none"
				onMouseDown={handleMouseDown}
			>
				<div
					className={`h-full pointer-events-none ${!isDragging ? 'transition-all duration-150' : ''}`}
					style={{
						width: `${percentage}%`,
						backgroundColor: stat.Color,
					}}
				/>
			</div>

			{/* Max Value Control (only visible when editingMax) */}
			{editingMax && (
				<div className="flex items-center gap-1 justify-start">
					<span className="text-xs opacity-70">Max:</span>
					<button
						className="btn btn-xs btn-ghost"
						onClick={() => handleMaxChange(localMax - 1)}
					>
						-
					</button>
					<input
						type="number"
						value={localMax}
						onChange={(e) => handleMaxChange(Number(e.target.value))}
						className="input input-bordered input-xs w-16 text-center"
						min={1}
					/>
					<button
						className="btn btn-xs btn-ghost"
						onClick={() => handleMaxChange(localMax + 1)}
					>
						+
					</button>
				</div>
			)}
		</div>
	);
}