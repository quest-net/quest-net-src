// domains/AppSetting/AppSettingActions.ts

import { isDmAccess } from "../../utils/UrlParser";
import { Context } from "../Context/Context";
import { ContextActions } from "../Context/ContextActions";
import { AppSettings } from "./AppSetting";

export const AppSettingActions = {
	createDefault(): AppSettings {
		return ({
			theme: "light",
			volume: 100,
		})
	},
	/**
	 * Sets the player's personal volume (0.0 to 1.0)
	 * This is local to the user and doesn't sync
	 */
	setPlayerVolume(params: { volume: number }, context: Context): void {
		// Clamp volume between 0 and 1
		const volume = Math.max(0, Math.min(1, params.volume));
		context.AppSettings.volume = volume.toString();
		ContextActions.save(context);
	},

	/**
	 * Gets the player's personal volume, defaults to 0.5
	 */
	getPlayerVolume(context: Context): number {
		const volumeStr = context.AppSettings.volume;
		if (!volumeStr || isDmAccess()) {
			return 1.0; // Default volume
		}
		const volume = parseFloat(volumeStr);
		return isNaN(volume) ? 0.5 : volume;
	},

	/**
	 * Sets the theme preference (not yet implemented in UI)
	 */
	setTheme(params: { theme: "light" | "dark" }, context: Context): void {
		context.AppSettings.theme = params.theme;
		ContextActions.save(context);
	},

	/**
	 * Gets the theme preference, defaults to light
	 */
	getTheme(context: Context): "light" | "dark" {
		const theme = context.AppSettings.theme;
		if (theme === "light" || theme === "dark") {
			return theme;
		}
		return "light";
	},
};