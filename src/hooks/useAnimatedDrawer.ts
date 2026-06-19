// hooks/useAnimatedDrawer.ts
//
// Open/close state for a slide-in drawer that needs to stay mounted briefly
// while it animates closed. `isOpen` drives the slide transition; `value` holds
// the drawer's payload and is cleared only after `closeDelayMs` so the closing
// animation can play before the content unmounts.

import { useCallback, useEffect, useRef, useState } from "react";

export interface AnimatedDrawer<T> {
	/** Drives the slide transition (true = open). */
	isOpen: boolean;
	/** The drawer payload, or null when fully closed. Render the drawer when non-null. */
	value: T | null;
	/** Open the drawer with a payload. */
	open: (value: T) => void;
	/** Begin closing; the payload clears after the animation delay. */
	close: () => void;
}

export function useAnimatedDrawer<T>(closeDelayMs = 300): AnimatedDrawer<T> {
	const [isOpen, setIsOpen] = useState(false);
	const [value, setValue] = useState<T | null>(null);
	const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const clearPending = () => {
		if (timeoutRef.current !== null) {
			clearTimeout(timeoutRef.current);
			timeoutRef.current = null;
		}
	};

	const open = useCallback((next: T) => {
		clearPending();
		setValue(next);
		setIsOpen(true);
	}, []);

	const close = useCallback(() => {
		setIsOpen(false);
		clearPending();
		timeoutRef.current = setTimeout(() => {
			setValue(null);
			timeoutRef.current = null;
		}, closeDelayMs);
	}, [closeDelayMs]);

	// Cancel any pending teardown timer if the host unmounts mid-animation.
	useEffect(() => clearPending, []);

	return { isOpen, value, open, close };
}
