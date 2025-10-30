// components/Map/MapWorldLayer.tsx
// Interleaved terrain + actors by diagonal rows (rx+ry), with a top ghost pass.

import { useMemo } from "react";
import type { Graphics as PixiGraphics } from "pixi.js";
import type { Terrain } from "../../domains/Terrain/Terrain";
import type { Character } from "../../domains/Character/Character";
import type { Entity } from "../../domains/Entity/Entity";
import {
	type Orientation,
	type AnimationState,
	BaseTile,
	Projected,
	screenEastNeighbor,
	screenSouthNeighbor,
	mulColor,
	isoToScreen,
	rotXY,
	easeInOut,
} from "./MapUtilities";
import { Token, MAIN_ALPHA, GHOST_ALPHA } from "./Token";
import {
	RANGE_COLOR,
	HOVER_COLOR,
	ELEV_TOP_STRENGTH,
	ELEV_SIDE_STRENGTH,
	EAST_FACE_MULTIPLIER,
	SOUTH_FACE_MULTIPLIER,
	TILE_STROKE_WIDTH,
	TILE_STROKE_ALPHA,
	EAST_FACE_STROKE_ALPHA,
	SOUTH_FACE_STROKE_ALPHA,
	HOVER_OUTLINE_WIDTH,
	RANGE_OUTLINE_WIDTH,
	HIGHLIGHT_ALPHA,
	HIGHLIGHT_MITER_LIMIT,
	normalizeHeight,
	applyElevationTint,
	getDiamondCorners,
	getInsetDiamondCorners,
	V_SCALE,
	TILE_W,
	TILE_H,
} from "./Terrain";

// ----------------------- Types -------------------------------
type Kind = "character" | "entity";
interface ActorView {
	id: string;
	kind: Kind;
	name: string;
	imageId?: string;
	size: "small" | "medium" | "large";
	x: number;
	y: number;
	h: number; // actor elevation (tile levels)
	tileH: number; // tile elevation under feet

	// projected positions
	cx: number;
	cy: number;
	scx: number; // shadow cx (grounded)
	scy: number; // shadow cy (grounded)

	// rotated grid (for row grouping)
	rx: number;
	ry: number;

	depth: number; // tie-break within same row
	selected: boolean;
}

// -------------------- Component Props ------------------------------
export interface MapWorldLayerProps {
	terrain: Terrain | undefined | null;
	baseTiles: BaseTile[];
	currentProjections: Projected[];
	orientation: Orientation;
	animationState: AnimationState | null;
	characters: Character[];
	entities: Entity[];
	selectedActorId?: string;
	getActorPosition: (
		actorId: string,
		actualPosition: { x: number; y: number; h: number }
	) => {
		x: number;
		y: number;
		h: number;
		isAnimating: boolean;
	};
	movementRangeIndices?: Set<number>;
	hoveredIndex?: number | null;
}

export function MapWorldLayer({
	terrain,
	baseTiles,
	currentProjections,
	orientation,
	animationState,
	characters,
	entities,
	selectedActorId,
	getActorPosition,
	movementRangeIndices,
	hoveredIndex,
}: MapWorldLayerProps) {
	if (!terrain || baseTiles.length === 0 || currentProjections.length === 0)
		return null;

	const W = terrain.Width;
	const L = terrain.Length;
	const hmap = terrain.HeightMap || [];

	const tNorm = animationState ? easeInOut(animationState.t) : 1;
	const fromO = animationState ? animationState.from : orientation;
	const toO = animationState ? animationState.to : orientation;

	// Pick face orientation to keep faces stable mid-tween
	const faceOrient: Orientation = animationState
		? animationState.t < 0.5
			? animationState.from
			: animationState.to
		: orientation;

	// ---------------- Tiles grouped by diagonal row (rx+ry) ----------------
	const rows = useMemo(() => {
		const maxS = W - 1 + (L - 1);
		const g: number[][] = Array.from({ length: maxS + 1 }, () => []);
		for (let i = 0; i < baseTiles.length; i++) {
			const p = currentProjections[i];
			const s = p.rx + p.ry;
			g[s].push(i);
		}
		// Stable per-row order
		for (const arr of g) {
			arr.sort((ia, ib) => {
				const a = currentProjections[ia];
				const b = currentProjections[ib];
				if (a.rx !== b.rx) return a.rx - b.rx;
				if (a.ry !== b.ry) return a.ry - b.ry;
				return baseTiles[ia].h - baseTiles[ib].h;
			});
		}
		return g;
	}, [baseTiles, currentProjections, W, L]);

	// --------------- Actors projected + grouped by diagonal -----------------
	const actorsByRow = useMemo(() => {
		const maxS = W - 1 + (L - 1);
		const g: ActorView[][] = Array.from({ length: maxS + 1 }, () => []);

		const pushActor = (
			id: string,
			kind: Kind,
			name: string,
			imageId: string | undefined,
			size: "small" | "medium" | "large",
			x: number,
			y: number,
			h: number
		) => {
			const animatedPos = getActorPosition(id, { x, y, h });
			const ax = animatedPos.x;
			const ay = animatedPos.y;
			const ah = animatedPos.h;

			if (ax < 0 || ax >= W || ay < 0 || ay >= L) return;

			const tileH = (hmap[Math.floor(ay)]?.[Math.floor(ax)] ?? 0) | 0;
			const selected = selectedActorId === id;

			const rf = rotXY(ax, ay, W, L, fromO);
			const rt = rotXY(ax, ay, W, L, toO);

			const sf = isoToScreen(rf.rx, rf.ry, ah);
			const st = isoToScreen(rt.rx, rt.ry, ah);
			const cx = sf.cx * (1 - tNorm) + st.cx * tNorm;
			const cy = sf.cy * (1 - tNorm) + st.cy * tNorm;

			const sSf = isoToScreen(rf.rx, rf.ry, tileH);
			const sSt = isoToScreen(rt.rx, rt.ry, tileH);
			const scx = sSf.cx * (1 - tNorm) + sSt.cx * tNorm;
			const scy = sSf.cy * (1 - tNorm) + sSt.cy * tNorm;

			const s = Math.round(rt.rx + rt.ry);
			const depth = (rt.rx + rt.ry) * 1000 + tileH * 10 + (ah - tileH);

			if (!g[s]) {
				console.warn(`Row ${s} doesn't exist, clamping to valid range`);
				return;
			}

			g[s].push({
				id,
				kind,
				name,
				imageId,
				size,
				x,
				y,
				h,
				tileH,
				cx,
				cy,
				scx,
				scy,
				rx: rt.rx,
				ry: rt.ry,
				depth,
				selected,
			});
		};

		for (const c of characters ?? []) {
			const { x, y, h } = c.Position ?? { x: 0, y: 0, h: 0 };
			pushActor(c.Id, "character", c.Name, c.Image, (c as any).Size ?? "small", x, y, h ?? 0);
		}
		for (const e of entities ?? []) {
			const pos = (e as any).Position ?? { x: 0, y: 0, h: 0 };
			pushActor(
				e.Id,
				"entity",
				(e as any).Name ?? "Entity",
				(e as any).Image,
				(e as any).Size ?? "small",
				pos.x,
				pos.y,
				pos.h ?? 0
			);
		}

		for (const arr of g) arr.sort((a, b) => a.depth - b.depth);
		return g;
	}, [
		characters,
		entities,
		W,
		L,
		hmap,
		fromO,
		toO,
		tNorm,
		selectedActorId,
		getActorPosition,
	]);

	// -------------------- Terrain row drawer (batched) ----------------------
	const makeDrawTerrainRow = (rowIndices: number[]) => (g: PixiGraphics) => {
		g.clear();
		if (rowIndices.length === 0) return;

		const halfW = TILE_W / 2;
		const halfH = TILE_H / 2;

		for (const i of rowIndices) {
			const base = baseTiles[i];
			const proj = currentProjections[i];
			const { cx, cy } = proj;
			const color = base.color;
			const hNorm = normalizeHeight(base.h);

			const corners = getDiamondCorners(cx, cy, halfW, halfH);

			// East face (right side)
			{
				const { nx, ny } = screenEastNeighbor(base.x, base.y, faceOrient);
				const nh =
					nx >= 0 && nx < W && ny >= 0 && ny < L ? hmap[ny]?.[nx] ?? 0 : 0;
				if (base.h > nh) {
					const dh = (base.h - nh) * V_SCALE;
					const sideBase = applyElevationTint(color, hNorm, ELEV_SIDE_STRENGTH);
					g.setFillStyle({ color: mulColor(sideBase, EAST_FACE_MULTIPLIER) });
					g.setStrokeStyle({
						width: TILE_STROKE_WIDTH,
						color: 0x000000,
						alpha: EAST_FACE_STROKE_ALPHA,
					});
					g.beginPath();
					g.moveTo(corners.right.x, corners.right.y);
					g.lineTo(corners.bottom.x, corners.bottom.y);
					g.lineTo(corners.bottom.x, corners.bottom.y + dh);
					g.lineTo(corners.right.x, corners.right.y + dh);
					g.closePath();
					g.fill();
					g.stroke();
				}
			}

			// South face (left side)
			{
				const { nx, ny } = screenSouthNeighbor(base.x, base.y, faceOrient);
				const nh =
					nx >= 0 && nx < W && ny >= 0 && ny < L ? hmap[ny]?.[nx] ?? 0 : 0;
				if (base.h > nh) {
					const dh = (base.h - nh) * V_SCALE;
					const sideBase = applyElevationTint(color, hNorm, ELEV_SIDE_STRENGTH);
					g.setFillStyle({ color: mulColor(sideBase, SOUTH_FACE_MULTIPLIER) });
					g.setStrokeStyle({
						width: TILE_STROKE_WIDTH,
						color: 0x000000,
						alpha: SOUTH_FACE_STROKE_ALPHA,
					});
					g.beginPath();
					g.moveTo(corners.bottom.x, corners.bottom.y);
					g.lineTo(corners.left.x, corners.left.y);
					g.lineTo(corners.left.x, corners.left.y + dh);
					g.lineTo(corners.bottom.x, corners.bottom.y + dh);
					g.closePath();
					g.fill();
					g.stroke();
				}
			}

			// Top face (diamond)
			const topBase = applyElevationTint(color, hNorm, ELEV_TOP_STRENGTH);
			g.setFillStyle({ color: topBase });
			g.setStrokeStyle({
				width: TILE_STROKE_WIDTH,
				color: 0x000000,
				alpha: TILE_STROKE_ALPHA,
			});
			g.beginPath();
			g.moveTo(corners.top.x, corners.top.y);
			g.lineTo(corners.right.x, corners.right.y);
			g.lineTo(corners.bottom.x, corners.bottom.y);
			g.lineTo(corners.left.x, corners.left.y);
			g.closePath();
			g.fill();
			g.stroke();

			// Highlight overlay (movement range or hover)
			const isHovered = hoveredIndex != null && i === hoveredIndex;
			const inRange = !!movementRangeIndices && movementRangeIndices.has(i);
			if (isHovered || inRange) {
				const outlineColor = isHovered ? HOVER_COLOR : RANGE_COLOR;
				const outlineWidth = isHovered ? HOVER_OUTLINE_WIDTH : RANGE_OUTLINE_WIDTH;
				const inset = outlineWidth / 2;
				const insetCorners = getInsetDiamondCorners(cx, cy, halfW, halfH, inset);

				g.setStrokeStyle({
					width: outlineWidth,
					color: outlineColor,
					alpha: HIGHLIGHT_ALPHA,
					miterLimit: HIGHLIGHT_MITER_LIMIT,
				});
				g.beginPath();
				g.moveTo(insetCorners.top.x, insetCorners.top.y);
				g.lineTo(insetCorners.right.x, insetCorners.right.y);
				g.lineTo(insetCorners.bottom.x, insetCorners.bottom.y);
				g.lineTo(insetCorners.left.x, insetCorners.left.y);
				g.closePath();
				g.stroke();
			}
		}
	};

	// -------------------- Shadow drawer per row (batched) -------------------
	const makeDrawShadowsRow = (rowActors: ActorView[]) => (g: PixiGraphics) => {
		g.clear();
		if (!rowActors || rowActors.length === 0) return;

		const SHADOW_SCALE_K = 0.35;
		const SHADOW_SCALE_MIN = 0.25;
		const SHADOW_ALPHA_BASE = 0.2;
		const SHADOW_ALPHA_MIN = 0.12;

		for (const a of rowActors) {
			const diff = a.h - a.tileH;
			const d = Math.max(0, diff);
			const scale = Math.max(SHADOW_SCALE_MIN, 1 / (1 + SHADOW_SCALE_K * d));
			const alpha = Math.max(SHADOW_ALPHA_MIN, SHADOW_ALPHA_BASE * scale);
			const rx = TILE_W * 0.3 * scale;
			const ry = TILE_H * 0.3 * scale;
			g.setFillStyle({ color: 0x000000, alpha });
			g.ellipse(a.scx, a.scy, rx, ry);
			g.fill();
		}
	};

	// ----------------------------- Render -----------------------------------
	return (
		<>
			{/* Per-row painter: terrain → shadows → main tokens */}
			{rows.map((tileIdxs, s) => (
				<pixiContainer key={`row-${s}`}>
					<pixiGraphics draw={makeDrawTerrainRow(tileIdxs)} />
					{!!actorsByRow[s]?.length && (
						<pixiGraphics draw={makeDrawShadowsRow(actorsByRow[s])} />
					)}
					{actorsByRow[s]?.map((a) => (
						<Token
							key={`${a.kind}:${a.id}:main`}
							imageId={a.imageId}
							cx={a.cx}
							cy={a.cy}
							alpha={MAIN_ALPHA}
							drawOutline
							selected={a.selected}
							name={a.name}
							size={a.size}
						/>
					))}
				</pixiContainer>
			))}

			{/* Ghost overlay on top*/}
			<pixiContainer>
				{actorsByRow.flat().map((a) => (
					<Token
						key={`${a.kind}:${a.id}:ghost`}
						imageId={a.imageId}
						cx={a.cx}
						cy={a.cy}
						alpha={GHOST_ALPHA}
						drawOutline
						selected={a.selected}
						name={a.name}
						size={a.size}
					/>
				))}
			</pixiContainer>
		</>
	);
}

export default MapWorldLayer;