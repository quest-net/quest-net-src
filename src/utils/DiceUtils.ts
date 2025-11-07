// utils/DiceUtils.ts

const MAX_DICE_PER_GROUP = 20;  // Max dice in a single group (e.g., 100d20)
const MAX_TOTAL_DICE = 20;       // Max total dice across all groups
const MAX_DIE_SIDES = 1000;       // Max sides on a die
const MAX_GROUPS = 8;            // Max number of dice groups

export interface DieResult {
  value: number;
  sides: number;
  isMax: boolean;
  isMin: boolean;
  kept: boolean;       // true if this die contributed to the subtotal (after kh/kl)
  groupIndex: number;  // which group in the parsed formula
  indexInGroup: number;
}

export interface KeepClause {
  type: "h" | "l";
  n: number;
}

export interface DiceItem {
  kind: "dice";
  sign: 1 | -1;        // allow subtraction of groups (rare, but supported)
  count: number;
  sides: number;
  keep?: KeepClause;   // kh/kl
}

export interface ModItem {
  kind: "mod";
  sign: 1 | -1;
  value: number;
}

export type FormulaItem = DiceItem | ModItem;

export interface DiceGroupResult {
  sign: 1 | -1;
  count: number;
  sides: number;
  keep?: KeepClause;
  rolls: number[];      // raw rolls for this group
  usedIndices: number[]; // indices of rolls used in subtotal (after keep)
  usedValues: number[];  // convenience
  subtotal: number;      // (sum of usedValues) * sign
  notation: string;      // e.g. "2d20kh1"
}

export interface RollStats {
  total: number;         // final total (includes modifiers and negative groups)
  highestDie: number | null; // highest kept die value across all groups
  lowestDie: number | null;  // lowest kept die value across all groups
  numDice: number;       // total # of dice rolled (before keep)
  numKept: number;       // total # of kept dice (after keep)
}

export interface DiceRollResult {
  formula: string;       // canonical, spaced: "1d20 + 1d8 - 2"
  total: number;
  breakdown: string;     // human string like "+[7,12]kh1=12 +3"
  stats: RollStats;
  groups: DiceGroupResult[];
  dice: DieResult[];     // flattened list for animation
}

export interface RollOptions {
  rng?: () => number; // custom RNG (0-1)
  seed?: number;      // if provided, overrides rng with deterministic Mulberry32
}

/*** Core helpers ***/

// Parses parts like:
//  - "2d6", "d20", "2d20kh1", "2d20kl1"
export const DICE_RE = /^(\d+)?d(\d+)(k([hl])(\d+))?$/i;

/** Mulberry32 for deterministic animations */
function mulberry32(seed: number): () => number {
  return function () {
    let t = (seed += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function getRng(opts?: RollOptions): () => number {
  if (opts?.seed != null) return mulberry32(opts.seed);
  return opts?.rng ?? Math.random;
}

function rollDie(sides: number, rng: () => number): number {
  return Math.floor(rng() * sides) + 1;
}

/** Split a formula into signed items (dice groups and modifiers). */
export function parseFormula(input: string): { items: FormulaItem[]; canonical: string } {
	const cleaned = (input || "").replace(/\s+/g, "");
	if (!cleaned || !/^[\dd+\-khl]+$/i.test(cleaned)) {
	  throw new Error(`Invalid dice formula: ${input}`);
	}
  
	const parts = cleaned.split(/([+\-])/);
	const items: FormulaItem[] = [];
	let currentSign: 1 | -1 = 1;
	let totalDice = 0;
	let diceGroups = 0;
  
	for (const part of parts) {
	  if (!part) continue;
	  if (part === "+") { currentSign = 1; continue; }
	  if (part === "-") { currentSign = -1; continue; }
  
	  const m = part.match(DICE_RE);
	  if (m) {
		const count = parseInt(m[1] || "1", 10);
		const sides = parseInt(m[2], 10);
		
		// Validation checks
		if (!(count > 0 && sides > 0)) {
		  throw new Error(`Invalid dice: ${part}`);
		}
		
		if (count > MAX_DICE_PER_GROUP) {
		  throw new Error(`Too many dice in one group: ${count}d${sides} (max ${MAX_DICE_PER_GROUP})`);
		}
		
		if (sides > MAX_DIE_SIDES) {
		  throw new Error(`Die has too many sides: d${sides} (max d${MAX_DIE_SIDES})`);
		}
		
		totalDice += count;
		diceGroups++;
		
		if (totalDice > MAX_TOTAL_DICE) {
		  throw new Error(`Too many total dice: ${totalDice} (max ${MAX_TOTAL_DICE})`);
		}
		
		if (diceGroups > MAX_GROUPS) {
		  throw new Error(`Too many dice groups: ${diceGroups} (max ${MAX_GROUPS})`);
		}
  
		let keep: KeepClause | undefined;
		if (m[3]) {
		  const type = (m[4] || "").toLowerCase() as "h" | "l";
		  const n = m[5] ? parseInt(m[5], 10) : 0;
		  if (!["h", "l"].includes(type) || !(n > 0 && n <= count)) {
			throw new Error(`Invalid keep clause: ${part}`);
		  }
		  keep = { type, n };
		}
  
		items.push({ kind: "dice", sign: currentSign, count, sides, keep });
	  } else {
		const value = parseInt(part, 10);
		if (isNaN(value)) throw new Error(`Invalid modifier: ${part}`);
		items.push({ kind: "mod", sign: currentSign, value: Math.abs(value) });
	  }
	}
  
	// Build canonical, spaced representation
	const canonical = items
	  .map((it, idx) => {
		const sign = it.sign === 1 ? (idx === 0 ? "" : " + ") : " - ";
		if (it.kind === "mod") return `${sign}${it.value}`;
		const keep = it.keep ? `k${it.keep.type}${it.keep.n}` : "";
		return `${sign}${it.count}d${it.sides}${keep}`;
	  })
	  .join("")
	  .trim();
  
	return { items, canonical };
  }

/** Normalize any formula to canonical, spaced representation. */
export function normalizeFormula(input: string): string {
  return parseFormula(input).canonical;
}

/**
 * UI helper: add a die click into a formula.
 * - If the last item is the same die (e.g., d20) WITHOUT a keep-clause, increment count (1d20 -> 2d20).
 * - Otherwise append " + 1dX".
 */
export function addDieToFormula(current: string, sides: number): string {
  if (!(sides > 0)) return normalizeFormula(current || "");

  // Empty → "1dX"
  if (!current || !current.trim()) return `1d${sides}`;

  let { items } = parseFormula(current);
  // Find last dice item (ignoring trailing mods)
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (it.kind === "dice") {
      if (it.sign === 1 && it.sides === sides && !it.keep) {
        it.count += 1;
        return normalizeItems(items);
      }
      break; // last dice is different or has keep; append a new one
    }
  }

  items = items.concat([{ kind: "dice", sign: 1, count: 1, sides, keep: undefined } as DiceItem]);
  return normalizeItems(items);
}

function normalizeItems(items: FormulaItem[]): string {
  return items
    .map((it, idx) => {
      const sign = it.sign === 1 ? (idx === 0 ? "" : " + ") : " - ";
      if (it.kind === "mod") return `${sign}${it.value}`;
      const keep = it.keep ? `k${it.keep.type}${it.keep.n}` : "";
      return `${sign}${it.count}d${it.sides}${keep}`;
    })
    .join("")
    .trim();
}

/*** Rolling ***/

/**
 * Rolls a dice formula and returns rich per-die results plus stats.
 * Supports optional seeded RNG for deterministic previews.
 */
export function rollDiceFormula(formula: string, opts?: RollOptions): DiceRollResult {
  const rng = getRng(opts);
  const { items, canonical } = parseFormula(formula);

  const groups: DiceGroupResult[] = [];
  const allDice: DieResult[] = [];
  let runningTotal = 0;

  const pushDice = (
    groupIndex: number,
    sides: number,
    values: number[],
    keep?: KeepClause,
    sign: 1 | -1 = 1
  ) => {
    const indices = values.map((_, i) => i);

    let usedIndices: number[];
    if (!keep) {
      usedIndices = indices;
    } else {
      // sort clone of indices by value asc
      const sortedIdx = [...indices].sort((a, b) => values[a] - values[b]);
      usedIndices = keep.type === "h"
        ? sortedIdx.slice(-keep.n) // highest
        : sortedIdx.slice(0, keep.n); // lowest
      // preserve ascending order for display consistency
      usedIndices.sort((a, b) => a - b);
    }

    const usedValues = usedIndices.map(i => values[i]);
    const subtotalUnsigned = usedValues.reduce((s, v) => s + v, 0);
    const signedSubtotal = subtotalUnsigned * sign;

    groups.push({
      sign,
      count: values.length,
      sides,
      keep,
      rolls: values,
      usedIndices,
      usedValues,
      subtotal: signedSubtotal,
      notation: `${values.length}d${sides}${keep ? `k${keep.type}${keep.n}` : ""}`,
    });

    runningTotal += signedSubtotal;

    // Flatten for animation / flags
    for (let idx = 0; idx < values.length; idx++) {
      const v = values[idx];
      allDice.push({
        value: v,
        sides,
        isMax: v === sides,
        isMin: v === 1,
        kept: usedIndices.includes(idx),
        groupIndex,
        indexInGroup: idx,
      });
    }
  };

  let diceGroupIndex = 0;
  let modsTotal = 0;

  for (const it of items) {
    if (it.kind === "mod") {
      const signed = it.value * it.sign;
      modsTotal += signed;
      continue;
    }

    // Roll this dice group
    const values: number[] = [];
    for (let i = 0; i < it.count; i++) {
      values.push(rollDie(it.sides, rng));
    }
    pushDice(diceGroupIndex, it.sides, values, it.keep, it.sign);
    diceGroupIndex++;
  }

  runningTotal += modsTotal;

  // Stats (based on kept dice only)
  const keptValues = allDice.filter(d => d.kept).map(d => d.value);
  const highestDie = keptValues.length ? Math.max(...keptValues) : null;
  const lowestDie  = keptValues.length ? Math.min(...keptValues) : null;

  // Build breakdown string similar to your original (shows groups + modifiers)
  const breakdownParts: string[] = [];
  for (const g of groups) {
    const sign = g.sign === 1 ? "+" : "-";
    const rollsStr = g.count > 1 ? `[${g.rolls.join(",")}]` : `[${g.rolls[0]}]`;
    const keepStr = g.keep ? `k${g.keep.type}${g.keep.n}` : "";
    const eqStr = g.count > 1 || !!g.keep ? `=${Math.abs(g.subtotal)}` : "";
    breakdownParts.push(`${sign}${rollsStr}${keepStr}${eqStr}`);
  }
  if (modsTotal !== 0) {
    breakdownParts.push(`${modsTotal > 0 ? "+" : "-"}${Math.abs(modsTotal)}`);
  }
  let breakdown = breakdownParts.join("");
  if (breakdown.startsWith("+")) breakdown = breakdown.substring(1);

  const result: DiceRollResult = {
    formula: canonical,
    total: runningTotal,
    breakdown,
    stats: {
      total: runningTotal,
      highestDie,
      lowestDie,
      numDice: allDice.length,
      numKept: keptValues.length,
    },
    groups,
    dice: allDice,
  };

  return result;
}

/** Validation without rolling */
export function isValidDiceFormula(formula: string): boolean {
  try {
    parseFormula(formula);
    return true;
  } catch {
    return false;
  }
}

/** Heads/Tails */
export function flipCoin(): "Heads" | "Tails" {
  return Math.random() < 0.5 ? "Heads" : "Tails";
}

/** Convenience: build your log line with stats */
export function makeRollLogText(result: DiceRollResult): string {
	// Only show highest/lowest stats if more than 1 die was kept
	if (result.stats.numKept <= 1) {
	  return `Rolled ${result.formula}: ${result.total}`;
	}
	
	const hi = result.stats.highestDie ?? "-";
	const lo = result.stats.lowestDie ?? "-";
	return `Rolled ${result.formula}: ${result.total} [highest: ${hi} | lowest: ${lo}]`;
  }
