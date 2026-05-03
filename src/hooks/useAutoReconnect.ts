// hooks/useAutoReconnect.ts
import { useEffect, useRef, useState } from "react";
import { useActionService } from "../services/Actions/ActionServiceProvider";

interface AutoReconnectConfig {
	enabled: boolean;
	checkIntervalMs?: number; // How often to check for 0 peers (default: 5000ms)
	reconnectDelayMs?: number; // How long to wait before attempting reconnect (default: 3000ms)
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
	const { actionService } = useActionService();
	const [state, setState] = useState<ReconnectState>({
		isReconnecting: false,
		attemptCount: 0,
		lastAttemptTime: null,
	});

	const checkIntervalMs = config.checkIntervalMs ?? 5000;
	const reconnectDelayMs = config.reconnectDelayMs ?? 3000;
	const maxAttempts = config.maxAttempts ?? Infinity;

	const zeroPeersSinceRef = useRef<number | null>(null);
	const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const attemptCountRef = useRef(0);
	const onReconnectRef = useRef(onReconnect);
	// Latches once we have ever observed a peer in this room. We don't want to
	// auto-reconnect a session that has never had a peer (e.g., a DM testing
	// alone) -- that just churns leave/rejoin every reconnectDelayMs and
	// rebuilds ActionService for no reason.
	const hasEverHadPeersRef = useRef(false);

	// Update the ref when the callback changes
	useEffect(() => {
		onReconnectRef.current = onReconnect;
	}, [onReconnect]);

	useEffect(() => {
		if (!config.enabled || !actionService) {
			zeroPeersSinceRef.current = null;
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

		const checkPeers = () => {
			const peers = room.getPeers();
			const peerCount = Object.keys(peers).length;

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

			// peerCount === 0. Don't try to reconnect a session that has never
			// observed a peer -- there's nothing to recover, and rejoining would
			// just churn ActionService instances.
			if (!hasEverHadPeersRef.current) {
				return;
			}

			// Start tracking when we first noticed 0 peers
			if (zeroPeersSinceRef.current === null) {
				zeroPeersSinceRef.current = Date.now();
			}

			const timeSinceZeroPeers = Date.now() - zeroPeersSinceRef.current;

			// If we've had 0 peers for longer than reconnectDelayMs and haven't exceeded max attempts
			if (
				timeSinceZeroPeers >= reconnectDelayMs &&
				!reconnectTimeoutRef.current &&
				attemptCountRef.current < maxAttempts
			) {
				attemptCountRef.current++;

				setState({
					isReconnecting: true,
					attemptCount: attemptCountRef.current,
					lastAttemptTime: Date.now(),
				});

				// Schedule the actual reconnect
				reconnectTimeoutRef.current = setTimeout(() => {
					onReconnectRef.current();
					reconnectTimeoutRef.current = null;

					setState((prev) => ({
						...prev,
						isReconnecting: false,
					}));

					// Reset the zero peers timer to give the new connection time to establish
					zeroPeersSinceRef.current = Date.now();
				}, 500);
			}
		};

		// Check immediately
		checkPeers();

		// Then check periodically
		const interval = setInterval(checkPeers, checkIntervalMs);

		return () => {
			clearInterval(interval);
			if (reconnectTimeoutRef.current) {
				clearTimeout(reconnectTimeoutRef.current);
			}
		};
	}, [
		config.enabled,
		actionService,
		checkIntervalMs,
		reconnectDelayMs,
		maxAttempts,
	]);

	return state;
}
