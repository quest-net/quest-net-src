import React, { useCallback, useMemo, useRef } from "react";

export type HeightSelection =
	| { mode: "single"; value: number }
	| { mode: "range"; start: number; end: number };

interface HeightRangeInputProps {
	maxHeight: number;
	value: HeightSelection;
	disabled?: boolean;
	onChange(next: HeightSelection): void;
}

const clamp = (value: number, min: number, max: number) =>
	Math.max(min, Math.min(max, value));

function getRangeLabel(value: HeightSelection): string {
	if (value.mode === "single") return `${value.value}`;
	return value.end - value.start <= 1
		? `${value.start}`
		: `${value.start}-${value.end - 1}`;
}

export function HeightRangeInput({
	maxHeight,
	value,
	disabled,
	onChange,
}: HeightRangeInputProps) {
	const trackRef = useRef<HTMLDivElement | null>(null);
	const dragRangeRef = useRef<{
		clientX: number;
		start: number;
		end: number;
	} | null>(null);
	const sliderMax = Math.max(1, Math.floor(maxHeight));
	const singleMax = Math.max(0, sliderMax - 1);

	const normalized = useMemo<HeightSelection>(() => {
		if (value.mode === "single") {
			return {
				mode: "single",
				value: clamp(Math.floor(value.value), 0, singleMax),
			};
		}

		const start = clamp(Math.floor(value.start), 0, singleMax);
		const end = clamp(Math.floor(value.end), start + 1, sliderMax);
		return { mode: "range", start, end };
	}, [singleMax, sliderMax, value]);

	const getValueFromClientX = useCallback(
		(clientX: number) => {
			const track = trackRef.current;
			if (!track) return 0;
			const rect = track.getBoundingClientRect();
			if (rect.width <= 0) return 0;
			const pct = clamp((clientX - rect.left) / rect.width, 0, 1);
			return Math.round(pct * sliderMax);
		},
		[sliderMax]
	);

	const updateHandle = useCallback(
		(handle: "single" | "start" | "end", clientX: number) => {
			const raw = getValueFromClientX(clientX);

			if (handle === "single" || normalized.mode === "single") {
				onChange({
					mode: "single",
					value: clamp(raw, 0, singleMax),
				});
				return;
			}

			if (handle === "start") {
				onChange({
					mode: "range",
					start: clamp(raw, 0, normalized.end - 1),
					end: normalized.end,
				});
				return;
			}

			onChange({
				mode: "range",
				start: normalized.start,
				end: clamp(raw, normalized.start + 1, sliderMax),
			});
		},
		[getValueFromClientX, normalized, onChange, singleMax, sliderMax]
	);

	const beginHandleDrag = useCallback(
		(handle: "single" | "start" | "end") =>
			(e: React.PointerEvent<HTMLButtonElement>) => {
				if (disabled) return;
				e.preventDefault();
				e.currentTarget.setPointerCapture(e.pointerId);
				updateHandle(handle, e.clientX);
			},
		[disabled, updateHandle]
	);

	const onHandleMove = useCallback(
		(handle: "single" | "start" | "end") =>
			(e: React.PointerEvent<HTMLButtonElement>) => {
				if (disabled || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
				updateHandle(handle, e.clientX);
			},
		[disabled, updateHandle]
	);

	const beginRangeDrag = useCallback(
		(e: React.PointerEvent<HTMLDivElement>) => {
			if (disabled || normalized.mode !== "range") return;
			e.preventDefault();
			e.currentTarget.setPointerCapture(e.pointerId);
			dragRangeRef.current = {
				clientX: e.clientX,
				start: normalized.start,
				end: normalized.end,
			};
		},
		[disabled, normalized]
	);

	const onRangeMove = useCallback(
		(e: React.PointerEvent<HTMLDivElement>) => {
			const drag = dragRangeRef.current;
			const track = trackRef.current;
			if (disabled || normalized.mode !== "range" || !drag || !track) return;
			if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;

			const rect = track.getBoundingClientRect();
			if (rect.width <= 0) return;
			const delta = Math.round(((e.clientX - drag.clientX) / rect.width) * sliderMax);
			const size = drag.end - drag.start;
			const start = clamp(drag.start + delta, 0, sliderMax - size);
			onChange({ mode: "range", start, end: start + size });
		},
		[disabled, normalized.mode, onChange, sliderMax]
	);

	const endRangeDrag = useCallback(() => {
		dragRangeRef.current = null;
	}, []);

	const toggleMode = useCallback(() => {
		if (disabled) return;
		if (normalized.mode === "single") {
			onChange({
				mode: "range",
				start: normalized.value,
				end: clamp(normalized.value + 1, 1, sliderMax),
			});
		} else {
			onChange({
				mode: "single",
				value: normalized.start,
			});
		}
	}, [disabled, normalized, onChange, sliderMax]);

	const startPct =
		normalized.mode === "single" ? normalized.value / sliderMax : normalized.start / sliderMax;
	const endPct =
		normalized.mode === "single" ? normalized.value / sliderMax : normalized.end / sliderMax;
	const activeLeft = `${startPct * 100}%`;
	const activeWidth = `${Math.max(0, endPct - startPct) * 100}%`;

	return (
		<div className="flex items-center gap-2">
			<span className="text-sm font-medium opacity-70">Height</span>
			<button
				type="button"
				className={`btn btn-sm btn-square ${normalized.mode === "single" ? "btn-primary" : "btn-ghost"}`}
				onClick={toggleMode}
				disabled={disabled}
				title={normalized.mode === "single" ? "Use height range" : "Use single height"}
			>
				<span
					className={
						normalized.mode === "single"
							? "icon-[mdi--ray-vertex]"
							: "icon-[mdi--ray-start-end]"
					}
				/>
			</button>
			<div className="w-48 max-w-[45vw]">
				<div
					ref={trackRef}
					className={`relative h-7 ${disabled ? "opacity-45" : ""}`}
					aria-disabled={disabled}
				>
					<div className="absolute left-0 right-0 top-1/2 h-2 -translate-y-1/2 rounded-full bg-base-300" />
					<div
						className="absolute top-1/2 h-2 -translate-y-1/2 rounded-full bg-primary"
						style={{
							left: activeLeft,
							width: normalized.mode === "single" ? 0 : activeWidth,
						}}
						onPointerDown={beginRangeDrag}
						onPointerMove={onRangeMove}
						onPointerUp={endRangeDrag}
						onPointerCancel={endRangeDrag}
					/>
					{normalized.mode === "range" && (
						<button
							type="button"
							className="btn btn-xs btn-circle btn-primary absolute top-1/2 h-5 min-h-0 w-5 -translate-x-1/2 -translate-y-1/2"
							style={{ left: activeLeft }}
							onPointerDown={beginHandleDrag("start")}
							onPointerMove={onHandleMove("start")}
							disabled={disabled}
							title="Range start"
						/>
					)}
					<button
						type="button"
						className="btn btn-xs btn-circle btn-primary absolute top-1/2 h-5 min-h-0 w-5 -translate-x-1/2 -translate-y-1/2"
						style={{ left: normalized.mode === "single" ? activeLeft : `${endPct * 100}%` }}
						onPointerDown={beginHandleDrag(normalized.mode === "single" ? "single" : "end")}
						onPointerMove={onHandleMove(normalized.mode === "single" ? "single" : "end")}
						disabled={disabled}
						title={normalized.mode === "single" ? "Height" : "Range end"}
					/>
				</div>
			</div>
			<span className="badge badge-outline min-w-14 justify-center tabular-nums">
				{getRangeLabel(normalized)}
			</span>
		</div>
	);
}

export default HeightRangeInput;
