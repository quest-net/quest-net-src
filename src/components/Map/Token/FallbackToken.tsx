// components/Map/Token/FallbackToken.tsx
// Fallback token component for actors without images
// Uses the same rounded-rect shape and positioning as image tokens

import { useMemo } from "react";
import type {
	Graphics as PixiGraphics,
	TextStyleOptions,
	TextStyleAlign,
} from "pixi.js";
import {
	getTokenPosition,
	OUTLINE_OUTER_WIDTH,
	OUTLINE_DEFAULT_COLOR,
	OUTLINE_SELECTED_COLOR,
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
	const {
		width: TOKEN_W,
		height: TOKEN_H,
		cornerRadius,
		scale,
		rx: rxLocal,
		ry: ryLocal,
		centerY: centerYLocal,
	} = getTokenPosition(size);

	// Offset by (cx, cy) to position in parent coords
	const rx = cx + rxLocal;
	const ry = cy + ryLocal;

	const drawRect = useMemo(
		() => (g: PixiGraphics) => {
			g.clear();
			// Fill
			g.setFillStyle({ color: 0x4b5563, alpha: alpha });
			// Outline
			const outlineColor = selected
				? OUTLINE_SELECTED_COLOR
				: OUTLINE_DEFAULT_COLOR;
			const outlineWidth = selected ? 3 : OUTLINE_OUTER_WIDTH;
			g.setStrokeStyle({ width: outlineWidth, color: outlineColor, alpha });
			g.roundRect(rx, ry, TOKEN_W, TOKEN_H, cornerRadius);
			g.fill();
			g.stroke();
		},
		[rx, ry, TOKEN_W, TOKEN_H, cornerRadius, alpha, selected]
	);

	// Center the text inside the rounded rect
	const textCenterX = cx;
	const textCenterY = cy + centerYLocal;

	const fontSize = Math.max(10, Math.round(14 * scale));
	const align: TextStyleAlign = "center";
	const textStyle = useMemo<TextStyleOptions>(
		() => ({
			fontSize,
			fontFamily: "Inter, system-ui, sans-serif",
			fill: 0xffffff,
			align,
			stroke: { color: 0x000000, width: 2 },
			wordWrap: true,
			wordWrapWidth: TOKEN_W * 0.9,
		}),
		[align, fontSize, TOKEN_W]
	);

	return (
		<pixiContainer>
			<pixiGraphics draw={drawRect} />
			{!!name && (
				<pixiText
					text={name}
					x={textCenterX}
					y={textCenterY}
					anchor={{ x: 0.5, y: 0.5 }}
					style={textStyle}
					alpha={alpha}
					resolution={2}
				/>
			)}
		</pixiContainer>
	);
}
