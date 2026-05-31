// hooks/useIdleRefresh.ts
import { useEffect, useRef } from "react";

// How long the tab must stay hidden before a return triggers a full reload.
// Deploy value. Override at runtime for testing without a rebuild by setting
// localStorage "idleRefreshMinutes" (e.g. localStorage.idleRefreshMinutes = 5).
const DEFAULT_IDLE_MINUTES = 60;

function resolveThresholdMs(): number {
	const override = Number(
		typeof window !== "undefined" ? window.localStorage.getItem("idleRefreshMinutes") : NaN
	);
	const minutes = Number.isFinite(override) && override > 0 ? override : DEFAULT_IDLE_MINUTES;
	return minutes * 60 * 1000;
}

interface UseIdleRefreshOptions {
	/**
	 * Optional guard checked just before reloading. Return false to skip the
	 * reload this time (e.g. when a form has unsaved changes). Defaults to always
	 * allowing the refresh.
	 */
	canRefresh?: () => boolean;
}

/**
 * Full-page reload when the user returns to a tab that has been hidden longer
 * than the idle threshold. A long-lived single-page tab accumulates browser- and
 * GPU-level state that a reload resets; reloading on return also lands migrations
 * and updates at a natural, non-disruptive boundary (the user was already away).
 *
 * No background timer is used: timers are throttled/frozen in hidden tabs, so the
 * elapsed time is measured by comparing timestamps across the visibilitychange.
 */
export function useIdleRefresh({ canRefresh }: UseIdleRefreshOptions = {}): void {
	const hiddenAtRef = useRef<number | null>(null);

	useEffect(() => {
		const onVisibilityChange = () => {
			if (document.visibilityState === "hidden") {
				hiddenAtRef.current = Date.now();
				return;
			}

			// Became visible: measure how long we were away.
			const hiddenAt = hiddenAtRef.current;
			hiddenAtRef.current = null;
			if (hiddenAt === null) return;

			const awayMs = Date.now() - hiddenAt;
			if (awayMs < resolveThresholdMs()) return;
			if (canRefresh && !canRefresh()) return;

			window.location.reload();
		};

		document.addEventListener("visibilitychange", onVisibilityChange);
		return () => document.removeEventListener("visibilitychange", onVisibilityChange);
	}, [canRefresh]);
}
