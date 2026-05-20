// src/migrations/v1_9_0_terrainPalette.ts
//
// Remaps voxel terrain color indices from the old 65-color palette (v1) to
// the new 240-color palette (v1.9.0).
//
// The old palette is reproduced here in full so it can be removed from the
// application source; TerrainPaletteUtils no longer exports it.

import type { Migration } from "./types";
import { DEFAULT_TERRAIN_COLOR_INDEX, TERRAIN_PALETTE } from "../utils/terrain/palette/TerrainPaletteUtils";

// --- Old palette v1 (65 colors: 13 families x 5 lightness levels) -----------
//
// Families ordered by hue (degrees), last entry is greyscale (null).
// Chroma = 0.20 for all chromatic families.
// Lightness = [0.30, 0.45, 0.60, 0.75, 0.90].

const OLD_HUES: ReadonlyArray<number | null> = [
	0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330, null,
];
const OLD_LIGHTNESS = [0.30, 0.45, 0.60, 0.75, 0.90] as const;
const OLD_CHROMA = 0.20;

function linearToSrgbV1(v: number): number {
	const x = Math.max(0, Math.min(1, v));
	return x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
}

function oklchToHexV1(L: number, C: number, h: number): string {
	const hRad = (h * Math.PI) / 180;
	const a = C * Math.cos(hRad);
	const b = C * Math.sin(hRad);
	const lp = L + 0.3963377774 * a + 0.2158037573 * b;
	const mp = L - 0.1055613458 * a - 0.0638541728 * b;
	const sp = L - 0.0894841775 * a - 1.291485548 * b;
	const l = lp ** 3, m = mp ** 3, s = sp ** 3;
	const r  = linearToSrgbV1( 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s);
	const g  = linearToSrgbV1(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s);
	const bl = linearToSrgbV1(-0.0041960863 * l - 0.7034186147 * m + 1.707614701  * s);
	const ch = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, "0");
	return `#${ch(r)}${ch(g)}${ch(bl)}`;
}

const OLD_PALETTE: readonly string[] = OLD_HUES.flatMap((hue) =>
	OLD_LIGHTNESS.map((L) =>
		hue === null ? oklchToHexV1(L, 0, 0) : oklchToHexV1(L, OLD_CHROMA, hue)
	)
);

// --- Nearest-color remapping -------------------------------------------------

function hexToOklab(hex: string): [number, number, number] {
	const h = hex.replace("#", "");
	const toLinear = (n: number) => {
		const s = n / 255;
		return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
	};
	const r = toLinear(parseInt(h.slice(0, 2), 16));
	const g = toLinear(parseInt(h.slice(2, 4), 16));
	const b = toLinear(parseInt(h.slice(4, 6), 16));
	const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
	const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
	const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
	return [
		 0.2104542553 * l + 0.793617785  * m - 0.0040720468 * s,
		 1.9779984951 * l - 2.428592205  * m + 0.4505937099 * s,
		 0.0259040371 * l + 0.7827717662 * m - 0.808675766  * s,
	];
}

// Builds a 256-entry lookup: old color byte -> new color byte.
// Old indices 0-64 are nearest-color matched into the new palette.
// Old indices 65-255 were never valid; they map to the default color.
function buildRemapTable(): Uint8Array {
	const newLab = (TERRAIN_PALETTE as readonly string[]).map(hexToOklab);
	const table  = new Uint8Array(256).fill(DEFAULT_TERRAIN_COLOR_INDEX);

	for (let oldIdx = 0; oldIdx < OLD_PALETTE.length; oldIdx++) {
		const [L1, a1, b1] = hexToOklab(OLD_PALETTE[oldIdx]);
		let best = DEFAULT_TERRAIN_COLOR_INDEX;
		let bestDist = Infinity;
		for (let newIdx = 0; newIdx < newLab.length; newIdx++) {
			const [L2, a2, b2] = newLab[newIdx];
			const d = (L1 - L2) ** 2 + (a1 - a2) ** 2 + (b1 - b2) ** 2;
			if (d < bestDist) { bestDist = d; best = newIdx; }
		}
		table[oldIdx] = best;
	}

	return table;
}

// Decodes base64 voxel data, remaps the low color byte of each uint32, re-encodes.
function remapVoxelString(encoded: string, remap: Uint8Array): string {
	if (!encoded) return encoded;
	const binary = atob(encoded);
	const bytes  = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	const arr = new Uint32Array(bytes.buffer);
	for (let i = 0; i < arr.length; i++) {
		arr[i] = (arr[i] & 0xFFFFFF00) | remap[arr[i] & 0xFF];
	}
	const out = new Uint8Array(arr.buffer);
	let result = "";
	for (let i = 0; i < out.length; i++) result += String.fromCharCode(out[i]);
	return btoa(result);
}

// --- Migration ---------------------------------------------------------------

export const terrainPaletteV190Migration: Migration = {
	version: "1.9.0",
	migrate: async (data: unknown, storage) => {
		const campaign = data as any;
		const remap    = buildRemapTable();

		// Remap inline voxels (active/hydrated terrain stored in the campaign object)
		for (const terrain of campaign.VoxelTerrains ?? []) {
			if (terrain.Voxels) {
				terrain.Voxels = remapVoxelString(terrain.Voxels, remap);
			}
		}

		// Remap all IDB-stored terrain records that belong to this campaign
		const allRecords = await storage.idbGetAll("voxelTerrains") as any[];
		for (const record of allRecords) {
			if (record.CampaignId !== campaign.Id) continue;
			record.Voxels = remapVoxelString(record.Voxels, remap);
			await storage.idbPut("voxelTerrains", record);
		}

		return campaign;
	},
};
