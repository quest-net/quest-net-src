// components/Map/Token/FallbackToken.tsx
// Fallback token component for actors without images

import { useMemo } from "react";
import type { Graphics as PixiGraphics, TextStyleOptions, TextStyleAlign } from "pixi.js";
import { TILE_W, TILE_H } from "../Terrain";
import {
	OUTLINE_OUTER_WIDTH,
	OUTLINE_DEFAULT_COLOR,
	OUTLINE_SELECTED_COLOR,
	SIZE_SCALE,
	type ActorSize,
} from "./tokenConstants";

interface FallbackTokenProps {
	cx: number;
	cy: number;
	name?: string;
	alpha?: number;
	selected?: boolean;
	size?: ActorSize;
}

export function FallbackToken({
	cx,
	cy,
	name,
	alpha = 1,
	selected = false,
	size = "small",
}: FallbackTokenProps) {
	const scale = SIZE_SCALE[size];
	const R = TILE_W * 0.35 * scale;
	const centerX = cx;
	const centerY = cy - TILE_H;

	const drawCircle = useMemo(
		() => (g: PixiGraphics) => {
			g.clear();
			// Fill
			g.setFillStyle({ color: 0x4b5563, alpha: alpha });
			// Outline
			const outlineColor = selected ? OUTLINE_SELECTED_COLOR : OUTLINE_DEFAULT_COLOR;
			const outlineWidth = selected ? 3 : OUTLINE_OUTER_WIDTH;
			g.setStrokeStyle({ width: outlineWidth, color: outlineColor, alpha });
			g.circle(centerX, centerY, R);
			g.fill();
			g.stroke();
		},
		[centerX, centerY, R, alpha, selected]
	);

	const fontSize = Math.max(10, Math.round(TILE_W * 0.22 * scale));
	const align: TextStyleAlign = "center";
	const textStyle = useMemo<TextStyleOptions>(
		() => ({
			fontSize,
			fontFamily: "Inter, system-ui, sans-serif",
			fill: 0xffffff,
			align,
			stroke: { color: 0x000000, width: 2 },
			wordWrap: true,
		}),
		[align, fontSize]
	);

	return (
		<pixiContainer>
			<pixiGraphics draw={drawCircle} />
			{!!name && (
				<pixiText
					text={name}
					x={centerX}
					y={centerY}
					anchor={{ x: 0.5, y: 0.5 }}
					style={textStyle}
					alpha={alpha}
					resolution={2}
				/>
			)}
		</pixiContainer>
	);
}