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

	useEffect(() => {
		let loadedContext = ContextActions.load();

		if (!loadedContext) {
			loadedContext = ContextActions.create();
		}

		setContext(loadedContext);
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
