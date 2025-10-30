// hooks/useActorAnimations.ts
// Manages smooth movement animations for actors on the map

import { useState, useCallback, useEffect, useRef } from "react";

export interface Position {
	x: number;
	y: number;
	h: number;
}

interface ActorAnimation {
	actorId: string;
	from: Position;
	to: Position;
	startTime: number;
	duration: number;
}

interface AnimatedPosition extends Position {
	isAnimating: boolean;
}

// Tunable animation duration (in milliseconds)
const MOVEMENT_DURATION = 500;

// Easing function for smooth movement
function easeInOutCubic(t: number): number {
	return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export function useActorAnimations() {
	const [animations, setAnimations] = useState<Map<string, ActorAnimation>>(
		new Map()
	);
	const animationsRef = useRef(animations);
	const rafRef = useRef<number>(0);

	// Keep ref in sync with state
	useEffect(() => {
		animationsRef.current = animations;
	}, [animations]);

	// Start a new animation for an actor
	const startAnimation = useCallback(
		(
			actorId: string,
			from: Position,
			to: Position,
			duration: number = MOVEMENT_DURATION
		) => {
			setAnimations((prev) => {
				const next = new Map(prev);
				next.set(actorId, {
					actorId,
					from,
					to,
					startTime: performance.now(),
					duration,
				});
				return next;
			});
		},
		[]
	);

	// Animation loop
	useEffect(() => {
		if (animations.size === 0) {
			if (rafRef.current) {
				cancelAnimationFrame(rafRef.current);
				rafRef.current = 0;
			}
			return;
		}

		const loop = () => {
			const now = performance.now();
			const current = animationsRef.current;
			let hasChanges = false;

			// Check for completed animations
			const next = new Map(current);
			for (const [actorId, anim] of current) {
				const elapsed = now - anim.startTime;
				if (elapsed >= anim.duration) {
					next.delete(actorId);
					hasChanges = true;
				}
			}

			// Always update state to force re-render during animation
			// This ensures smooth interpolation is visible
			if (hasChanges) {
				setAnimations(next);
			} else if (next.size > 0) {
				// Trigger re-render even if no animations completed
				// by creating a new Map reference
				setAnimations(new Map(next));
			}

			// Continue loop if there are still animations
			if (next.size > 0) {
				rafRef.current = requestAnimationFrame(loop);
			}
		};

		rafRef.current = requestAnimationFrame(loop);

		return () => {
			if (rafRef.current) {
				cancelAnimationFrame(rafRef.current);
			}
		};
	}, [animations.size]);

	// Get interpolated position for an actor
	const getActorPosition = useCallback(
		(actorId: string, actualPosition: Position): AnimatedPosition => {
			const anim = animations.get(actorId);

			if (!anim) {
				return { ...actualPosition, isAnimating: false };
			}

			const elapsed = performance.now() - anim.startTime;
			const progress = Math.min(1, elapsed / anim.duration);
			const t = easeInOutCubic(progress);

			return {
				x: anim.from.x + (anim.to.x - anim.from.x) * t,
				y: anim.from.y + (anim.to.y - anim.from.y) * t,
				h: anim.from.h + (anim.to.h - anim.from.h) * t,
				isAnimating: true,
			};
		},
		[animations]
	);

	return {
		startAnimation,
		getActorPosition,
		hasActiveAnimations: animations.size > 0,
	};
}
