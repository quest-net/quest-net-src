import { Context } from "../domains/Context/Context";
import type { Campaign } from "../domains/Campaign/Campaign";
import { TERRAIN_PALETTE_LEVELS } from "../utils/TerrainPaletteUtils";
import { VersionedMigration } from "./types";

// Legacy v1.4 palette: 12 named colors, indexed in this exact order.
const LEGACY_TERRAIN_TYPES = [
	"green",
	"white",
	"blue",
	"yellow",
	"brown",
	"red",
	"grey",
	"black",
	"orange",
	"purple",
	"cyan",
	"pink",
] as const;

type LegacyTerrainType = (typeof LEGACY_TERRAIN_TYPES)[number];

const LEVELS = TERRAIN_PALETTE_LEVELS;

// Hand-picked forward mapping. Each legacy color goes to one specific
// palette index so the upgrade is fully deterministic.
const LEGACY_TO_FIXED: Record<LegacyTerrainType, number> = {
	red:     1 * LEVELS + 1, // red, mid
	orange:  2 * LEVELS + 2, // orange, mid
	brown:   3 * LEVELS + 1, // orange, darkest
	yellow:  3 * LEVELS + 3, // yellow, mid
	green:   5 * LEVELS + 2, // green, mid
	cyan:    6 * LEVELS + 2, // cyan, mid
	blue:    8 * LEVELS + 2, // blue, mid
	purple: 10 * LEVELS + 2, // purple-blue, mid
	pink:   11 * LEVELS + 2, // pink, mid
	black:  12 * LEVELS + 0, // greyscale, darkest
	grey:   12 * LEVELS + 2, // greyscale, dark-mid
	white:  12 * LEVELS + 4, // greyscale, lightest
};

// Lookup by legacy numeric index (the value stored in old ColorMaps).
const LEGACY_INDEX_TO_FIXED: number[] = LEGACY_TERRAIN_TYPES.map(
	(type) => LEGACY_TO_FIXED[type]
);

const LEGACY_TYPE_TO_INDEX = Object.fromEntries(
	LEGACY_TERRAIN_TYPES.map((type, index) => [type, index] as const)
) as Record<LegacyTerrainType, number>;

const DEFAULT_FIXED_INDEX = LEGACY_TO_FIXED.green;
const DEFAULT_LEGACY_INDEX = LEGACY_TYPE_TO_INDEX.green;

// Reset: collapse a new-palette family back to a single legacy color.
// Lossy by design — the old palette has no equivalent for most family/tone
// combinations, so every tone in a family maps to the same legacy color.
// Greyscale is handled separately so dark/mid/light split into black/grey/white.
const FAMILY_TO_LEGACY: LegacyTerrainType[] = [
	"red",     //  0 red
	"orange",  //  1 orange
	"yellow",  //  2 yellow
	"yellow",  //  3 yellow-green
	"green",   //  4 green
	"green",   //  5 green-cyan
	"cyan",    //  6 cyan
	"blue",    //  7 blue-cyan
	"blue",    //  8 blue
	"purple",  //  9 purple-blue
	"purple",  // 10 magenta
	"pink",    // 11 pink
];

function fixedIndexToLegacyIndex(fixedIndex: number): number {
	if (!Number.isFinite(fixedIndex) || fixedIndex < 0) {
		return DEFAULT_LEGACY_INDEX;
	}

	const familyIndex = Math.floor(fixedIndex / LEVELS);
	const toneIndex = fixedIndex % LEVELS;

	if (familyIndex === 12) {
		const greyType: LegacyTerrainType =
			toneIndex === 0 ? "black" : toneIndex >= 3 ? "white" : "grey";
		return LEGACY_TYPE_TO_INDEX[greyType];
	}

	const legacy = FAMILY_TO_LEGACY[familyIndex];
	return legacy != null ? LEGACY_TYPE_TO_INDEX[legacy] : DEFAULT_LEGACY_INDEX;
}

/**
 * Migration 1.5.0: fixed 13-family, 5-tone terrain color palette.
 *
 * ColorMap stays a compact numeric grid. Each of the 12 legacy colors is
 * mapped to a hand-picked index in the expanded palette, so the
 * transformation is deterministic and easy to reason about.
 */
export const migration_1_5_0: VersionedMigration = {
	version: "1.5.0",

	update: (context: Context): Context => {
		const campaigns = (context.Campaigns ?? []) as unknown as Campaign[];
		for (const campaign of campaigns) {
			for (const terrain of campaign.Terrains ?? []) {
				terrain.ColorMap = terrain.ColorMap.map((row) =>
					row.map((index) => LEGACY_INDEX_TO_FIXED[index] ?? DEFAULT_FIXED_INDEX)
				);
				delete (terrain as { Palette?: string[] }).Palette;
			}
		}

		return { ...context, version: "1.5.0" };
	},

	reset: (context: Context): Context => {
		const campaigns = (context.Campaigns ?? []) as unknown as Campaign[];
		for (const campaign of campaigns) {
			for (const terrain of campaign.Terrains ?? []) {
				terrain.ColorMap = terrain.ColorMap.map((row) =>
					row.map((index) => fixedIndexToLegacyIndex(index))
				);
			}
		}

		return { ...context, version: "1.4.0" };
	},
};
