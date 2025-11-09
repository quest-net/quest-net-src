// domains/Context/ContextActions.ts

import { Context } from "./Context";
import { LocalStorageUtilities } from "../../utils/LocalStorageUtilities";
import { UserActions } from "../User/UserActions";

const STORAGE_KEY = "quest-net-context";

export const ContextActions = {
	/**
	 * Creates a new context with default values
	 */
	create(): Context {
		const context: Context = {
			User: UserActions.createNewUser(),
			Campaigns: [],
			AppSettings: {},
			version: "1.0.0"
		};

		this.save(context);
		return context;
	},

	/**
	 * Loads context from localStorage
	 */
	load(): Context | null {
		return LocalStorageUtilities.load<Context>(STORAGE_KEY);
	},

	/**
	 * Saves context to localStorage
	 */
	save(context: Context): void {
		LocalStorageUtilities.save(STORAGE_KEY, context);
	},

	/**
	 * Clears context from localStorage
	 */
	clear(): void {
		LocalStorageUtilities.remove(STORAGE_KEY);
	},

	/**
	 * Sets the user's role and saves context
	 */
	setUserRole(params: { role: "dm" | "player" }, context: Context): void {
		context.User.Role = params.role;
	},
};
