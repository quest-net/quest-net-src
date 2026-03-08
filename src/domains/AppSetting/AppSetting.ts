export interface AppSettings {
	theme: "light" | "dark"; // I haven't implemented this yet
	volume: number; // percentage. This is used when a player may want a different volume than the DM chose
	sfxVolume?: number; // 0-1. Sound effects volume (stickers, etc.), separate from music
	imageApiKey?: string;
  	imagePromptTemplate?: string;
}

export const DEFAULT_IMAGE_PROMPT =
  'Produce a square image that will serve as an icon for a {ObjectType} ' +
  'with name: {ObjectName} and description: {ObjectDescription}. ' +
  'White background, no text, fantasy illustration style.';
