// hooks/useAutoReconnect.ts
import { useEffect, useRef, useState } from "react";
import { useActionService } from "../services/Actions/ActionServiceProvider";

interface AutoReconnectConfig {
	enabled: boolean;
	checkIntervalMs?: number; // How often to check for peers (default: 5000ms)
	reconnectDelayMs?: number; // How long to wait before attempting reconnect (default: 3000ms)
	peerlessReconnectDelayMs?: number; // Slow recycle for rooms that have never had a peer (off by default)
	sleepDriftThresholdMs?: number; // Timer drift that implies the browser slept (default: max(3 checks, 30s))
	maxAttempts?: number; // Max reconnect attempts (default: Infinity for unlimited)
}

interface ReconnectState {
	isReconnecting: boolean;
	attemptCount: number;
	lastAttemptTime: number | null;
}

export function useAutoReconnect(
	config: AutoReconnectConfig,
	onReconnect: () => void
): ReconnectState {
	const { actionService, actionServiceSwapVersion } = useActionService();
	const [state, setState] = useState<ReconnectState>({
		isReconnecting: false,
		attemptCount: 0,
		lastAttemptTime: null,
	});

	const checkIntervalMs = config.checkIntervalMs ?? 5000;
	const reconnectDelayMs = config.reconnectDelayMs ?? 3000;
	const peerlessReconnectDelayMs = config.peerlessReconnectDelayMs;
	const sleepDriftThresholdMs =
		config.sleepDriftThresholdMs ?? Math.max(checkIntervalMs * 3, 30000);
	const maxAttempts = config.maxAttempts ?? Infinity;

	const zeroPeersSinceRef = useRef<number | null>(null);
	const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const attemptCountRef = useRef(0);
	const onReconnectRef = useRef(onReconnect);
	const lastCheckTimeRef = useRef<number | null>(null);
	// Latches once this room has ever had a peer. A room that has never connected
	// at all uses the slower peerless cadence instead of the fast recovery path.
	const hasEverHadPeersRef = useRef(false);

	// Update the ref when the callback changes
	useEffect(() => {
		onReconnectRef.current = onReconnect;
	}, [onReconnect]);

	useEffect(() => {
		if (!config.enabled || !actionService) {
			zeroPeersSinceRef.current = null;
			lastCheckTimeRef.current = null;
			if (reconnectTimeoutRef.current) {
				clearTimeout(reconnectTimeoutRef.current);
				reconnectTimeoutRef.current = null;
			}
			return;
		}

		// Get the room from ActionService
		const room = (actionService as any).room;
		if (!room) {
			return;
		}

		const hasPeers = () => Object.keys(room.getPeers()).length > 0;

		const didTimerDrift = (now: number) => {
			const lastCheckTime = lastCheckTimeRef.current;
			return (
				lastCheckTime !== null &&
				now - lastCheckTime > sleepDriftThresholdMs
			);
		};

		const scheduleReconnect = (now: number) => {
			if (
				reconnectTimeoutRef.current ||
				attemptCountRef.current >= maxAttempts
			) {
				return;
			}

			attemptCountRef.current++;

			setState({
				isReconnecting: true,
				attemptCount: attemptCountRef.current,
				lastAttemptTime: now,
			});

			// Schedule the actual reconnect outside the current event/check call.
			reconnectTimeoutRef.current = setTimeout(() => {
				onReconnectRef.current();
				reconnectTimeoutRef.current = null;

				setState((prev) => ({
					...prev,
					isReconnecting: false,
				}));

				// Give the new connection time to establish before counting again.
				zeroPeersSinceRef.current = Date.now();
			}, 500);
		};

		const checkPeers = () => {
			const now = Date.now();
			const connected = hasPeers();
			const timerDrifted = didTimerDrift(now);
			lastCheckTimeRef.current = now;

			if (timerDrifted && document.visibilityState === "visible") {
				scheduleReconnect(now);
				return;
			}

			if (connected) {
				hasEverHadPeersRef.current = true;
				zeroPeersSinceRef.current = null;
				attemptCountRef.current = 0;

				setState((prev) => {
					if (
						!prev.isReconnecting &&
						prev.attemptCount === 0 &&
						prev.lastAttemptTime === null
					) {
						// Avoid handing React a fresh object every tick -- otherwise
						// CampaignView re-renders every checkInterval and ripples
						// through to children that read context refs.
						return prev;
					}
					return {
						isReconnecting: false,
						attemptCount: 0,
						lastAttemptTime: null,
					};
				});
				return;
			}

			// A room that previously had peers takes the fast recovery path; one
			// that has never connected only recycles if the caller opted into the
			// slower peerless cadence.
			const activeReconnectDelayMs = hasEverHadPeersRef.current
				? reconnectDelayMs
				: peerlessReconnectDelayMs;

			if (activeReconnectDelayMs === undefined) {
				return;
			}

			if (zeroPeersSinceRef.current === null) {
				zeroPeersSinceRef.current = now;
			}

			if (now - zeroPeersSinceRef.current >= activeReconnectDelayMs) {
				scheduleReconnect(now);
			}
		};

		const handleWake = () => {
			const now = Date.now();
			const connected = hasPeers();
			const timerDrifted = didTimerDrift(now);
			lastCheckTimeRef.current = now;

			if (connected) {
				zeroPeersSinceRef.current = null;
				return;
			}

			const activeReconnectDelayMs = hasEverHadPeersRef.current
				? reconnectDelayMs
				: peerlessReconnectDelayMs;

			if (activeReconnectDelayMs === undefined && !timerDrifted) {
				return;
			}

			zeroPeersSinceRef.current = now;
			scheduleReconnect(now);
		};

		const handleVisibilityChange = () => {
			if (document.visibilityState === "visible") {
				handleWake();
			}
		};

		// Check immediately
		checkPeers();

		// Then check periodically
		const interval = setInterval(checkPeers, checkIntervalMs);
		window.addEventListener("online", handleWake);
		window.addEventListener("focus", handleWake);
		window.addEventListener("pageshow", handleWake);
		document.addEventListener("visibilitychange", handleVisibilityChange);

		return () => {
			clearInterval(interval);
			window.removeEventListener("online", handleWake);
			window.removeEventListener("focus", handleWake);
			window.removeEventListener("pageshow", handleWake);
			document.removeEventListener("visibilitychange", handleVisibilityChange);
			if (reconnectTimeoutRef.current) {
				clearTimeout(reconnectTimeoutRef.current);
				reconnectTimeoutRef.current = null;
			}
		};
		// actionService is identity-stable across reconnects, so depending on
		// it alone wouldn't re-run this effect on swap and the `room` reference
		// captured in the effect body would silently target the dead instance.
		// actionServiceSwapVersion bumps on each swap and forces the re-run.
	}, [
		config.enabled,
		actionService,
		actionServiceSwapVersion,
		checkIntervalMs,
		reconnectDelayMs,
		peerlessReconnectDelayMs,
		sleepDriftThresholdMs,
		maxAttempts,
	]);

	return state;
}
