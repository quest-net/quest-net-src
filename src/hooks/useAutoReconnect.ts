// hooks/useAutoReconnect.ts
import { useEffect, useRef, useState } from "react";
import { useActionService } from "../services/Actions/ActionServiceProvider";

interface AutoReconnectConfig {
	enabled: boolean;
	checkIntervalMs?: number; // How often to check connection health (default: 5000ms)
	reconnectDelayMs?: number; // How long to wait before attempting reconnect (default: 3000ms)
	peerlessReconnectDelayMs?: number; // Slow recycle for rooms that have never been healthy (disabled by default)
	sleepDriftThresholdMs?: number; // Timer drift that implies the browser slept (default: max(3 checks, 30s))
	maxAttempts?: number; // Max reconnect attempts (default: Infinity for unlimited)
	/**
	 * When true, having peers is not enough — the DM must be reachable for the
	 * connection to count as healthy. Set for players: the DM is the authority
	 * for every action, so a player meshed only with other players is stuck on
	 * stale state with nothing to recover them. Peer count never hits 0 in that
	 * shape, so without this the room would never recycle. Leave false for the
	 * DM, who has no DM to connect to.
	 */
	requireDmConnection?: boolean;
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
	const requireDmConnection = config.requireDmConnection ?? false;

	const unhealthySinceRef = useRef<number | null>(null);
	const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const attemptCountRef = useRef(0);
	const onReconnectRef = useRef(onReconnect);
	const lastCheckTimeRef = useRef<number | null>(null);
	// Latches once this room has ever reached a healthy connection. We don't want
	// to use the fast reconnect path for a room that has never connected at all.
	// Rooms can opt into a slower cold-start recycle cadence separately.
	const hasEverBeenHealthyRef = useRef(false);

	// Update the ref when the callback changes
	useEffect(() => {
		onReconnectRef.current = onReconnect;
	}, [onReconnect]);

	useEffect(() => {
		if (!config.enabled || !actionService) {
			unhealthySinceRef.current = null;
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

		/**
		 * "Healthy" means the connection is actually good for something, not
		 * merely non-empty. For a player that requires the DM specifically —
		 * being meshed with five other players while the DM link is missing is
		 * a session you cannot participate in, and it pins peer count above 0
		 * forever, which is exactly the state the old peer-count check treated
		 * as fine.
		 *
		 * Note the DM lookup goes through the ActionService proxy, which
		 * re-resolves against the live instance on every call — so this stays
		 * correct across reconnect swaps even from inside the interval closure.
		 */
		const getHealth = () => {
			const hasPeers = Object.keys(room.getPeers()).length > 0;
			if (!hasPeers) return { healthy: false, hasPeers };
			if (!requireDmConnection) return { healthy: true, hasPeers };
			// getDmPeerId is undefined while a peer's handshake User payload is
			// still in flight. That transient miss needs no special-casing: the
			// reconnect delay below doubles as the grace window, and a handshake
			// over an established data channel resolves far inside it.
			// Optional call: the provider proxy resolves methods to undefined in
			// the brief teardown window where the inner instance is already gone.
			const healthy = actionService.getDmPeerId?.() !== undefined;
			return { healthy, hasPeers };
		};

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

				// Reset the unhealthy timer to give the new connection time to establish.
				unhealthySinceRef.current = Date.now();
			}, 500);
		};

		const checkPeers = () => {
			const now = Date.now();
			const { healthy, hasPeers } = getHealth();
			const timerDrifted = didTimerDrift(now);
			lastCheckTimeRef.current = now;

			if (timerDrifted && document.visibilityState === "visible") {
				scheduleReconnect(now);
				return;
			}

			if (healthy) {
				// Real connection! Latch the "ever connected" flag and reset state.
				hasEverBeenHealthyRef.current = true;
				unhealthySinceRef.current = null;
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

			// Unhealthy. The fast path exists for a TOTAL connection loss, where
			// recycling costs nothing because there is nothing to lose. "Peers
			// but no DM" is a different animal: the room is alive and every
			// recycle also drops our links to the other players, so it takes the
			// calmer cold-start cadence and gives the DM room to show up. Rooms
			// that have never connected only reconnect when the caller opts into
			// that cadence at all.
			//
			// For the DM (requireDmConnection false) unhealthy always means zero
			// peers, so this reduces to the original behaviour.
			const activeReconnectDelayMs =
				hasEverBeenHealthyRef.current && !hasPeers
					? reconnectDelayMs
					: peerlessReconnectDelayMs;

			if (activeReconnectDelayMs === undefined) {
				return;
			}

			// Start tracking when we first noticed the connection was unhealthy
			if (unhealthySinceRef.current === null) {
				unhealthySinceRef.current = now;
			}

			const timeSinceUnhealthy = now - unhealthySinceRef.current;

			// If we've been unhealthy longer than the active reconnect delay,
			// recycle the room.
			if (timeSinceUnhealthy >= activeReconnectDelayMs) {
				scheduleReconnect(now);
			}
		};

		const handleWake = () => {
			const now = Date.now();
			const { healthy, hasPeers } = getHealth();
			const timerDrifted = didTimerDrift(now);
			lastCheckTimeRef.current = now;

			if (healthy) {
				// Healthy — reset the unhealthy timer.
				unhealthySinceRef.current = null;
				return;
			}

			// Unhealthy but peers are present means "no DM yet", which can just be
			// an in-flight handshake — and a wake event can easily land inside
			// that window (tab switch right after joining). Zero peers on wake is
			// a strong enough signal to recycle immediately; this is not, so hand
			// it to the delayed checkPeers path instead of tearing down a
			// connection that is still coming up.
			if (hasPeers && !timerDrifted) {
				if (unhealthySinceRef.current === null) {
					unhealthySinceRef.current = now;
				}
				return;
			}

			// Apply the same cold-start guard as checkPeers: rooms that haven't
			// opted into cold reconnection should not reconnect on wake.
			const activeReconnectDelayMs = hasEverBeenHealthyRef.current
				? reconnectDelayMs
				: peerlessReconnectDelayMs;

			if (activeReconnectDelayMs === undefined && !timerDrifted) {
				return;
			}

			unhealthySinceRef.current = now;
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
		requireDmConnection,
	]);

	return state;
}
