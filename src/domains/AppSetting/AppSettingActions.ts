// domains/AppSetting/AppSettingActions.ts

import { isDmAccess } from "../../utils/UrlParser";
import { Context } from "../Context/Context";
import { ContextActions } from "../Context/ContextActions";
import { AppSettings, DEFAULT_IMAGE_PROMPT } from "./AppSetting";
import { SoundEffectService } from "../../services/SoundEffectService";

export const AppSettingActions = {
	createDefault(): AppSettings {
		return {
			theme: "light",
			volume: 100,
		};
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

	getImageApiKey(context: Context): string | undefined {
		return context.AppSettings.imageApiKey || undefined;
	},

	setImageApiKey(
		params: { apiKey: string | undefined },
		context: Context
	): void {
		if (params.apiKey) {
			context.AppSettings.imageApiKey = params.apiKey.trim();
		} else {
			delete context.AppSettings.imageApiKey;
		}
		ContextActions.save(context);
	},

	getImagePromptTemplate(context: Context): string {
		return context.AppSettings.imagePromptTemplate || DEFAULT_IMAGE_PROMPT;
	},

	setImagePromptTemplate(params: { template: string }, context: Context): void {
		const trimmed = params.template.trim();
		context.AppSettings.imagePromptTemplate = trimmed || DEFAULT_IMAGE_PROMPT;
		ContextActions.save(context);
	},
	/**
	 * Sets the SFX volume (0.0 to 1.0) — persisted via SoundEffectService to localStorage
	 */
	setSfxVolume(params: { volume: number }): void {
		SoundEffectService.setVolume(Math.max(0, Math.min(1, params.volume)));
	},

	/**
	 * Gets the current SFX volume (0.0 to 1.0)
	 */
	getSfxVolume(): number {
		return SoundEffectService.getVolume();
	},

	getSettings(context: Context): AppSettings {
		return {
			theme: this.getTheme(context),
			volume: this.getPlayerVolume(context),
			sfxVolume: this.getSfxVolume(),
			imageApiKey: this.getImageApiKey(context),
			imagePromptTemplate: this.getImagePromptTemplate(context),
		};
	},
};
