// components/Map/Token/Token.tsx
// Main token component for rendering actor tokens on the map

import { useMemo } from "react";
import type { Graphics as PixiGraphics } from "pixi.js";
import { SpriteDisplay } from "../../../domains/Image/SpriteDisplay";
import { FallbackToken } from "./FallbackToken";
import {
	getTokenDimensions,
	OUTLINE_DEFAULT_COLOR,
	OUTLINE_SELECTED_COLOR,
	OUTLINE_SELECTED_WIDTH,
	OUTLINE_OUTER_WIDTH,
	type ActorSize,
} from "./tokenConstants";

interface TokenProps {
	imageId?: string;
	cx: number;
	cy: number;
	alpha?: number;
	drawOutline?: boolean;
	selected?: boolean;
	name?: string;
	size?: ActorSize;
	sticker?: string;
}

export function Token({
	imageId,
	cx,
	cy,
	alpha = 1,
	drawOutline = true,
	selected = false,
	name,
	size = "small",
	sticker,
}: TokenProps) {
	const {
		width: TOKEN_W,
		height: TOKEN_H,
		cornerRadius,
	} = getTokenDimensions(size);

	const rx = -TOKEN_W * 0.5;
	const ry = -TOKEN_H * 1.25;
	const MASK_CENTER_Y = -TOKEN_H * 0.75;
	// Position sticker above the token
	const STICKER_Y = -TOKEN_H * 2.0;

	const drawOutlinePath = useMemo(
		() => (g: PixiGraphics) => {
			g.clear();
			const outlineColor = selected
				? OUTLINE_SELECTED_COLOR
				: OUTLINE_DEFAULT_COLOR;
			const outlineWidth = selected
				? OUTLINE_SELECTED_WIDTH
				: OUTLINE_OUTER_WIDTH;
			g.setStrokeStyle({
				width: outlineWidth,
				color: outlineColor,
				alpha: alpha,
			});
			g.beginPath();
			g.roundRect(rx, ry, TOKEN_W, TOKEN_H, cornerRadius);
			g.closePath();
			g.stroke();
		},
		[rx, ry, TOKEN_W, TOKEN_H, cornerRadius, selected, alpha]
	);

	// If no image, use fallback token, but still render sticker if present (wrapper needed)
	if (!imageId) {
		return (
			<pixiContainer x={cx} y={cy}>
				<FallbackToken
					cx={0} // local coords
					cy={0}
					alpha={alpha}
					selected={selected}
					name={name}
					size={size}
				/>
				{sticker && (
					<pixiText
						text={sticker}
						x={0}
						y={STICKER_Y}
						anchor={0.5}
						style={{
							fontSize: 36,
							fill: "white",
							stroke: { color: "black", width: 4, join: "round" },
						}}
					/>
				)}
			</pixiContainer>
		);
	}

	return (
		<pixiContainer x={cx} y={cy}>
			<SpriteDisplay
				imageId={imageId}
				x={0}
				y={MASK_CENTER_Y}
				anchor={{ x: 0.5, y: 0.5 }}
				width={TOKEN_W}
				height={TOKEN_H}
				alpha={alpha}
				rounded
				cornerRadius={cornerRadius}
			/>
			{drawOutline && <pixiGraphics draw={drawOutlinePath} />}
			{sticker && (
				<pixiText
					text={sticker}
					x={0}
					y={STICKER_Y}
					anchor={0.5}
					style={{
						fontSize: 36,
						fill: "white",
						stroke: { color: "black", width: 4, join: "round" },
					}}
				/>
			)}
		</pixiContainer>
	);
}
