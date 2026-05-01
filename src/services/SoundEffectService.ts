// services/SoundEffectService.ts
//
// Lightweight, fire-and-forget sound-effect service.
// Sound files live in  public/sfx/  and are referenced by ID.
//
// This service is intentionally domain-agnostic: it just knows how to play
// a sound from /sfx/ given a string id, with a fallback ladder so callers
// can request an override id (e.g. "sticker:joy") and silently fall back to
// a default (e.g. "sticker:default") if the override file is missing.
//
// Domain-specific logic (which emojis map to which sound names, which
// sounds belong to stickers vs. pings vs. combat etc.) lives in the
// respective domain — for example src/domains/Sticker/Sticker.ts holds
// the sticker emoji-to-name map and the getStickerSoundId helper.

import { EMOJI_NAMES } from "../domains/Sticker/Sticker";

// ---------------------------------------------------------------------------
// Sound registry
// Maps a sound ID (e.g. "sticker:default") to a path under /sfx/.
// Sticker overrides are auto-generated from the Sticker domain's
// EMOJI_NAMES at module load.
// ---------------------------------------------------------------------------

const SOUND_REGISTRY: Record<string, string> = {
	"sticker:default": "/sfx/sticker-default.mp3",
	// Ping (tile highlight). Drop a /sfx/ping-default.mp3 file alongside the
	// other sticker sounds to enable audio for pings; missing files are
	// silently ignored by play().
	"ping:default": "/sfx/ping-default.mp3",
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
 * Play `overrideId` if its file is available on the server, otherwise
 * fall back to `fallbackId`. Override existence is probed once and cached.
 *
 * Useful for "I'd like the joy sticker to make a custom sound, but if no
 * one's added joy.mp3 yet just play the default sticker sound" — without
 * forcing every domain to know about probeFile or the cache.
 */
async function playWithFallback(
	overrideId: string,
	fallbackId: string
): Promise<void> {
	const overridePath = SOUND_REGISTRY[overrideId];
	if (overridePath) {
		if (
			fileExistsCache[overridePath] === null ||
			fileExistsCache[overridePath] === undefined
		) {
			fileExistsCache[overridePath] = await probeFile(overridePath);
		}
		if (fileExistsCache[overridePath]) {
			return play(overrideId);
		}
	}
	return play(fallbackId);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const SoundEffectService = {
	play,
	playWithFallback,
	getVolume,
	setVolume,
};
