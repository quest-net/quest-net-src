// components/Map/Token/TokenShadow.tsx
// Shadow rendering for actor tokens

import { useMemo } from "react";
import type { Graphics as PixiGraphics } from "pixi.js";
import { TILE_W, TILE_H } from "../Terrain";
import { calculateShadowParams } from "./tokenHelpers";

interface TokenShadowProps {
	cx: number; // shadow center x (grounded position)
	cy: number; // shadow center y (grounded position)
	heightDelta: number; // difference between actor h and tile h
}

export function TokenShadow({ cx, cy, heightDelta }: TokenShadowProps) {
	const drawShadow = useMemo(
		() => (g: PixiGraphics) => {
			g.clear();
			const { scale, alpha } = calculateShadowParams(heightDelta);
			const rx = TILE_W * 0.3 * scale;
			const ry = TILE_H * 0.3 * scale;
			g.setFillStyle({ color: 0x000000, alpha });
			g.ellipse(cx, cy, rx, ry);
			g.fill();
		},
		[cx, cy, heightDelta]
	);

	return <pixiGraphics draw={drawShadow} />;
}