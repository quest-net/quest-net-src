export const TERRAIN_COLOR_FAMILIES = [
	{ id: "magenta", label: "Yellow", hue: 0 },
	{ id: "red", label: "Yellow Orange", hue: 30 },
	{ id: "orange", label: "Orange", hue: 60 },
	{ id: "yellow", label: "Orange Red", hue: 90 },
	{ id: "lime", label: "Red", hue: 120 },
	{ id: "green", label: "Red Purple", hue: 150 },
	{ id: "teal", label: "Purple", hue: 180 },
	{ id: "cyan", label: "Purple Blue", hue: 210 },
	{ id: "blue", label: "Blue", hue: 240 },
	{ id: "indigo", label: "Blue Green", hue: 270 },
	{ id: "purple", label: "Green", hue: 300 },
	{ id: "pink", label: "Green Yellow", hue: 330 },
	{ id: "greyscale", label: "Greyscale", hue: null },
] as const;

export type TerrainColorFamilyId = (typeof TERRAIN_COLOR_FAMILIES)[number]["id"];

export interface TerrainPaletteFamily {
	id: TerrainColorFamilyId;
	label: string;
	colors: readonly string[];
}

export const TERRAIN_PALETTE_LIGHTNESS = [0.30, 0.45, 0.60, 0.75, 0.90] as const;
export const TERRAIN_PALETTE_CHROMA = 0.20;
export const TERRAIN_PALETTE_LEVELS = TERRAIN_PALETTE_LIGHTNESS.length;

function clamp01(value: number): number {
	return Math.max(0, Math.min(1, value));
}

function linearToSrgb(value: number): number {
	const v = clamp01(value);
	return v <= 0.0031308
		? 12.92 * v
		: 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
}

function channelToHex(value: number): string {
	return Math.round(clamp01(value) * 255)
		.toString(16)
		.padStart(2, "0");
}

function oklchToHex(lightness: number, chroma: number, hue: number): string {
	const hueRadians = (hue * Math.PI) / 180;
	const a = chroma * Math.cos(hueRadians);
	const b = chroma * Math.sin(hueRadians);

	const lPrime = lightness + 0.3963377774 * a + 0.2158037573 * b;
	const mPrime = lightness - 0.1055613458 * a - 0.0638541728 * b;
	const sPrime = lightness - 0.0894841775 * a - 1.291485548 * b;

	const l = lPrime ** 3;
	const m = mPrime ** 3;
	const s = sPrime ** 3;

	const r = linearToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s);
	const g = linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s);
	const bl = linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s);

	return `#${channelToHex(r)}${channelToHex(g)}${channelToHex(bl)}`;
}

function greyscaleToHex(lightness: number): string {
	return oklchToHex(lightness, 0, 0);
}

export function generateTerrainPaletteFamilies(): TerrainPaletteFamily[] {
	return TERRAIN_COLOR_FAMILIES.map((family) => ({
		id: family.id,
		label: family.label,
		colors: TERRAIN_PALETTE_LIGHTNESS.map((lightness) =>
			family.hue == null
				? greyscaleToHex(lightness)
				: oklchToHex(lightness, TERRAIN_PALETTE_CHROMA, family.hue)
		),
	}));
}

export const TERRAIN_PALETTE_FAMILIES = generateTerrainPaletteFamilies();
export const TERRAIN_PALETTE = TERRAIN_PALETTE_FAMILIES.flatMap((family) => [
	...family.colors,
]);

export const DEFAULT_TERRAIN_COLOR_INDEX =
	12 * TERRAIN_PALETTE_LEVELS + 4; // White

export function getTerrainPaletteIndex(
	familyIndex: number,
	levelIndex: number
): number {
	return familyIndex * TERRAIN_PALETTE_LEVELS + levelIndex;
}

export function getTerrainColorByIndex(index: number): string {
	return TERRAIN_PALETTE[index] ?? TERRAIN_PALETTE[DEFAULT_TERRAIN_COLOR_INDEX];
}
