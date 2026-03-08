// services/SoundEffectService.ts
//
// Lightweight, fire-and-forget sound-effect service.
// Sound files live in  public/sfx/  and are referenced by ID.
//
// Adding a new sticker override:
//   1. Find the emoji's name in EMOJI_NAMES below
//   2. Drop a file named  sticker-<name>.mp3  into  public/sfx/
//   That's it — the service will find it automatically.

// ---------------------------------------------------------------------------
// Emoji → human-readable name map
// Used to derive file names: emoji "😂" → name "joy" → file "sticker-joy.mp3"
// ---------------------------------------------------------------------------

const EMOJI_NAMES: Record<string, string> = {
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

// ---------------------------------------------------------------------------
// Sound registry
// Maps a sound ID (e.g. "sticker:default") to a path under /sfx/.
// Sticker overrides are auto-generated from EMOJI_NAMES at module load.
// You can also register non-sticker sounds here for future events.
// ---------------------------------------------------------------------------

const SOUND_REGISTRY: Record<string, string> = {
	"sticker:default": "/sfx/sticker-default.mp3",
};

// Auto-register per-emoji entries: "sticker:joy" → "/sfx/sticker-joy.mp3"
for (const [_emoji, name] of Object.entries(EMOJI_NAMES)) {
	SOUND_REGISTRY[`sticker:${name}`] = `/sfx/sticker-${name}.mp3`;
}

// ---------------------------------------------------------------------------
// Volume (persisted to localStorage)
// ---------------------------------------------------------------------------

const SFX_VOLUME_KEY = "quest-net-sfx-volume";
const DEFAULT_SFX_VOLUME = 0.5;

function getVolume(): number {
	try {
		const raw = localStorage.getItem(SFX_VOLUME_KEY);
		if (raw === null) return DEFAULT_SFX_VOLUME;
		const v = parseFloat(raw);
		return isNaN(v) ? DEFAULT_SFX_VOLUME : Math.max(0, Math.min(1, v));
	} catch {
		return DEFAULT_SFX_VOLUME;
	}
}

function setVolume(v: number): void {
	const clamped = Math.max(0, Math.min(1, v));
	try {
		localStorage.setItem(SFX_VOLUME_KEY, clamped.toString());
	} catch {
		// Storage full or unavailable — not critical
	}
}

// ---------------------------------------------------------------------------
// Playback
// ---------------------------------------------------------------------------

// Cache which override files actually exist so we don't re-probe every time.
// null = not checked yet, true = exists, false = missing.
const fileExistsCache: Record<string, boolean | null> = {};

/**
 * Probe whether a sound file is available on the server.
 * Uses a HEAD request so we don't download the whole file.
 */
async function probeFile(path: string): Promise<boolean> {
	try {
		const resp = await fetch(path, { method: "HEAD" });
		return resp.ok;
	} catch {
		return false;
	}
}

/**
 * Play a sound by registry ID (e.g. "sticker:default").
 * Fire-and-forget — multiple overlapping plays are fine.
 */
async function play(soundId: string): Promise<void> {
	const path = SOUND_REGISTRY[soundId];
	if (!path) return;

	const audio = new Audio(path);
	audio.volume = getVolume();
	try {
		await audio.play();
	} catch {
		// Autoplay blocked or file missing — silently ignore
	}
}

/**
 * Play the appropriate sticker sound for the given emoji.
 * Checks for a per-emoji override file (e.g. sticker-joy.mp3); if it doesn't
 * exist, falls back to sticker-default.mp3.
 */
async function playSticker(emoji: string): Promise<void> {
	const name = EMOJI_NAMES[emoji];
	if (name) {
		const overrideId = `sticker:${name}`;
		const overridePath = SOUND_REGISTRY[overrideId];

		if (overridePath) {
			// Check the cache first
			if (fileExistsCache[overridePath] === null || fileExistsCache[overridePath] === undefined) {
				fileExistsCache[overridePath] = await probeFile(overridePath);
			}
			if (fileExistsCache[overridePath]) {
				return play(overrideId);
			}
		}
	}

	// Fallback to default
	return play("sticker:default");
}

/**
 * Get the human-readable name for an emoji (useful for debugging / docs).
 */
function getEmojiName(emoji: string): string | undefined {
	return EMOJI_NAMES[emoji];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const SoundEffectService = {
	play,
	playSticker,
	getVolume,
	setVolume,
	getEmojiName,
	EMOJI_NAMES,
};
