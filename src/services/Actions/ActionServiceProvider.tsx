// services/ActionServiceProvider.tsx
//
// The provider exposes ActionService to the rest of the app via two channels:
//
//   actionService            -- an identity-STABLE proxy over the live underlying
//                               instance. Property reads and method calls forward
//                               to whatever ActionService is currently active.
//                               Safe to put in useEffect dep arrays without
//                               re-firing on relay-watchdog reconnect cycles.
//   actionServiceSwapVersion -- a monotonic counter that bumps every time the
//                               underlying instance is replaced. Use this in
//                               deps when an effect genuinely needs to re-attach
//                               on swap (e.g. useRelayWatchdog needs the new
//                               room's fresh WebSocket objects).
//
// Why this matters: useRelayWatchdog tears the room down and rebuilds it on
// relay socket closes (which happen routinely on relays with idle timeouts,
// e.g. wss://relay.mostr.pub). Before this split, every component that put
// actionService in its useEffect deps -- ImageDisplay, the slot displays,
// TerrainDisplay, FirstPersonMap, etc. -- re-fired on every cycle, refetching
// image blobs, recreating object URLs, and churning closures. Over an hour
// that adds up to a steady FPS decay even though the heap stays bounded (GC
// pauses between frames).

import {
	createContext,
	useCallback,
	useContext,
	useRef,
	useState,
	type ReactNode,
} from "react";
import { ActionService } from "./ActionService";

interface ActionServiceContextValue {
	/**
	 * Identity-stable proxy over the live underlying ActionService. Identity
	 * does NOT change across reconnect cycles. Property reads and method calls
	 * forward to the current instance.
	 *
	 * Null only before the first ever connect, or after a true teardown
	 * (campaign switch / unmount). Does NOT flicker null during reconnects --
	 * see CampaignView's isReconnectingRef.
	 */
	actionService: ActionService | null;
	/**
	 * Bumps on every setActionService call. Depend on this when an effect
	 * needs to re-run on each new ActionService instance.
	 */
	actionServiceSwapVersion: number;
	setActionService: (service: ActionService | null) => void;
}

const ActionServiceContext = createContext<ActionServiceContextValue | null>(
	null
);

function createActionServiceProxy(
	innerRef: React.MutableRefObject<ActionService | null>
): ActionService {
	return new Proxy({} as ActionService, {
		get(_target, prop) {
			const inner = innerRef.current;
			if (!inner) return undefined;
			const value = Reflect.get(inner, prop, inner);
			if (typeof value !== "function") return value;
			// Re-resolve the method on each invocation against the LIVE inner,
			// not the inner that was current when the property was first read.
			// This protects code that stashes a method into a long-lived closure
			// (e.g. setInterval callback) from silently calling the old, dead
			// instance after a swap.
			return (...args: unknown[]) => {
				const liveInner = innerRef.current;
				if (!liveInner) return undefined;
				const liveValue = Reflect.get(liveInner, prop, liveInner);
				if (typeof liveValue !== "function") return liveValue;
				return (liveValue as (...a: unknown[]) => unknown).apply(
					liveInner,
					args
				);
			};
		},
		has(_target, prop) {
			const inner = innerRef.current;
			return inner !== null && prop in inner;
		},
	}) as ActionService;
}

export function ActionServiceProvider({ children }: { children: ReactNode }) {
	// The live underlying instance. Mutated in setActionService; never read
	// directly from React state so swaps don't force a React re-render at the
	// inner level (only the explicit swapVersion below does).
	const innerRef = useRef<ActionService | null>(null);
	// The stable proxy. Lazily created on first non-null set, kept forever
	// after so its identity is stable across the rest of the page's lifetime.
	const proxyRef = useRef<ActionService | null>(null);
	// Tracks whether actionService should expose as non-null. Goes through
	// React state so consumers see the null<->proxy transitions that DO matter
	// (true teardown, initial connect).
	const [isConnected, setIsConnected] = useState(false);
	const [swapVersion, setSwapVersion] = useState(0);

	const setActionService = useCallback((service: ActionService | null) => {
		innerRef.current = service;
		if (service && !proxyRef.current) {
			proxyRef.current = createActionServiceProxy(innerRef);
		}
		setIsConnected(service !== null);
		setSwapVersion((v) => v + 1);
	}, []);

	return (
		<ActionServiceContext.Provider
			value={{
				actionService: isConnected ? proxyRef.current : null,
				actionServiceSwapVersion: swapVersion,
				setActionService,
			}}
		>
			{children}
		</ActionServiceContext.Provider>
	);
}

export function useActionService() {
	const context = useContext(ActionServiceContext);
	if (!context) {
		throw new Error(
			"useActionService must be used within ActionServiceProvider"
		);
	}
	return context;
}
