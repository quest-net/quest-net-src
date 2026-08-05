// services/ActionServiceProvider.tsx
//
// The provider exposes the ActionService for the currently mounted campaign.
// A service is created once when CampaignView joins and cleared once when that
// view genuinely unmounts or switches campaigns.

import {
	createContext,
	useCallback,
	useContext,
	useState,
	type ReactNode,
} from "react";
import type { ActionService } from "./ActionService";

interface ActionServiceContextValue {
	/** Null before initial setup and after campaign teardown. */
	actionService: ActionService | null;
	setActionService: (service: ActionService | null) => void;
}

const ActionServiceContext = createContext<ActionServiceContextValue | null>(
	null
);

export function ActionServiceProvider({ children }: { children: ReactNode }) {
	const [actionService, setLiveActionService] =
		useState<ActionService | null>(null);

	const setActionService = useCallback((service: ActionService | null) => {
		setLiveActionService(service);
	}, []);

	return (
		<ActionServiceContext.Provider
			value={{
				actionService,
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
