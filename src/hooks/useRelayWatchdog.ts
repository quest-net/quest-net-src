// hooks/useRelayWatchdog.ts
import { useEffect, useRef } from "react";
import { getRelaySockets } from "trystero";
import { useActionService } from "../services/Actions/ActionServiceProvider";

// How long to ignore close events after a recovery fires, to avoid re-triggering
// on the close events that come from the deliberate leave() call.
const RECOVERY_COOLDOWN_MS = 15_000;

// How long to wait after the first detected close before firing recovery.
// A short debounce means multiple relays closing at once (common) only
// produces one recovery cycle instead of five.
const DEBOUNCE_MS = 2_000;

/**
 * Watches Trystero's Nostr relay WebSockets for unexpected socket closes and
 * triggers a room recovery when one is detected.
 *
 * --- Why this exists ---
 *
 * The DM's discoverability depends on its relay subscriptions staying live:
 * new players announce themselves over the relay, and the DM must be
 * subscribed (and announcing) to see them and offer a connection. Existing
 * direct WebRTC channels are unaffected when relay signaling degrades (they
 * are fully peer-to-peer after ICE negotiation and never touch the relay
 * again), so the DM can keep its current players while silently becoming
 * unreachable to new joiners — with no error anywhere.
 *
 * Trystero 0.25.1 reconnects relay sockets and re-sends REQ subscriptions
 * automatically *when a socket actually closes*. But it has no liveness
 * check: a socket that silently dies (readyState stays OPEN, sends dropped)
 * is never detected, and routine relay churn can leave the DM's signaling in
 * a degraded state that the library doesn't fully recover from on its own.
 * `useAutoReconnect` only helps when peer count hits 0, which never happens
 * while the DM still has players — so it is not a backstop here.
 *
 * This hook (DM-only) is that backstop. It listens for relay socket close
 * events and, on one, calls onSignalingBroken so the caller can force a full
 * leave() + joinRoom() recovery — rebuilding every relay client, subscription,
 * and offer pool from scratch at the moment signaling is most likely stale.
 * Empirically this is what keeps a long-lived DM room reliably joinable.
 *
 * --- Dependency on actionServiceSwapVersion ---
 *
 * Each reconnect cycle creates a new ActionService and bumps the swap
 * version. The effect depends on actionServiceSwapVersion so it re-runs
 * after every cycle, picks up the fresh WebSocket objects that the new
 * joinRoom() created, and attaches listeners to those instead of the
 * now-orphaned old sockets. (The actionService context value itself is
 * identity-stable across swaps and is therefore unsafe as a re-run
 * trigger -- see ActionServiceProvider.)
 *
 * Only enable for the DM. Players have their own useAutoReconnect path and
 * are not the critical signaling subscribers for new-peer discovery.
 */
export function useRelayWatchdog(
	enabled: boolean,
	onSignalingBroken: () => void
): void {
	const { actionServiceSwapVersion } = useActionService();
	const onSignalingBrokenRef = useRef(onSignalingBroken);
	// Timestamp of the last recovery we fired. Used to suppress the close
	// events that the deliberate leave() call produces during recovery.
	const lastRecoveryAtRef = useRef(0);

	useEffect(() => {
		onSignalingBrokenRef.current = onSignalingBroken;
	}, [onSignalingBroken]);

	useEffect(() => {
		if (!enabled) return;

		// getRelaySockets() returns a snapshot of client.socket per relay URL
		// at call time. These are the exact objects whose close events betray
		// the subscription-loss failure.
		let sockets: Record<string, WebSocket>;
		try {
			sockets = getRelaySockets() as Record<string, WebSocket>;
		} catch {
			// Gracefully degrade if the export is unavailable.
			return;
		}

		if (!sockets || Object.keys(sockets).length === 0) {
			return;
		}

		let isCleanedUp = false;
		let debounceTimer: ReturnType<typeof setTimeout> | null = null;

		const scheduleRecovery = (url: string) => {
			// isCleanedUp guards against close events that arrive after cleanup
			// starts (e.g. from the deliberate leave() during a prior recovery).
			if (isCleanedUp) return;

			// Cooldown: the leave() call during recovery fires close events on
			// the old sockets. By the time those arrive, lastRecoveryAt is
			// fresh, so we skip them.
			if (Date.now() - lastRecoveryAtRef.current < RECOVERY_COOLDOWN_MS) {
				return;
			}

			// Debounce: all five relay sockets often close within milliseconds
			// of each other (same network event). Only schedule once.
			if (debounceTimer) return;

			// Logged at debug level (filtered by default in Chrome devtools)
			// because some relays drop idle connections on a fixed cadence, so
			// these messages fire routinely and used to drown the console.
			// Switch the devtools filter to "Verbose" to see them again.
			console.debug(
				`[RelayWatchdog] Relay socket closed unexpectedly (${url}). ` +
					"Trystero will not re-subscribe on reconnect — scheduling room recovery."
			);

			debounceTimer = setTimeout(() => {
				debounceTimer = null;
				if (isCleanedUp) return;
				lastRecoveryAtRef.current = Date.now();
				onSignalingBrokenRef.current();
			}, DEBOUNCE_MS);
		};

		// Attach close listeners to each relay socket we got at this moment.
		// After a reconnect cycle, getRelaySockets() returns fresh sockets
		// (joinRoom creates new ones via makeSocket), so the next effect run
		// will attach to those instead.
		const handlers = new Map<WebSocket, () => void>();
		for (const [url, ws] of Object.entries(sockets)) {
			const handler = () => scheduleRecovery(url);
			handlers.set(ws, handler);
			ws.addEventListener("close", handler);
		}

		return () => {
			isCleanedUp = true;
			if (debounceTimer) {
				clearTimeout(debounceTimer);
				debounceTimer = null;
			}
			for (const [ws, handler] of handlers) {
				ws.removeEventListener("close", handler);
			}
		};
	}, [enabled, actionServiceSwapVersion]);
	// Intentionally omit onSignalingBroken from deps — it's captured via ref
	// so that CampaignView's inline arrow doesn't cause unnecessary re-runs.
}
