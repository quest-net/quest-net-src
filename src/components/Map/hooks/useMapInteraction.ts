// components/Map/hooks/useMapInteraction.ts
// Hook for managing map mouse and pointer interactions

import { useState, useRef, useCallback, useEffect } from "react";

export interface MapInteractionHandlers {
	onMouseDown: (e: React.MouseEvent<HTMLDivElement>) => void;
	onMouseMove: (e: React.MouseEvent<HTMLDivElement>) => void;
	onMouseUp: () => void;
	onMouseLeave: () => void;
	onWheel: (e: WheelEvent) => void;
}

interface UseMapInteractionOptions {
	containerRef: React.RefObject<HTMLDivElement | null>;
	allowPanZoom: boolean;
	onPan: (
		dx: number,
		dy: number,
		viewWidth: number,
		viewHeight: number
	) => void;
	onZoom: (
		deltaY: number,
		mouseX: number,
		mouseY: number,
		viewWidth: number,
		viewHeight: number
	) => void;
}

export function useMapInteraction({
	containerRef,
	allowPanZoom,
	onPan,
	onZoom,
}: UseMapInteractionOptions) {
	const [isPanning, setIsPanning] = useState(false);
	const dragStart = useRef<{ x: number; y: number } | null>(null);

	// Mouse down handler (right button for panning).
	// NOTE: middle button used to pan but is now reserved for tile pings —
	// see handlePointerDown in Map.tsx. We still preventDefault on middle
	// clicks here so the browser's auto-scroll cursor does not appear.
	const handleMouseDown = useCallback(
		(e: React.MouseEvent<HTMLDivElement>) => {
			if (e.button === 1) {
				e.preventDefault();
				return;
			}
			if (!allowPanZoom) return;
			if (e.button !== 2) return;
			e.preventDefault();
			setIsPanning(true);
			dragStart.current = { x: e.clientX, y: e.clientY };
		},
		[allowPanZoom]
	);

	// Mouse move handler (panning)
	const handleMouseMove = useCallback(
		(e: React.MouseEvent<HTMLDivElement>) => {
			if (!isPanning || !dragStart.current || !containerRef.current) return;
			const dx = e.clientX - dragStart.current.x;
			const dy = e.clientY - dragStart.current.y;
			dragStart.current = { x: e.clientX, y: e.clientY };

			const rect = containerRef.current.getBoundingClientRect();
			onPan(dx, dy, rect.width, rect.height);
		},
		[isPanning, onPan, containerRef]
	);

	// End panning
	const endPan = useCallback(() => {
		setIsPanning(false);
		dragStart.current = null;
	}, []);

	// Wheel handler (zooming)
	const handleWheel = useCallback(
		(e: WheelEvent) => {
			if (!allowPanZoom || !containerRef.current) return;
			e.preventDefault();

			const rect = containerRef.current.getBoundingClientRect();
			const mx = e.clientX - rect.left;
			const my = e.clientY - rect.top;

			onZoom(e.deltaY, mx, my, rect.width, rect.height);
		},
		[allowPanZoom, onZoom, containerRef]
	);

	// Attach wheel listener with passive: false to allow preventDefault
	useEffect(() => {
		const element = containerRef.current;
		if (!element) return;

		element.addEventListener("wheel", handleWheel, { passive: false });

		return () => {
			element.removeEventListener("wheel", handleWheel);
		};
	}, [handleWheel, containerRef]);

	return {
		isPanning,
		handlers: {
			onMouseDown: handleMouseDown,
			onMouseMove: handleMouseMove,
			onMouseUp: endPan,
			onMouseLeave: endPan,
		},
	};
}
