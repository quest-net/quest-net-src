// domains/Context/ContextProvider.tsx

import {
	createContext,
	useContext,
	useState,
	useEffect,
	useCallback,
	useRef,
	ReactNode,
} from "react";
import { Context } from "./Context";
import { ContextActions } from "./ContextActions";
import { AppSettingActions } from "../AppSetting/AppSettingActions";

const ContextContext = createContext<Context | null>(null);

// Trailing-debounce window for persisting the context to localStorage. Re-renders
// are immediate; only the (potentially expensive) serialize + write is deferred
// so a burst of actions collapses into a single write.
const PERSIST_DEBOUNCE_MS = 400;

type ContextMutator = (ctx: Context) => void;
export interface TriggerUpdateOptions {
	/**
	 * Whether this update should be persisted to storage. Defaults to true.
	 * Pass false for transient, non-persistent changes (peer presence, ping
	 * latency, etc.) that only need a re-render — none of that data lives in
	 * Context, so persisting it just re-serializes the whole campaign for
	 * nothing.
	 */
	persist?: boolean;
}

let globalTriggerUpdate:
	| ((mutate?: ContextMutator, options?: TriggerUpdateOptions) => void)
	| null = null;

/**
 * Forces a context-driven re-render. The optional `mutate` callback runs
 * against the *latest* committed React state before the new context is
 * spread out, which is how callers that need to reassign a TOP-LEVEL
 * property (e.g. context.ActiveCampaign) safely target the live context
 * rather than a stale captured reference. Inner-reference mutations (array
 * push, nested field assignment) are propagated automatically by the
 * shallow spread and don't need the mutator.
 *
 * Persistence is debounced and decoupled from rendering — see
 * TriggerUpdateOptions.persist.
 */
export function triggerContextUpdate(
	mutate?: ContextMutator,
	options?: TriggerUpdateOptions
) {
	if (!globalTriggerUpdate) {
		console.warn(
			"[Context] triggerContextUpdate called before provider mounted"
		);
		return;
	}
	globalTriggerUpdate(mutate, options);
}

export function ContextProvider({ children }: { children: ReactNode }) {
	const [context, setContext] = useState<Context | null>(null);

	// Mirror the latest committed context so the debounced flush (and the
	// unload net) can persist it without capturing a stale closure value.
	const latestContextRef = useRef<Context | null>(null);
	const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(() => {
		latestContextRef.current = context;
	}, [context]);

	useEffect(() => {
		let cancelled = false;

		(async () => {
			let loadedContext = await ContextActions.load();

			if (!loadedContext) {
				loadedContext = ContextActions.create();
			}

			if (!cancelled) {
				setContext(loadedContext);
			}
		})().catch((error) => {
			console.error("[Context] Failed to load context:", error);
			if (!cancelled) {
				setContext(ContextActions.create());
			}
		});

		return () => {
			cancelled = true;
		};
	}, []);

	const schedulePersist = useCallback(() => {
		// Trailing debounce: a burst of actions collapses into one flush ~400ms
		// after the last one. Each trigger refreshes the timer so the most
		// recent state is what eventually lands.
		if (persistTimerRef.current) {
			clearTimeout(persistTimerRef.current);
		}
		persistTimerRef.current = setTimeout(() => {
			persistTimerRef.current = null;
			const ctx = latestContextRef.current;
			if (ctx) {
				void ContextActions.flush(ctx).catch((e) =>
					console.error("[Context] Failed to flush context:", e)
				);
			}
		}, PERSIST_DEBOUNCE_MS);
	}, []);

	const triggerUpdate = useCallback(
		(mutate?: ContextMutator, options?: TriggerUpdateOptions) => {
			const shouldPersist = options?.persist !== false;

			setContext((current) => {
				if (!current) {
					console.warn("[Context] triggerUpdate called with no context");
					return current;
				}

				// Run the optional mutator against the latest committed state so
				// callers can reassign top-level fields (e.g. ActiveCampaign)
				// without worrying about stale references they captured earlier.
				if (mutate) {
					try {
						mutate(current);
					} catch (e) {
						console.error("[Context] triggerUpdate mutator threw:", e);
					}
				}

				latestContextRef.current = current;

				return { ...current };
			});

			// Persistence is decoupled from rendering: transient updates
			// (presence/ping) re-render without re-serializing the campaign.
			if (shouldPersist) {
				schedulePersist();
			}
		},
		[schedulePersist]
	);

	useEffect(() => {
		globalTriggerUpdate = triggerUpdate;

		return () => {
			globalTriggerUpdate = null;
		};
	}, [triggerUpdate]);

	// Safety net: on tab close / reload (and on unmount), flush any pending
	// debounced write synchronously. Uses the full save (voxels inline) so a
	// crash or fast close can never drop the active terrain — the next load
	// migrates the inline payload back into IndexedDB.
	useEffect(() => {
		const flushNow = () => {
			if (persistTimerRef.current) {
				clearTimeout(persistTimerRef.current);
				persistTimerRef.current = null;
			}
			const ctx = latestContextRef.current;
			if (ctx) {
				ContextActions.save(ctx);
			}
		};

		window.addEventListener("beforeunload", flushNow);
		return () => {
			window.removeEventListener("beforeunload", flushNow);
			flushNow();
		};
	}, []);

	// Apply theme to document element whenever context changes
	useEffect(() => {
		if (!context) return;

		const theme = AppSettingActions.getTheme(context);

		// Set the data-theme attribute on the html element
		document.documentElement.setAttribute("data-theme", theme);

	}, [context]);

	if (!context) {
		return <div>Loading...</div>;
	}

	return (
		<ContextContext.Provider value={context}>
			{children}
		</ContextContext.Provider>
	);
}

export function useQuestContext() {
	const value = useContext(ContextContext);
	if (!value) {
		throw new Error("useQuestContext must be used within ContextProvider");
	}
	return value;
}
