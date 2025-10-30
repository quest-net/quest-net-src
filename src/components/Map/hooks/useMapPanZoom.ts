// components/Map/hooks/useMapPanZoom.ts
// Hook for managing map pan and zoom state

import { useState, useRef, useCallback } from "react";
import { MIN_SCALE, MAX_SCALE, clampPan, type GridBounds } from "../MapUtilities";

const PAN_PADDING = 500;

export interface PanZoomState {
	scale: number;
	pan: { x: number; y: number };
}

export function useMapPanZoom() {
	const [scale, setScale] = useState(1);
	const [pan, setPan] = useState({ x: 0, y: 0 });

	// Refs to access current values without re-rendering
	const panRef = useRef(pan);
	const scaleRef = useRef(scale);
	const centerRef = useRef({ x: 0, y: 0 });
	const boundsRef = useRef<GridBounds | null>(null);

	// Keep refs in sync
	panRef.current = pan;
	scaleRef.current = scale;

	/**
	 * Update the current center position (called when grid changes)
	 */
	const updateCenter = useCallback((cx: number, cy: number) => {
		centerRef.current = { x: cx, y: cy };
	}, []);

	/**
	 * Update the current bounds (called when grid changes)
	 */
	const updateBounds = useCallback((bounds: GridBounds) => {
		boundsRef.current = bounds;
	}, []);

	/**
	 * Handle zoom via wheel event
	 */
	const handleZoom = useCallback(
		(
			deltaY: number,
			mouseX: number,
			mouseY: number,
			viewWidth: number,
			viewHeight: number
		) => {
			if (!boundsRef.current) return;

			const zoomIntensity = 0.0015;
			const zoom = Math.exp(-deltaY * zoomIntensity);
			const newScaleUnclamped = scaleRef.current * zoom;
			const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, newScaleUnclamped));
			const actual = newScale / scaleRef.current;

			if (actual === 1) return;

			const cx = centerRef.current.x;
			const cy = centerRef.current.y;
			const worldX = (mouseX - (cx + panRef.current.x)) / scaleRef.current;
			const worldY = (mouseY - (cy + panRef.current.y)) / scaleRef.current;
			const nextPanX = mouseX - cx - worldX * newScale;
			const nextPanY = mouseY - cy - worldY * newScale;

			const clampedPan = clampPan(
				{ x: nextPanX, y: nextPanY },
				centerRef.current,
				boundsRef.current,
				newScale,
				viewWidth,
				viewHeight,
				PAN_PADDING
			);

			setScale(newScale);
			setPan(clampedPan);
		},
		[]
	);

	/**
	 * Apply a pan delta
	 */
	const applyPan = useCallback((dx: number, dy: number, viewWidth: number, viewHeight: number) => {
		if (!boundsRef.current) return;

		setPan((p) =>
			clampPan(
				{ x: p.x + dx, y: p.y + dy },
				centerRef.current,
				boundsRef.current!,
				scaleRef.current,
				viewWidth,
				viewHeight,
				PAN_PADDING
			)
		);
	}, []);

	return {
		scale,
		pan,
		panRef,
		scaleRef,
		centerRef,
		boundsRef,
		updateCenter,
		updateBounds,
		handleZoom,
		applyPan,
	};
}