// src/utils/TerrainPaletteUtils.ts
//
// Defines the 240-color voxel terrain palette (indices 0-239).
// Indices 240-255 are reserved for future special/system use.
//
// Layout: TERRAIN_PALETTE_COLUMNS families x TERRAIN_PALETTE_ROWS lightness levels.
//   Family 0:    neutral greyscale (chroma = 0)
//   Family 1:    warm neutral (very low chroma, earthy hue)
//   Families 2+: 18 chromatic hues at 0, 20, 40, ..., 340 degrees

export const TERRAIN_PALETTE_COLUMNS = 20; // hue families
export const TERRAIN_PALETTE_ROWS    = 12; // lightness levels per family
export const TERRAIN_PALETTE_SIZE    = TERRAIN_PALETTE_COLUMNS * TERRAIN_PALETTE_ROWS; // 240

// Shifted darker so the 3DMap's top-face brightening doesn't wash colors out
const MIN_LIGHTNESS = 0.10;
const MAX_LIGHTNESS = 0.82;
const CHROMA        = 0.20;

// [chroma, hue] -- null hue means pure greyscale (chroma is irrelevant)
const FAMILIES: ReadonlyArray<readonly [number, number | null]> = [
	[0,    null] as const,  // 0: greyscale
	[0.04,   60] as const,  // 1: warm neutral (earth/sand tones)
	...Array.from({ length: 18 }, (_, i): readonly [number, number] => [CHROMA, i * 20] as const),
];

// --- OKLCh -> sRGB hex -------------------------------------------------------

function linearToSrgb(v: number): number {
	const x = Math.max(0, Math.min(1, v));
	return x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
}

function channelToHex(v: number): string {
	return Math.round(Math.max(0, Math.min(1, v)) * 255)
		.toString(16)
		.padStart(2, "0");
}

function oklchToHex(L: number, C: number, h: number): string {
	const hRad = (h * Math.PI) / 180;
	const a = C * Math.cos(hRad);
	const b = C * Math.sin(hRad);
	const lp = L + 0.3963377774 * a + 0.2158037573 * b;
	const mp = L - 0.1055613458 * a - 0.0638541728 * b;
	const sp = L - 0.0894841775 * a - 1.291485548 * b;
	const l = lp ** 3, m = mp ** 3, s = sp ** 3;
	const r  = linearToSrgb( 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s);
	const g  = linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s);
	const bl = linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701  * s);
	return `#${channelToHex(r)}${channelToHex(g)}${channelToHex(bl)}`;
}

// --- Palette -----------------------------------------------------------------

function buildPalette(): string[] {
	const palette: string[] = [];
	for (const [chroma, hue] of FAMILIES) {
		for (let row = 0; row < TERRAIN_PALETTE_ROWS; row++) {
			const L = MIN_LIGHTNESS + (row / (TERRAIN_PALETTE_ROWS - 1)) * (MAX_LIGHTNESS - MIN_LIGHTNESS);
			palette.push(oklchToHex(L, chroma, hue ?? 0));
		}
	}
	return palette;
}

export const TERRAIN_PALETTE: readonly string[] = buildPalette();

// Default: light grey (greyscale family, brightest level)
export const DEFAULT_TERRAIN_COLOR_INDEX = TERRAIN_PALETTE_ROWS - 1; // index 11

export function getTerrainColorByIndex(index: number): string {
	return TERRAIN_PALETTE[index] ?? TERRAIN_PALETTE[DEFAULT_TERRAIN_COLOR_INDEX];
}
