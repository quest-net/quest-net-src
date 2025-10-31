// components/Map/Token/tokenHelpers.ts
// Helper functions for token rendering

import {
	SHADOW_SCALE_K,
	SHADOW_SCALE_MIN,
	SHADOW_ALPHA_BASE,
	SHADOW_ALPHA_MIN,
} from "./tokenConstants";
import type { Graphics as PixiGraphics } from "pixi.js";
import { TILE_W, TILE_H, V_SCALE } from "../Terrain";

/**
 * Calculate shadow scale and alpha based on height difference
 * between actor and the ground
 */
export function calculateShadowParams(heightDelta: number): {
	scale: number;
	alpha: number;
} {
	const d = Math.max(0, heightDelta);
	const scale = Math.max(SHADOW_SCALE_MIN, 1 / (1 + SHADOW_SCALE_K * d));
	const alpha = Math.max(SHADOW_ALPHA_MIN, SHADOW_ALPHA_BASE * scale);
	return { scale, alpha };
}

/**
 * Interface for actor shadow data
 */
export interface ActorShadowData {
	scx: number; // shadow center x (grounded position)
	scy: number; // shadow center y (grounded position)
	h: number; // actor height
	tileH: number; // tile height under actor
}

/**
 * Batch render shadows for multiple actors
 * Used by MapWorldLayer to render all shadows in a diagonal row at once
 */
export function drawActorShadows(
	g: PixiGraphics,
	actors: ActorShadowData[]
): void {
	g.clear();
	if (!actors || actors.length === 0) return;

	for (const actor of actors) {
		const heightDelta = actor.h - actor.tileH;
		const { scale, alpha } = calculateShadowParams(heightDelta);

		const rx = TILE_W * 0.3 * scale;
		const ry = TILE_H * 0.3 * scale;

		g.setFillStyle({ color: 0x000000, alpha });
		g.ellipse(actor.scx, actor.scy, rx, ry);
		g.fill();
	}
}

/**
 * Create a draw callback for batch shadow rendering
 * Returns a function compatible with PixiJS Graphics draw prop
 */
export function makeDrawShadowsCallback(actors: ActorShadowData[]) {
	return (g: PixiGraphics) => drawActorShadows(g, actors);
}
/**
 * Batch render elevation indicators for elevated actors
 * Draws dotted lines from ground to elevated position
 */
export function drawElevationIndicators(
	g: PixiGraphics,
	actors: ActorShadowData[]
): void {
	g.clear();
	if (!actors || actors.length === 0) return;

	for (const actor of actors) {
		const heightDelta = actor.h + 1 - actor.tileH;

		// Only draw indicator if actor is elevated
		if (heightDelta <= 1.1) continue;

		// Style: thin, subtle dotted line
		g.setStrokeStyle({
			width: 1,
			color: 0x000000,
			alpha: 0.35,
		});

		const segmentLength = 4;
		const gapLength = 3;
		const patternLength = segmentLength + gapLength;

		let currentY = actor.scy;
		const targetY = actor.scy - heightDelta * V_SCALE;
		const dy = targetY - currentY;
		const totalDist = Math.abs(dy);
		let distanceCovered = 0;

		g.beginPath();
		while (distanceCovered < totalDist) {
			const segStart = currentY - distanceCovered;
			const segEnd = Math.max(targetY, segStart - segmentLength);

			g.moveTo(actor.scx, segStart);
			g.lineTo(actor.scx, segEnd);

			distanceCovered += patternLength;
		}
		g.stroke();
	}
}

/**
 * Create a draw callback for batch elevation indicator rendering
 */
export function makeDrawElevationIndicatorsCallback(actors: ActorShadowData[]) {
	return (g: PixiGraphics) => drawElevationIndicators(g, actors);
}