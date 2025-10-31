// components/Map/Ladder/Ladder.tsx
// Visual rendering component for actor movement ladders

import { useMemo } from "react";
import type { Graphics as PixiGraphics } from "pixi.js";
import { MAX_HEIGHT } from "../../../domains/Terrain/Terrain";
import { V_SCALE } from "../Terrain";
import { RANGE_COLOR } from "../Terrain/terrainConstants";
import { LADDER_VISUAL, LADDER_VISUAL_OFFSET } from "./ladderConstants"; // Add LADDER_VISUAL_OFFSET
import {
	isHeightVisible,
	isHeightInRange,
	type LadderInfo,
} from "./ladderHelpers";

export interface LadderProps {
	/** Complete ladder information */
	ladderInfo: LadderInfo;

	/** Height currently being hovered (if any) */
	hoveredHeight?: number | null;
}

/**
 * Renders a vertical ladder for flying actors to change altitude
 *
 * The ladder consists of:
 * - A full-height shaft from tile to max height
 * - A highlighted segment showing the actor's movement range
 * - Tick marks at each integer height
 * - A prominent tick at the hovered height (if hovering)
 */
export function Ladder({ ladderInfo, hoveredHeight }: LadderProps) {
	const drawLadder = useMemo(
		() => (g: PixiGraphics) => {
			g.clear();

			const { cx, tileHeight, cyBottom, cyTop, cyRangeBottom, cyRangeTop } =
				ladderInfo;

			// Apply vertical offset to align with token visual position
			const offsetCyBottom = cyBottom - LADDER_VISUAL_OFFSET;
			const offsetCyTop = cyTop - LADDER_VISUAL_OFFSET;
			const offsetCyRangeBottom = cyRangeBottom - LADDER_VISUAL_OFFSET;
			const offsetCyRangeTop = cyRangeTop - LADDER_VISUAL_OFFSET;

			// ========================================================================
			// SHAFT: Full vertical line from tile to max height
			// ========================================================================
			g.setStrokeStyle({
				width: LADDER_VISUAL.WIDTH,
				color: 0x000000,
				alpha: LADDER_VISUAL.OUT_RANGE_ALPHA,
			});
			g.beginPath();
			g.moveTo(cx, offsetCyBottom);
			g.lineTo(cx, offsetCyTop);
			g.stroke();

			// ========================================================================
			// RANGE HIGHLIGHT: Overlay on reachable segment
			// ========================================================================
			g.setStrokeStyle({
				width: LADDER_VISUAL.WIDTH,
				color: RANGE_COLOR,
				alpha: LADDER_VISUAL.IN_RANGE_ALPHA,
			});
			g.beginPath();
			g.moveTo(cx, offsetCyRangeBottom);
			g.lineTo(cx, offsetCyRangeTop);
			g.stroke();

			// ========================================================================
			// TICK MARKS: One for each integer height
			// ========================================================================
			const totalSteps = MAX_HEIGHT - tileHeight;

			for (let step = 0; step <= totalSteps; step++) {
				const cy = offsetCyBottom - step * V_SCALE;

				// Skip if outside visible range
				if (!isHeightVisible(offsetCyTop, offsetCyBottom, cy)) {
					continue;
				}

				// Determine if this height is within movement range
				const inRange = isHeightInRange(cy, offsetCyRangeTop, offsetCyRangeBottom);

				// Style based on range
				const color = inRange ? RANGE_COLOR : 0x000000;
				const alpha = inRange
					? LADDER_VISUAL.IN_RANGE_ALPHA
					: LADDER_VISUAL.OUT_RANGE_ALPHA;

				g.setStrokeStyle({ width: 1, color, alpha });
				g.beginPath();
				g.moveTo(cx - LADDER_VISUAL.TICK_LENGTH / 2, cy);
				g.lineTo(cx + LADDER_VISUAL.TICK_LENGTH / 2, cy);
				g.stroke();
			}

			// ========================================================================
			// HOVER TICK: Emphasized tick at hovered height
			// ========================================================================
			if (typeof hoveredHeight === "number") {
				const heightDelta = hoveredHeight - tileHeight;

				// Validate height is within valid range
				if (heightDelta >= 0 && hoveredHeight <= MAX_HEIGHT) {
					const cyHover = offsetCyBottom - heightDelta * V_SCALE;

					// Only draw if within visible ladder bounds
					if (isHeightVisible(offsetCyTop, offsetCyBottom, cyHover)) {
						g.setStrokeStyle({
							width: LADDER_VISUAL.HOVER_WIDTH,
							color: RANGE_COLOR,
							alpha: 1,
						});
						g.beginPath();
						g.moveTo(cx - LADDER_VISUAL.HOVER_TICK_LENGTH / 2, cyHover);
						g.lineTo(cx + LADDER_VISUAL.HOVER_TICK_LENGTH / 2, cyHover);
						g.stroke();
					}
				}
			}
		},
		[ladderInfo, hoveredHeight]
	);

	return <pixiGraphics draw={drawLadder} />;
}