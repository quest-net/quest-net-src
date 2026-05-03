// domains/Context/ContextProvider.tsx

import {
	createContext,
	useContext,
	useState,
	useEffect,
	useCallback,
	ReactNode,
} from "react";
import { Context } from "./Context";
import { ContextActions } from "./ContextActions";
import { AppSettingActions } from "../AppSetting/AppSettingActions";

const ContextContext = createContext<Context | null>(null);

type ContextMutator = (ctx: Context) => void;
let globalTriggerUpdate: ((mutate?: ContextMutator) => void) | null = null;

/**
 * Forces a context-driven re-render. The optional `mutate` callback runs
 * against the *latest* committed React state before the new context is
 * spread out, which is how callers that need to reassign a TOP-LEVEL
 * property (e.g. context.ActiveCampaign) safely target the live context
 * rather than a stale captured reference. Inner-reference mutations (array
 * push, nested field assignment) are propagated automatically by the
 * shallow spread and don't need the mutator.
 */
export function triggerContextUpdate(mutate?: ContextMutator) {
	if (!globalTriggerUpdate) {
		console.warn(
			"[Context] triggerContextUpdate called before provider mounted"
		);
		return;
	}
	globalTriggerUpdate(mutate);
}

export function ContextProvider({ children }: { children: ReactNode }) {
	const [context, setContext] = useState<Context | null>(null);

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

	const triggerUpdate = useCallback((mutate?: ContextMutator) => {
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

			ContextActions.save(current);

			return { ...current };
		});
	}, []);

	useEffect(() => {
		globalTriggerUpdate = triggerUpdate;

		return () => {
			globalTriggerUpdate = null;
		};
	}, [triggerUpdate]);

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
