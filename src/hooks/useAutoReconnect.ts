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

			if (peerCount === 0) {
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
			} else {
				// We have peers! Reset everything
				zeroPeersSinceRef.current = null;
				attemptCountRef.current = 0;

				setState({
					isReconnecting: false,
					attemptCount: 0,
					lastAttemptTime: null,
				});
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
