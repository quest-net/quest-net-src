// hooks/useAutoReconnect.ts
import { useEffect, useRef, useState } from "react";
import { useActionService } from "../services/Actions/ActionServiceProvider";

interface AutoReconnectConfig {
	enabled: boolean;
	checkIntervalMs?: number; // How often to check for 0 peers (default: 5000ms)
	reconnectDelayMs?: number; // How long to wait before attempting reconnect (default: 3000ms)
	peerlessReconnectDelayMs?: number; // Slow recycle for rooms that have never had peers (disabled by default)
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
	// Latches once we have ever observed a peer in this room. We don't want to
	// use the fast reconnect path for a room that has never had peers. DM rooms
	// can opt into a slower peerless recycle cadence separately.
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

				// Reset the zero peers timer to give the new connection time to establish.
				zeroPeersSinceRef.current = Date.now();
			}, 500);
		};

		const checkPeers = () => {
			const now = Date.now();
			const peers = room.getPeers();
			const peerCount = Object.keys(peers).length;
			const timerDrifted = didTimerDrift(now);
			lastCheckTimeRef.current = now;

			if (timerDrifted && document.visibilityState === "visible") {
				scheduleReconnect(now);
				return;
			}

			if (peerCount > 0) {
				// We have peers! Latch the "ever connected" flag and reset state.
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

			const activeReconnectDelayMs = hasEverHadPeersRef.current
				? reconnectDelayMs
				: peerlessReconnectDelayMs;

			// peerCount === 0. Rooms that previously had peers take the fast
			// recovery path. Rooms that have never had peers only reconnect when
			// the caller opts into a slower peerless recycle cadence.
			if (activeReconnectDelayMs === undefined) {
				return;
			}

			// Start tracking when we first noticed 0 peers
			if (zeroPeersSinceRef.current === null) {
				zeroPeersSinceRef.current = now;
			}

			const timeSinceZeroPeers = now - zeroPeersSinceRef.current;

			// If we've had 0 peers longer than the active reconnect delay,
			// recycle the room.
			if (timeSinceZeroPeers >= activeReconnectDelayMs) {
				scheduleReconnect(now);
			}
		};

		const handleWake = () => {
			const now = Date.now();
			const peerCount = Object.keys(room.getPeers()).length;
			const timerDrifted = didTimerDrift(now);
			lastCheckTimeRef.current = now;

			if (peerCount > 0) {
				// Healthy — reset zero-peer timer.
				zeroPeersSinceRef.current = null;
				return;
			}

			// peerCount === 0. Apply the same peerless guard as checkPeers:
			// rooms that haven't opted into peerless reconnection (e.g. a
			// player waiting for the DM) should not reconnect on wake.
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
