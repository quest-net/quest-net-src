// components/Map/Ladder/ladderHelpers.ts
// Helper functions and types for ladder feature

import type { Terrain } from "../../../domains/Terrain/Terrain";
import { MAX_HEIGHT } from "../../../domains/Terrain/Terrain";
import type { Character } from "../../../domains/Character/Character";
import type { Entity } from "../../../domains/Entity/Entity";
import type { Orientation } from "../MapUtilities";
import { rotXY, isoToScreen, screenToTile, findActor } from "../MapUtilities";
import { V_SCALE } from "../Terrain";
import {
	LADDER_HIT_RADIUS,
	LADDER_VISUAL_OFFSET,
	LADDER_Y_TOLERANCE,
} from "./ladderConstants";

// ============================================================================
// TYPES
// ============================================================================

/**
 * Complete information needed to render a ladder
 */
export interface LadderInfo {
	/** Center X coordinate in world space */
	cx: number;

	/** Height of the tile under the actor */
	tileHeight: number;

	/** Actor's current height */
	actorHeight: number;

	/** Actor's movement speed (determines reachable range) */
	moveSpeed: number;

	/** Diagonal row index (for render ordering) */
	rowS: number;

	// Screen Y coordinates for different heights
	/** Bottom of ladder (at tile height) */
	cyBottom: number;

	/** Top of ladder (at MAX_HEIGHT) */
	cyTop: number;

	/** Bottom of reachable range */
	cyRangeBottom: number;

	/** Top of reachable range */
	cyRangeTop: number;
}

/**
 * Result of checking if the ladder is occluded by a front tile
 */
export interface OcclusionCheckResult {
	/** Whether the ladder is occluded */
	isOccluded: boolean;

	/** The tile that was clicked (if any) */
	clickedTile?: { x: number; y: number };
}

/**
 * Parameters for calculating ladder info
 */
export interface CalculateLadderInfoParams {
	selectedActorId: string | null;
	characters: Character[];
	entities: Entity[];
	terrain: Terrain;
	fromOrientation: Orientation;
	toOrientation: Orientation;
	tweenProgress: number; // 0-1, normalized animation progress
	getActorPosition: (
		actorId: string,
		actualPosition: { x: number; y: number; h: number }
	) => { x: number; y: number; h: number; isAnimating: boolean };
}

/**
 * Parameters for occlusion check
 */
export interface CheckOcclusionParams {
	screenX: number;
	screenY: number;
	ladderRx: number;
	ladderRy: number;
	terrain: Terrain;
	orientation: Orientation;
	centerX: number;
	centerY: number;
	panX: number;
	panY: number;
	scale: number;
}

/**
 * Parameters for ladder hit testing
 */
export interface ScreenToLadderParams {
	screenX: number;
	screenY: number;
	centerX: number;
	centerY: number;
	panX: number;
	panY: number;
	scale: number;
	terrain: Terrain;
	actorX: number;
	actorY: number;
	orientation: Orientation;
	maxHeight: number;
	visibleCyTop?: number;
	visibleCyBottom?: number;
}

// ============================================================================
// CALCULATION FUNCTIONS
// ============================================================================

/**
 * Calculate complete ladder information for a selected flying actor
 * Returns null if no ladder should be displayed
 */
export function calculateLadderInfo(
	params: CalculateLadderInfoParams
): LadderInfo | null {
	const {
		selectedActorId,
		characters,
		entities,
		terrain,
		fromOrientation,
		toOrientation,
		tweenProgress,
		getActorPosition,
	} = params;

	if (!selectedActorId || !terrain) return null;

	// Find the selected actor
	const actor = findActor(selectedActorId, undefined, characters, entities);

	// Only show ladder for flying actors
	if (!actor || !actor.CanFly) return null;

	// Get actor's animated position
	const position = getActorPosition(
		selectedActorId,
		actor.Position ?? { x: 0, y: 0, h: 0 }
	);

	const actorX = Math.floor(position.x);
	const actorY = Math.floor(position.y);
	const actorHeight = Math.round(position.h);

	// Validate position is within terrain bounds
	if (
		actorX < 0 ||
		actorX >= terrain.Width ||
		actorY < 0 ||
		actorY >= terrain.Length
	) {
		return null;
	}

	const tileHeight = (terrain.HeightMap[actorY]?.[actorX] ?? 0) | 0;

	// Calculate rotation interpolation
	const rotFrom = rotXY(
		actorX,
		actorY,
		terrain.Width,
		terrain.Length,
		fromOrientation
	);
	const rotTo = rotXY(
		actorX,
		actorY,
		terrain.Width,
		terrain.Length,
		toOrientation
	);

	const screenFrom = isoToScreen(rotFrom.rx, rotFrom.ry, 0);
	const screenTo = isoToScreen(rotTo.rx, rotTo.ry, 0);
	const cx = screenFrom.cx * (1 - tweenProgress) + screenTo.cx * tweenProgress;

	// Helper to get interpolated Y coordinate for any height
	const getInterpolatedCy = (height: number): number => {
		const cyFrom = isoToScreen(rotFrom.rx, rotFrom.ry, height);
		const cyTo = isoToScreen(rotTo.rx, rotTo.ry, height);
		return cyFrom.cy * (1 - tweenProgress) + cyTo.cy * tweenProgress;
	};

	// Calculate row index for render ordering
	const rowS = Math.round(rotTo.rx + rotTo.ry);

	// Calculate movement range
	const moveSpeed = actor.MoveSpeed ?? 0;
	const rangeBottom = Math.max(tileHeight, actorHeight - moveSpeed);
	const rangeTop = Math.min(MAX_HEIGHT, actorHeight + moveSpeed);

	return {
		cx,
		tileHeight,
		actorHeight,
		moveSpeed,
		rowS,
		cyBottom: getInterpolatedCy(tileHeight),
		cyTop: getInterpolatedCy(MAX_HEIGHT),
		cyRangeBottom: getInterpolatedCy(rangeBottom),
		cyRangeTop: getInterpolatedCy(rangeTop),
	};
}

// ============================================================================
// HIT TESTING
// ============================================================================

/**
 * Check if the ladder is occluded by a tile in front of it
 * Returns true if a front tile blocks interaction with the ladder
 */
export function checkLadderOcclusion(
	params: CheckOcclusionParams
): OcclusionCheckResult {
	const {
		screenX,
		screenY,
		ladderRx,
		ladderRy,
		terrain,
		orientation,
		centerX,
		centerY,
		panX,
		panY,
		scale,
	} = params;

	// Try to find what tile was clicked
	const clickedTile = screenToTile(
		screenX,
		screenY,
		centerX,
		centerY,
		panX,
		panY,
		scale,
		terrain.Width,
		terrain.Length,
		orientation,
		terrain.HeightMap
	);

	if (!clickedTile) {
		return { isOccluded: false };
	}

	// Calculate clicked tile's rotated coordinates
	const clickedRot = rotXY(
		clickedTile.x,
		clickedTile.y,
		terrain.Width,
		terrain.Length,
		orientation
	);

	// Calculate diagonal row indices (higher s = more forward in render order)
	const clickedS = clickedRot.rx + clickedRot.ry;
	const ladderS = ladderRx + ladderRy;

	// If clicked tile is in front of ladder, it occludes
	const isOccluded = clickedS > ladderS;

	return {
		isOccluded,
		clickedTile,
	};
}

/**
 * Convert screen coordinates to a height on the ladder
 * Returns the snapped height (integer) or null if click is not close enough
 */
export function screenToLadder(params: ScreenToLadderParams): number | null {
	const {
		screenX,
		screenY,
		centerX,
		centerY,
		panX,
		panY,
		scale,
		terrain,
		actorX,
		actorY,
		orientation,
		maxHeight,
		visibleCyTop,
		visibleCyBottom,
	} = params;

	// Convert screen to world coordinates
	const worldX = (screenX - (centerX + panX)) / scale;
	const worldY = (screenY - (centerY + panY)) / scale;

	// Get ladder position in current orientation
	const { rx, ry } = rotXY(
		actorX,
		actorY,
		terrain.Width,
		terrain.Length,
		orientation
	);
	const baseScreen = isoToScreen(rx, ry, 0);
	const ladderX = baseScreen.cx;

	// Check horizontal proximity to ladder
	if (Math.abs(worldX - ladderX) > LADDER_HIT_RADIUS) {
		return null;
	}

	// Apply visual offset to visible Y range check
	const offsetVisibleCyTop =
		visibleCyTop !== undefined
			? visibleCyTop - LADDER_VISUAL_OFFSET
			: undefined;
	const offsetVisibleCyBottom =
		visibleCyBottom !== undefined
			? visibleCyBottom - LADDER_VISUAL_OFFSET
			: undefined;

	// Check if within visible Y range (if provided), with tolerance
	if (offsetVisibleCyTop !== undefined && offsetVisibleCyBottom !== undefined) {
		const top =
			Math.min(offsetVisibleCyTop, offsetVisibleCyBottom) - LADDER_Y_TOLERANCE;
		const bottom =
			Math.max(offsetVisibleCyTop, offsetVisibleCyBottom) + LADDER_Y_TOLERANCE;
		if (worldY < top || worldY > bottom) {
			return null;
		}
	}

	// Get tile height
	const tileHeight = (terrain.HeightMap[actorY]?.[actorX] ?? 0) | 0;

	// Convert Y position to height (invert vertical axis), accounting for visual offset
	const rawHeight = (baseScreen.cy - LADDER_VISUAL_OFFSET - worldY) / V_SCALE;
	const snappedHeight = Math.round(rawHeight);

	// Clamp to valid range
	if (snappedHeight < tileHeight) return tileHeight;
	if (snappedHeight > maxHeight) return maxHeight;

	return snappedHeight;
}

/**
 * Check if a height is within the visible range of the ladder
 * Used for rendering tick marks
 */
export function isHeightVisible(
	cyTop: number,
	cyBottom: number,
	cy: number
): boolean {
	return (
		cy >= cyTop - LADDER_Y_TOLERANCE && cy <= cyBottom + LADDER_Y_TOLERANCE
	);
}

/**
 * Check if a height is within the actor's movement range
 */
export function isHeightInRange(
	cy: number,
	cyRangeTop: number,
	cyRangeBottom: number
): boolean {
	return (
		cy <= cyRangeBottom + LADDER_Y_TOLERANCE &&
		cy >= cyRangeTop - LADDER_Y_TOLERANCE
	);
}
