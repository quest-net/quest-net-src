// MapUtilities.ts - Pure functions and utilities for isometric map rendering

import type { Terrain, TerrainType } from "../../domains/Terrain/Terrain";
import type { Character } from "../../domains/Character/Character";
import type { Entity } from "../../domains/Entity/Entity";
import type { ActorSize } from "../../domains/Actor/Actor";
import { MAX_HEIGHT, TERRAIN_COLORS } from "../../domains/Terrain/Terrain";
import { getTokenDimensions } from "./Token";
import { TILE_H, TILE_W, V_SCALE } from "./Terrain";

export const MIN_SCALE = 0.5;
export const MAX_SCALE = 4;

export type Orientation = 0 | 1 | 2 | 3;

export interface BaseTile {
	x: number;
	y: number;
	h: number;
	color: number;
}

export interface Projected {
	cx: number;
	cy: number;
	rx: number;
	ry: number;
}

export interface GridBounds {
	minX: number;
	maxX: number;
	minY: number;
	maxY: number;
	width: number;
	height: number;
}

export interface AnimationState {
	from: Orientation;
	to: Orientation;
	t: number;
	start: number;
}

export function hexToNum(hex: string): number {
	const h = hex.startsWith("#") ? hex.slice(1) : hex;
	return parseInt(h, 16);
}

export function mulColor(rgb: number, factor: number): number {
	let r = ((rgb >> 16) & 0xff) * factor;
	let g = ((rgb >> 8) & 0xff) * factor;
	let b = (rgb & 0xff) * factor;
	r = Math.max(0, Math.min(255, r));
	g = Math.max(0, Math.min(255, g));
	b = Math.max(0, Math.min(255, b));
	return ((r & 0xff) << 16) | ((g & 0xff) << 8) | (b & 0xff);
}

export function easeInOut(t: number): number {
	return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

export function rotXY(
	x: number,
	y: number,
	W: number,
	L: number,
	o: Orientation
): { rx: number; ry: number } {
	switch (o) {
		case 0:
			return { rx: x, ry: y };
		case 1:
			return { rx: y, ry: W - 1 - x };
		case 2:
			return { rx: W - 1 - x, ry: L - 1 - y };
		case 3:
			return { rx: L - 1 - y, ry: x };
	}
}

export function screenEastNeighbor(
	x: number,
	y: number,
	o: Orientation
): { nx: number; ny: number } {
	switch (o) {
		case 0:
			return { nx: x + 1, ny: y };
		case 1:
			return { nx: x, ny: y + 1 };
		case 2:
			return { nx: x - 1, ny: y };
		case 3:
			return { nx: x, ny: y - 1 };
	}
}

export function screenSouthNeighbor(
	x: number,
	y: number,
	o: Orientation
): { nx: number; ny: number } {
	switch (o) {
		case 0:
			return { nx: x, ny: y + 1 };
		case 1:
			return { nx: x - 1, ny: y };
		case 2:
			return { nx: x, ny: y - 1 };
		case 3:
			return { nx: x + 1, ny: y };
	}
}

export function isoToScreen(
	x: number,
	y: number,
	height: number = 0
): { cx: number; cy: number } {
	const cx = (x - y) * (TILE_W / 2);
	const cy = (x + y) * (TILE_H / 2) - height * V_SCALE;
	return { cx, cy };
}

export function buildBaseTiles(terrain: Terrain): BaseTile[] {
	const W = terrain.Width;
	const L = terrain.Length;
	const hmap = terrain.HeightMap || [];
	const cmap = terrain.ColorMap || [];
	const out: BaseTile[] = [];

	for (let y = 0; y < L; y++) {
		for (let x = 0; x < W; x++) {
			const hgt = (hmap[y]?.[x] ?? 0) | 0;
			const ttype = (cmap[y]?.[x] ?? "grey") as TerrainType;
			const color = hexToNum(TERRAIN_COLORS[ttype] ?? "#6b7280");
			out.push({ x, y, h: hgt, color });
		}
	}

	return out;
}

export function projectTiles(
	baseTiles: BaseTile[],
	width: number,
	length: number,
	orientation: Orientation
): Projected[] {
	const arr: Projected[] = new Array(baseTiles.length);

	for (let i = 0; i < baseTiles.length; i++) {
		const t = baseTiles[i];
		const { rx, ry } = rotXY(t.x, t.y, width, length, orientation);
		const { cx, cy } = isoToScreen(rx, ry, t.h);
		arr[i] = { cx, cy, rx, ry };
	}

	return arr;
}

export function lerpProjections(
	projFrom: Projected[],
	projTo: Projected[],
	t: number
): Projected[] {
	const result: Projected[] = new Array(projFrom.length);

	for (let i = 0; i < projFrom.length; i++) {
		const pf = projFrom[i];
		const pt = projTo[i];
		result[i] = {
			cx: pf.cx * (1 - t) + pt.cx * t,
			cy: pf.cy * (1 - t) + pt.cy * t,
			rx: pt.rx,
			ry: pt.ry,
		};
	}

	return result;
}

export function calculateGridBounds(projected: Projected[]): GridBounds {
	const halfW = TILE_W / 2;
	const halfH = TILE_H / 2;
	let minX = Infinity,
		minY = Infinity,
		maxX = -Infinity,
		maxY = -Infinity;

	for (let i = 0; i < projected.length; i++) {
		const p = projected[i];
		minX = Math.min(minX, p.cx - halfW);
		maxX = Math.max(maxX, p.cx + halfW);
		minY = Math.min(minY, p.cy - halfH);
		maxY = Math.max(maxY, p.cy + halfH);
	}

	const width = maxX - minX;
	const height = maxY - minY;

	return { minX, minY, maxX, maxY, width, height };
}

export function centerGridInView(
	bounds: GridBounds,
	viewWidth: number,
	viewHeight: number
): { cx: number; cy: number } {
	const cx = viewWidth / 2 - (bounds.minX + bounds.width / 2);
	const cy = viewHeight / 2 - (bounds.minY + bounds.height / 2);
	return { cx, cy };
}

export function lerpCenter(
	centerFrom: { cx: number; cy: number },
	centerTo: { cx: number; cy: number },
	t: number
): { cx: number; cy: number } {
	return {
		cx: centerFrom.cx * (1 - t) + centerTo.cx * t,
		cy: centerFrom.cy * (1 - t) + centerTo.cy * t,
	};
}

export function clampPan(
	pan: { x: number; y: number },
	center: { x: number; y: number },
	bounds: GridBounds,
	scale: number,
	viewWidth: number,
	viewHeight: number,
	padding: number = 200
): { x: number; y: number } {
	const minPanX = -center.x - bounds.maxX * scale + padding;
	const minPanY = -center.y - bounds.maxY * scale + padding;
	const maxPanX = viewWidth - center.x - bounds.minX * scale - padding;
	const maxPanY = viewHeight - center.y - bounds.minY * scale - padding;

	return {
		x: Math.max(minPanX, Math.min(maxPanX, pan.x)),
		y: Math.max(minPanY, Math.min(maxPanY, pan.y)),
	};
}

// ============================================================================
// HIT TESTING
// ============================================================================

/**
 * Unrotate coordinates from screen orientation back to base grid orientation
 */
function unrotateXY(
	rx: number,
	ry: number,
	W: number,
	L: number,
	o: Orientation
): { x: number; y: number } {
	// Inverse of rotXY
	switch (o) {
		case 0:
			return { x: rx, y: ry };
		case 1:
			return { x: W - 1 - ry, y: rx };
		case 2:
			return { x: W - 1 - rx, y: L - 1 - ry };
		case 3:
			return { x: ry, y: L - 1 - rx };
	}
}

/**
 * Convert screen coordinates to isometric grid coordinates
 */
function screenToIso(
	screenX: number,
	screenY: number
): { isoX: number; isoY: number } {
	// Reverse of isoToScreen
	const isoX = (screenX / (TILE_W / 2) + screenY / (TILE_H / 2)) / 2;
	const isoY = (screenY / (TILE_H / 2) - screenX / (TILE_W / 2)) / 2;
	return { isoX, isoY };
}

/**
 * Check if a point is inside an isometric diamond tile
 */
export function isPointInDiamond(
	px: number,
	py: number,
	cx: number,
	cy: number
): boolean {
	const halfW = TILE_W / 2;
	const halfH = TILE_H / 2;

	// Diamond inequality: dx/halfW + dy/halfH <= 1
	const dx = Math.abs(px - cx);
	const dy = Math.abs(py - cy);

	return dx / halfW + dy / halfH <= 1;
}

const SEARCH_RADIUS = Math.ceil((MAX_HEIGHT * V_SCALE) / TILE_H) + 1;

/**
 * Hit test a screen position against the terrain grid (height-aware)
 * Checks all candidates and returns the one with highest depth (frontmost/topmost)
 */
export function screenToTile(
	screenX: number,
	screenY: number,
	centerX: number,
	centerY: number,
	panX: number,
	panY: number,
	scale: number,
	width: number,
	length: number,
	orientation: Orientation,
	heightMap?: number[][]
): { x: number; y: number } | null {
	// Convert screen coords to world coords
	const worldX = (screenX - (centerX + panX)) / scale;
	const worldY = (screenY - (centerY + panY)) / scale;

	// Get rough estimate
	const { isoX, isoY } = screenToIso(worldX, worldY);
	const { x, y } = unrotateXY(isoX, isoY, width, length, orientation);
	const roughX = Math.floor(x);
	const roughY = Math.floor(y);

	// Collect all candidates that contain the point
	let bestCandidate: { x: number; y: number; depth: number } | null = null;

	// Check all tiles in search radius
	for (let dy = -SEARCH_RADIUS; dy <= SEARCH_RADIUS; dy++) {
		for (let dx = -SEARCH_RADIUS; dx <= SEARCH_RADIUS; dx++) {
			const checkX = roughX + dx;
			const checkY = roughY + dy;

			// Bounds check
			if (checkX < 0 || checkX >= width || checkY < 0 || checkY >= length)
				continue;

			const h = heightMap?.[checkY]?.[checkX] ?? 0;
			const { rx, ry } = rotXY(checkX, checkY, width, length, orientation);
			const { cx, cy } = isoToScreen(rx, ry, h);

			if (isPointInDiamond(worldX, worldY, cx, cy)) {
				const depth = rx + ry + h * 0.01;

				// Keep the candidate with highest depth (most forward/topmost)
				if (!bestCandidate || depth > bestCandidate.depth) {
					bestCandidate = { x: checkX, y: checkY, depth };
				}
			}
		}
	}

	return bestCandidate ? { x: bestCandidate.x, y: bestCandidate.y } : null;
}

/**
 * Find tile index from grid coordinates
 */
export function getTileIndex(x: number, y: number, width: number): number {
	return y * width + x;
}

// ============================================================================
// ACTOR HIT TESTING
// ============================================================================

export interface ActorHitCandidate {
	id: string;
	kind: "character" | "entity";
	x: number;
	y: number;
	h: number;
	moveSpeed: number;
	size: ActorSize; // Now using the imported type
	cx: number; // screen position
	cy: number; // screen position
	depth: number; // for sorting (higher = more forward)
}

/**
 * Check if a point is inside a token's bounding box
 * Tokens are rendered as rounded rectangles centered at (cx, cy - TOKEN_H * 0.75)
 */
export function isPointInToken(
	px: number,
	py: number,
	tokenCx: number,
	tokenCy: number,
	size: ActorSize = "small"
): boolean {
	const {
		width: TOKEN_W_SCALED,
		height: TOKEN_H_SCALED,
		cornerRadius,
	} = getTokenDimensions(size);

	const halfW = TOKEN_W_SCALED / 2;
	const halfH = TOKEN_H_SCALED / 2;

	// Token is centered at -0.75 * TOKEN_H (matching MASK_CENTER_Y in Token.tsx)
	const centerY = tokenCy - TOKEN_H_SCALED * 0.75;

	// Relative position from token center
	const dx = px - tokenCx;
	const dy = py - centerY;

	// Quick rejection test - outside bounding box
	if (Math.abs(dx) > halfW || Math.abs(dy) > halfH) {
		return false;
	}

	// Rounded rectangle hit test:
	// Check if point is in the center rectangles (non-rounded areas)
	const innerX = halfW - cornerRadius;
	const innerY = halfH - cornerRadius;

	// Inside horizontal center strip
	if (Math.abs(dy) <= innerY) {
		return Math.abs(dx) <= halfW;
	}

	// Inside vertical center strip
	if (Math.abs(dx) <= innerX) {
		return Math.abs(dy) <= halfH;
	}

	// In corner region - check distance to corner circle center
	const cornerCenterX = dx > 0 ? innerX : -innerX;
	const cornerCenterY = dy > 0 ? innerY : -innerY;
	const distSq = (dx - cornerCenterX) ** 2 + (dy - cornerCenterY) ** 2;

	return distSq <= cornerRadius ** 2;
}

/**
 * Hit test all actors and return the one clicked (prioritizing higher depth)
 */
export function screenToActor(
	screenX: number,
	screenY: number,
	centerX: number,
	centerY: number,
	panX: number,
	panY: number,
	scale: number,
	actors: ActorHitCandidate[]
): ActorHitCandidate | null {
	// Convert screen coords to world coords
	const worldX = (screenX - (centerX + panX)) / scale;
	const worldY = (screenY - (centerY + panY)) / scale;

	// Find all actors that contain the point
	let bestActor: ActorHitCandidate | null = null;

	for (const actor of actors) {
		if (isPointInToken(worldX, worldY, actor.cx, actor.cy, actor.size)) {
			// Keep the actor with highest depth (most forward/topmost)
			if (!bestActor || actor.depth > bestActor.depth) {
				bestActor = actor;
			}
		}
	}

	return bestActor;
}

/**
 * Build actor hit candidates from characters and entities
 */
export function buildActorHitCandidates(
	characters: Character[],
	entities: Entity[],
	terrain: { Width: number; Length: number; HeightMap: number[][] },
	orientation: Orientation,
	animationState: AnimationState | null
): ActorHitCandidate[] {
	const W = terrain.Width;
	const L = terrain.Length;
	const hmap = terrain.HeightMap || [];

	const fromO = animationState ? animationState.from : orientation;
	const toO = animationState ? animationState.to : orientation;
	const tNorm = animationState ? easeInOut(animationState.t) : 1;

	const candidates: ActorHitCandidate[] = [];

	const addActor = (
		id: string,
		kind: "character" | "entity",
		x: number,
		y: number,
		h: number,
		moveSpeed: number,
		size: ActorSize = "small"
	) => {
		if (x < 0 || x >= W || y < 0 || y >= L) return;

		const tileH = (hmap[y]?.[x] ?? 0) | 0;

		// Project from/to positions
		const rf = rotXY(x, y, W, L, fromO);
		const rt = rotXY(x, y, W, L, toO);

		const sf = isoToScreen(rf.rx, rf.ry, h);
		const st = isoToScreen(rt.rx, rt.ry, h);
		const cx = sf.cx * (1 - tNorm) + st.cx * tNorm;
		const cy = sf.cy * (1 - tNorm) + st.cy * tNorm;

		const s = rt.rx + rt.ry;
		const depth = s * 1000 + tileH * 10 + (h - tileH);

		candidates.push({
			id,
			kind,
			x,
			y,
			h,
			moveSpeed,
			size,
			cx,
			cy,
			depth,
		});
	};

	for (const c of characters ?? []) {
		const { x, y, h } = c.Position ?? { x: 0, y: 0, h: 0 };
		addActor(
			c.Id,
			"character",
			x,
			y,
			h ?? 0,
			c.MoveSpeed ?? 5,
			c.Size ?? "small"
		);
	}

	for (const e of entities ?? []) {
		const pos = (e as any).Position ?? { x: 0, y: 0, h: 0 };
		addActor(
			e.Id,
			"entity",
			pos.x,
			pos.y,
			pos.h ?? 0,
			e.MoveSpeed ?? 5,
			e.Size ?? "small"
		);
	}

	return candidates;
}

// ============================================================================
// MOVEMENT RANGE CALCULATION
// ============================================================================

// MapUtilities.ts

// NEW: helpers
export function maxManhattanDistance(terrainWidth: number, terrainLength: number): number {
  return Math.max(0, (terrainWidth - 1) + (terrainLength - 1));
}

export function clampMoveTiles(
  moveSpeed: number | undefined | null,
  terrainWidth: number,
  terrainLength: number
): number {
  const raw = Math.floor(Number(moveSpeed) || 0);
  const safe = Math.max(0, raw);
  const cap = maxManhattanDistance(terrainWidth, terrainLength);
  return Math.min(safe, cap);
}

/**
 * Calculate all tiles within manhattan distance of a position
 * Returns array of {x, y} coordinates
 */
export function calculateMovementRange(
  fromX: number,
  fromY: number,
  moveSpeed: number,
  terrainWidth: number,
  terrainLength: number
): Array<{ x: number; y: number }> {
  // Hard clamp to what's actually reachable on this board.
  const maxDistance = clampMoveTiles(moveSpeed, terrainWidth, terrainLength);

  // Nothing to do? Return at least the origin tile (matches prior behavior)
  if (maxDistance <= 0) {
    // NOTE: if you prefer "no highlight at all", return [] instead.
    return [{ x: fromX, y: fromY }];
  }

  const range: Array<{ x: number; y: number }> = [];

  // Tighten the scan window to the board to avoid wasted iterations.
  const minDx = Math.max(-maxDistance, -fromX);
  const maxDx = Math.min( maxDistance, (terrainWidth  - 1) - fromX);
  const minDy = Math.max(-maxDistance, -fromY);
  const maxDy = Math.min( maxDistance, (terrainLength - 1) - fromY);

  for (let dy = minDy; dy <= maxDy; dy++) {
    for (let dx = minDx; dx <= maxDx; dx++) {
      const distance = Math.abs(dx) + Math.abs(dy);
      if (distance <= maxDistance) {
        range.push({ x: fromX + dx, y: fromY + dy });
      }
    }
  }

  return range;
}

export function findActor(
	actorId: string,
	kind: "character" | "entity" | undefined,
	characters: Character[],
	entities: Entity[]
): Character | Entity | null {
	// Optimized path: search only the specified array
	if (kind === "character") {
		return characters.find((c) => c.Id === actorId) ?? null;
	}
	if (kind === "entity") {
		return entities.find((e) => e.Id === actorId) ?? null;
	}

	// Fallback: search both arrays when kind is unknown
	// Characters first (arbitrary choice, both are equally valid)
	return (
		characters.find((c) => c.Id === actorId) ??
		entities.find((e) => e.Id === actorId) ??
		null
	);
}
