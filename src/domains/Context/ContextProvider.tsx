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

let globalTriggerUpdate: (() => void) | null = null;

export function triggerContextUpdate() {
	if (!globalTriggerUpdate) {
		console.warn(
			"[Context] triggerContextUpdate called before provider mounted"
		);
		return;
	}
	globalTriggerUpdate();
}

export function ContextProvider({ children }: { children: ReactNode }) {
	const [context, setContext] = useState<Context | null>(null);
	const [isReady, setIsReady] = useState(false);
	const [loadError, setLoadError] = useState<unknown>(null);

	useEffect(() => {
		ContextActions.load()
			.then((loadedContext) => {
				setContext(loadedContext ?? ContextActions.create());
			})
			.catch((error) => {
				console.error("[Context] Failed to load context:", error);
				setLoadError(error);
			})
			.finally(() => {
				setIsReady(true);
			});
	}, []);

	const triggerUpdate = useCallback(() => {
		setContext((current) => {
			if (!current) {
				console.warn("[Context] triggerUpdate called with no context");
				return current;
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
		document.documentElement.setAttribute("data-theme", theme);
	}, [context]);

	if (!isReady) {
		return (
			<div className="flex items-center justify-center h-screen w-screen bg-base-200">
				<div className="flex flex-col items-center gap-4">
					<span className="loading loading-spinner loading-lg text-primary" />
					<p className="text-base-content opacity-60">Loading...</p>
				</div>
			</div>
		);
	}

	if (loadError) {
		return (
			<div className="flex items-center justify-center h-screen w-screen bg-base-200 p-6">
				<div className="max-w-xl rounded-lg border border-error bg-base-100 p-6 shadow-xl">
					<h1 className="text-2xl font-bold text-error mb-3">
						Could not migrate saved data
					</h1>
					<p className="mb-4">
						Quest-Net could not finish moving campaigns to IndexedDB. Your
						existing local save was left in place so it can be recovered.
					</p>
					<pre className="max-h-48 overflow-auto rounded bg-base-200 p-3 text-sm">
						{loadError instanceof Error ? loadError.message : String(loadError)}
					</pre>
				</div>
			</div>
		);
	}

	return (
		<ContextContext.Provider value={context!}>
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
