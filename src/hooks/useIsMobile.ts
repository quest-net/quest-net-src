// hooks/useIsMobile.ts
import { useState, useEffect } from "react";

// Matches Tailwind's `sm` breakpoint: anything below 640px is treated as mobile.
const MOBILE_QUERY = "(max-width: 639px)";

/**
 * Reactive viewport-width check. Returns true while the screen is narrower than
 * Tailwind's `sm` breakpoint and updates live as the viewport crosses it.
 */
export function useIsMobile(): boolean {
	const [isMobile, setIsMobile] = useState(
		typeof window !== "undefined" && window.matchMedia(MOBILE_QUERY).matches
	);

	useEffect(() => {
		const mq = window.matchMedia(MOBILE_QUERY);
		const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
		mq.addEventListener("change", onChange);
		return () => mq.removeEventListener("change", onChange);
	}, []);

	return isMobile;
}
