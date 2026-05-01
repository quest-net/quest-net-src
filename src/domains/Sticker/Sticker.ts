// Sticker.ts
// Ephemeral emoji reaction shown above an actor on the map.
//
// Stickers are not persisted as their own collection — they ride on top of
// the existing Log system as entries with Category === "sticker". The
// emoji string itself is stored in LogEntry.Details. Visual rendering on
// the map and expiration are handled by useActiveStickers + Token.

// How long a sticker remains visible above its actor.
export const STICKER_DURATION_MS = 5000;

// How long a single actor must wait between sending stickers. Matches the
// duration so the cooldown ends right as the previous sticker fades.
// Stickers are cheaper than pings to spam (no positional data to think
// about), so the cooldown is intentionally a touch longer.
export const STICKER_RATE_LIMIT_MS = 10000;

// Picker palette. Order matters — this is what users see in the popover.
export const COMMON_EMOJIS: string[] = [
	"😂", "😢", "😱", "😬", "🤔", "😈",
	"❤️", "💀", "🔥", "✨", "🎉",
	"👍", "👎", "🍆", "👋", "😫",
	"❓", "❗", "😡", "😮",
];

// Emoji → human-readable name. Used to derive sound override file names:
// emoji "😂" → name "joy" → file "/sfx/sticker-joy.mp3". Adding a new
// override means: drop the file in public/sfx/, then add a row here.
export const EMOJI_NAMES: Record<string, string> = {
	"😂": "joy",
	"😢": "cry",
	"😱": "scream",
	"😬": "grimace",
	"🤔": "thinking",
	"😈": "devil",
	"❤️": "heart",
	"💀": "skull",
	"🔥": "fire",
	"✨": "sparkles",
	"🎉": "party",
	"👍": "thumbsup",
	"👎": "thumbsdown",
	"🍆": "eggplant",
	"👋": "wave",
	"😫": "weary",
	"❓": "question",
	"❗": "exclamation",
	"😡": "angry",
	"😮": "surprised",
};

/**
 * Returns the sound-registry id for a sticker emoji, e.g. "sticker:joy".
 * Always returns a string; callers that hit a missing override file fall
 * back to "sticker:default" themselves (see SoundEffectService.playWithFallback).
 */
export function getStickerSoundId(emoji: string): string {
	const name = EMOJI_NAMES[emoji];
	return name ? `sticker:${name}` : "sticker:default";
}
