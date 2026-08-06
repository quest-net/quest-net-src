// Generic helpers with zero domain coupling.

/** Clamps `value` into the inclusive range [min, max]. */
export function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

/** Parses a number input's string value, falling back when it isn't finite. */
export function parseNumber(value: string, fallback: number): number {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : fallback;
}

/** Standard ease-in-out cubic over t in [0, 1]. */
export function easeInOutCubic(t: number): number {
	return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/** Resolves after `ms` — for polling loops against remote jobs. */
export function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
