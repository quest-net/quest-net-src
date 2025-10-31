// components/Map/hooks/useMapRotation.ts
// Hook for managing map rotation state and animation

import { useState, useEffect, useCallback } from "react";
import type { Orientation, AnimationState } from "../MapUtilities";

const ROTATION_DURATION = 180; // milliseconds

export function useMapRotation() {
	const [orientation, setOrientation] = useState<Orientation>(0);
	const [anim, setAnim] = useState<AnimationState | null>(null);

	const startRotate = useCallback((dir: 1 | -1) => {
		const now = performance.now();
		setOrientation((prevOrientation) => {
			let base = prevOrientation;
			setAnim((prevAnim) => {
				// If already animating, use the target as base
				if (prevAnim) {
					base = prevAnim.t < 0.5 ? prevAnim.from : prevAnim.to;
				}
				const to = ((base + (dir === 1 ? 1 : 3)) & 3) as Orientation;
				return { from: base, to, t: 0, start: now };
			});
			return base;
		});
	}, []);

	const rotateCW = useCallback(() => startRotate(1), [startRotate]);
	const rotateCCW = useCallback(() => startRotate(-1), [startRotate]);

	// Animation loop
	useEffect(() => {
		if (!anim) return;

		let raf = 0;
		const loop = () => {
			const t = Math.min(
				1,
				(performance.now() - anim.start) / ROTATION_DURATION
			);
			setAnim((prev) => (prev ? { ...prev, t } : null));
			if (t < 1) {
				raf = requestAnimationFrame(loop);
			} else {
				setOrientation(anim.to);
				setAnim(null);
			}
		};
		raf = requestAnimationFrame(loop);
		return () => cancelAnimationFrame(raf);
	}, [anim?.start]);

	return {
		orientation,
		animationState: anim,
		rotateCW,
		rotateCCW,
	};
}
