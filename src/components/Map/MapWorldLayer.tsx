// components/Map/MapWorldLayer.tsx
// Interleaved terrain + actors by diagonal rows (rx+ry), with a top ghost pass.

import { useMemo } from "react";
import type { Graphics as PixiGraphics } from "pixi.js";
import type { Terrain } from "../../domains/Terrain/Terrain";
import type { Character } from "../../domains/Character/Character";
import type { Entity } from "../../domains/Entity/Entity";
import type { ActorSize } from "../../domains/Actor/Actor";
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
import { PING_DURATION_MS } from "../../domains/Ping/Ping";
import type { ActivePing } from "./hooks/useActivePings";
import {
	Token,
	MAIN_ALPHA,
	GHOST_ALPHA,
	makeDrawShadowsCallback,
	makeDrawElevationIndicatorsCallback,
} from "./Token";
import {
	RANGE_COLOR,
	REMAINING_COLOR,
	HOVER_COLOR,
	ELEV_TOP_STRENGTH,
	ELEV_SIDE_STRENGTH,
	EAST_FACE_MULTIPLIER,
	SOUTH_FACE_MULTIPLIER,
	SURFACE_EDGE_ALPHA,
	SURFACE_EDGE_WIDTH,
	WALL_END_STROKE_ALPHA,
	WALL_END_STROKE_WIDTH,
	SURFACE_VARIATION_STRENGTH,
	HOVER_OUTLINE_WIDTH,
	RANGE_OUTLINE_WIDTH,
	HIGHLIGHT_ALPHA,
	HIGHLIGHT_MITER_LIMIT,
	normalizeHeight,
	applyElevationTint,
	lerpColor,
	getDiamondCorners,
	getInsetDiamondCorners,
	V_SCALE,
	TILE_W,
	TILE_H,
} from "./Terrain";
import { Ladder, type LadderInfo } from "./Ladder";

// ----------------------- Types -------------------------------
type Kind = "character" | "entity";
interface ActorView {
	id: string;
	kind: Kind;
	name: string;
	imageId?: string;
	size: ActorSize; // Now using the imported type
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

type SurfaceEdge = "topRight" | "rightBottom" | "bottomLeft" | "leftTop";
type SideFace = "east" | "south";

interface HeightSpan {
	bottom: number;
	top: number;
}

const SURFACE_EDGES: SurfaceEdge[] = [
	"topRight",
	"rightBottom",
	"bottomLeft",
	"leftTop",
];

function screenNeighborForEdge(
	x: number,
	y: number,
	edge: SurfaceEdge,
	o: Orientation
): { nx: number; ny: number } {
	switch (edge) {
		case "rightBottom":
			return screenEastNeighbor(x, y, o);
		case "bottomLeft":
			return screenSouthNeighbor(x, y, o);
		case "leftTop":
			switch (o) {
				case 0:
					return { nx: x - 1, ny: y };
				case 1:
					return { nx: x, ny: y - 1 };
				case 2:
					return { nx: x + 1, ny: y };
				case 3:
					return { nx: x, ny: y + 1 };
			}
		case "topRight":
			switch (o) {
				case 0:
					return { nx: x, ny: y - 1 };
				case 1:
					return { nx: x + 1, ny: y };
				case 2:
					return { nx: x, ny: y + 1 };
				case 3:
					return { nx: x - 1, ny: y };
			}
	}
}

function screenWestNeighbor(
	x: number,
	y: number,
	o: Orientation
): { nx: number; ny: number } {
	switch (o) {
		case 0:
			return { nx: x - 1, ny: y };
		case 1:
			return { nx: x, ny: y - 1 };
		case 2:
			return { nx: x + 1, ny: y };
		case 3:
			return { nx: x, ny: y + 1 };
	}
}

function screenNorthNeighbor(
	x: number,
	y: number,
	o: Orientation
): { nx: number; ny: number } {
	switch (o) {
		case 0:
			return { nx: x, ny: y - 1 };
		case 1:
			return { nx: x + 1, ny: y };
		case 2:
			return { nx: x, ny: y + 1 };
		case 3:
			return { nx: x - 1, ny: y };
	}
}

function deterministicNoise(x: number, y: number): number {
	const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
	return (n - Math.floor(n)) * 2 - 1;
}

function applySurfaceVariation(
	color: number,
	x: number,
	y: number
): number {
	const noise = deterministicNoise(x, y);
	const target = noise >= 0 ? 0xffffff : 0x000000;
	return lerpColor(
		color,
		target,
		Math.abs(noise) * SURFACE_VARIATION_STRENGTH
	);
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
	/** Subset of movementRangeIndices: tiles reachable with the remaining movement budget (cyan). */
	remainingRangeIndices?: Set<number>;
	hoveredIndex?: number | null;
	ladderInfo?: LadderInfo | null;
	hoveredLadderHeight?: number | null;
	activeStickers?: Map<string, string>;
	activePings?: ActivePing[];
	pingNow?: number;
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
	remainingRangeIndices,
	hoveredIndex,
	ladderInfo,
	hoveredLadderHeight,
	activeStickers,
	activePings,
	pingNow,
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
			size: ActorSize,
			x: number,
			y: number,
			h: number
		) => {
			const animatedPos = getActorPosition(id, { x, y, h });
			const ax = animatedPos.x;
			const ay = animatedPos.y;
			const ah = animatedPos.h;

			if (ax < 0 || ax >= W || ay < 0 || ay >= L) return;

			const tileH = (hmap[Math.round(ay)]?.[Math.round(ax)] ?? 0) | 0;
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
			pushActor(
				c.Id,
				"character",
				c.Name,
				c.Image,
				c.Size ?? "small",
				x,
				y,
				h ?? 0
			);
		}
		for (const e of entities ?? []) {
			const pos = e.Position ?? { x: 0, y: 0, h: 0 };
			pushActor(
				e.Id,
				"entity",
				e.Name ?? "Entity",
				e.Image,
				e.Size ?? "small",
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

		const getHeight = (x: number, y: number) => hmap[y]?.[x] ?? 0;
		const isInBounds = (x: number, y: number) =>
			x >= 0 && x < W && y >= 0 && y < L;
		const getSideFaceSpan = (
			x: number,
			y: number,
			face: SideFace
		): HeightSpan | null => {
			if (!isInBounds(x, y)) return null;

			const h = getHeight(x, y);
			const { nx, ny } =
				face === "east"
					? screenEastNeighbor(x, y, faceOrient)
					: screenSouthNeighbor(x, y, faceOrient);
			const nh = isInBounds(nx, ny) ? getHeight(nx, ny) : 0;

			return h > nh ? { bottom: nh, top: h } : null;
		};

		const strokeLine = (
			a: { x: number; y: number },
			b: { x: number; y: number },
			width: number,
			color: number,
			alpha: number
		) => {
			if (alpha <= 0 || width <= 0) return;
			g.setStrokeStyle({ width, color, alpha });
			g.beginPath();
			g.moveTo(a.x, a.y);
			g.lineTo(b.x, b.y);
			g.stroke();
		};

		const strokeSurfaceEdge = (
			corners: ReturnType<typeof getDiamondCorners>,
			edge: SurfaceEdge,
			color: number
		) => {
			switch (edge) {
				case "topRight":
					strokeLine(
						corners.top,
						corners.right,
						SURFACE_EDGE_WIDTH,
						color,
						SURFACE_EDGE_ALPHA
					);
					break;
				case "rightBottom":
					strokeLine(
						corners.right,
						corners.bottom,
						SURFACE_EDGE_WIDTH,
						color,
						SURFACE_EDGE_ALPHA
					);
					break;
				case "bottomLeft":
					strokeLine(
						corners.bottom,
						corners.left,
						SURFACE_EDGE_WIDTH,
						color,
						SURFACE_EDGE_ALPHA
					);
					break;
				case "leftTop":
					strokeLine(
						corners.left,
						corners.top,
						SURFACE_EDGE_WIDTH,
						color,
						SURFACE_EDGE_ALPHA
					);
					break;
			}
		};

		const strokeWallEnd = (
			point: { x: number; y: number },
			current: HeightSpan,
			coveredBy: HeightSpan | null
		) => {
			const strokeHeightRange = (bottom: number, top: number) => {
				if (top <= bottom) return;
				const yForHeight = (height: number) =>
					point.y + (current.top - height) * V_SCALE;

				strokeLine(
					{ x: point.x, y: yForHeight(top) },
					{ x: point.x, y: yForHeight(bottom) },
					WALL_END_STROKE_WIDTH,
					0x111827,
					WALL_END_STROKE_ALPHA
				);
			};

			if (!coveredBy) {
				strokeHeightRange(current.bottom, current.top);
				return;
			}

			const coveredBottom = Math.max(current.bottom, coveredBy.bottom);
			const coveredTop = Math.min(current.top, coveredBy.top);
			if (coveredTop <= coveredBottom) {
				strokeHeightRange(current.bottom, current.top);
				return;
			}

			strokeHeightRange(current.bottom, coveredBottom);
			strokeHeightRange(coveredTop, current.top);
		};

		// Pass 1: vertical faces exposed toward the camera.
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
					g.beginPath();
					g.moveTo(corners.right.x, corners.right.y);
					g.lineTo(corners.bottom.x, corners.bottom.y);
					g.lineTo(corners.bottom.x, corners.bottom.y + dh);
					g.lineTo(corners.right.x, corners.right.y + dh);
					g.closePath();
					g.fill();
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
					g.beginPath();
					g.moveTo(corners.bottom.x, corners.bottom.y);
					g.lineTo(corners.left.x, corners.left.y);
					g.lineTo(corners.left.x, corners.left.y + dh);
					g.lineTo(corners.bottom.x, corners.bottom.y + dh);
					g.closePath();
					g.fill();
				}
			}

		}

		// Pass 1b: side wall terminal edges. Adjacent wall segments with matching
		// vertical spans stay seamless; only wall ends or height discontinuities get lines.
		for (const i of rowIndices) {
			const base = baseTiles[i];
			const proj = currentProjections[i];
			const { cx, cy } = proj;
			const corners = getDiamondCorners(cx, cy, halfW, halfH);

			const eastSpan = getSideFaceSpan(base.x, base.y, "east");
			if (eastSpan) {
				const north = screenNorthNeighbor(base.x, base.y, faceOrient);
				const south = screenSouthNeighbor(base.x, base.y, faceOrient);
				strokeWallEnd(
					corners.right,
					eastSpan,
					getSideFaceSpan(north.nx, north.ny, "east")
				);
				strokeWallEnd(
					corners.bottom,
					eastSpan,
					getSideFaceSpan(south.nx, south.ny, "east")
				);
			}

			const southSpan = getSideFaceSpan(base.x, base.y, "south");
			if (southSpan) {
				const east = screenEastNeighbor(base.x, base.y, faceOrient);
				const west = screenWestNeighbor(base.x, base.y, faceOrient);
				strokeWallEnd(
					corners.bottom,
					southSpan,
					getSideFaceSpan(east.nx, east.ny, "south")
				);
				strokeWallEnd(
					corners.left,
					southSpan,
					getSideFaceSpan(west.nx, west.ny, "south")
				);
			}
		}

		// Pass 2: top surfaces. These intentionally have no universal stroke; the
		// edge pass below draws only meaningful boundaries.
		for (const i of rowIndices) {
			const base = baseTiles[i];
			const proj = currentProjections[i];
			const { cx, cy } = proj;
			const hNorm = normalizeHeight(base.h);
			const corners = getDiamondCorners(cx, cy, halfW, halfH);
			const topBase = applyElevationTint(
				applySurfaceVariation(base.color, base.x, base.y),
				hNorm,
				ELEV_TOP_STRENGTH
			);

			g.setFillStyle({ color: topBase });
			g.beginPath();
			g.moveTo(corners.top.x, corners.top.y);
			g.lineTo(corners.right.x, corners.right.y);
			g.lineTo(corners.bottom.x, corners.bottom.y);
			g.lineTo(corners.left.x, corners.left.y);
			g.closePath();
			g.fill();
		}

		// Pass 3: top surface boundaries. Same-height interior edges are skipped
		// so flat water and plains read as continuous surfaces.
		for (const i of rowIndices) {
			const base = baseTiles[i];
			const proj = currentProjections[i];
			const { cx, cy } = proj;
			const corners = getDiamondCorners(cx, cy, halfW, halfH);

			for (const edge of SURFACE_EDGES) {
				const { nx, ny } = screenNeighborForEdge(
					base.x,
					base.y,
					edge,
					faceOrient
				);

				if (!isInBounds(nx, ny)) {
					strokeSurfaceEdge(corners, edge, 0x111827);
					continue;
				}

				const neighborH = getHeight(nx, ny);
				const heightDelta = base.h - neighborH;

				if (heightDelta > 0) {
					strokeSurfaceEdge(corners, edge, 0x111827);
					continue;
				}
			}
		}

		// Pass 4: tactical overlays.
		for (const i of rowIndices) {
			const proj = currentProjections[i];
			const { cx, cy } = proj;
			// Highlight overlay (movement range or hover)
			// Priority: hover (blue thick) > remaining budget (cyan) > full range (pink)
			const isHovered = hoveredIndex != null && i === hoveredIndex;
			const inRemaining = !!remainingRangeIndices && remainingRangeIndices.has(i);
			const inFull = !!movementRangeIndices && movementRangeIndices.has(i);
			if (isHovered || inRemaining || inFull) {
				const outlineColor = isHovered
					? HOVER_COLOR
					: inRemaining
						? REMAINING_COLOR
						: RANGE_COLOR;
				const outlineWidth = isHovered
					? HOVER_OUTLINE_WIDTH
					: RANGE_OUTLINE_WIDTH;
				const inset = outlineWidth / 2;
				const insetCorners = getInsetDiamondCorners(
					cx,
					cy,
					halfW,
					halfH,
					inset
				);

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

	// ---------------------- Ping projections --------------------------------
	// Convert each active ping's tile coords into the same screen-space we
	// use for tiles/actors. We project under both the from- and to-orientations
	// and lerp by tNorm so pings track tiles correctly during a rotation.
	const projectedPings = useMemo(() => {
		if (!activePings || activePings.length === 0) return [];
		const nowTs = pingNow ?? Date.now();
		const result: Array<{
			id: string;
			cx: number;
			cy: number;
			age: number;
		}> = [];
		for (const p of activePings) {
			if (p.x < 0 || p.x >= W || p.y < 0 || p.y >= L) continue;
			const tileH = (hmap[p.y]?.[p.x] ?? 0) | 0;
			const rf = rotXY(p.x, p.y, W, L, fromO);
			const rt = rotXY(p.x, p.y, W, L, toO);
			const sf = isoToScreen(rf.rx, rf.ry, tileH);
			const st = isoToScreen(rt.rx, rt.ry, tileH);
			const cx = sf.cx * (1 - tNorm) + st.cx * tNorm;
			const cy = sf.cy * (1 - tNorm) + st.cy * tNorm;
			const age = Math.max(
				0,
				Math.min(PING_DURATION_MS, nowTs - p.timestamp)
			);
			result.push({ id: p.id, cx, cy, age });
		}
		return result;
	}, [activePings, pingNow, W, L, hmap, fromO, toO, tNorm]);

	// ----------------------------- Render -----------------------------------
	return (
		<>
			{/* Per-row painter: terrain → shadows → ladder → main tokens */}
			{rows.map((tileIdxs, s) => (
				<pixiContainer key={`row-${s}`}>
					<pixiGraphics draw={makeDrawTerrainRow(tileIdxs)} />
					{!!actorsByRow[s]?.length && (
						<pixiGraphics draw={makeDrawShadowsCallback(actorsByRow[s])} />
					)}
					{/* Add elevation indicators after shadows, before ladder */}
					{!!actorsByRow[s]?.length && (
						<pixiGraphics
							draw={makeDrawElevationIndicatorsCallback(actorsByRow[s])}
						/>
					)}
					{ladderInfo && s === ladderInfo.rowS && (
						<Ladder
							ladderInfo={ladderInfo}
							hoveredHeight={hoveredLadderHeight}
						/>
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
							sticker={activeStickers?.get(a.id)}
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
						sticker={activeStickers?.get(a.id)}
					/>
				))}
			</pixiContainer>

			{/* Active pings — pulsing tile + bouncing arrow above it.
			    Rendered last so they sit on top of every actor and terrain. */}
			{projectedPings.length > 0 && (
				<pixiContainer>
					{projectedPings.map((p) => (
						<PingMark key={p.id} cx={p.cx} cy={p.cy} age={p.age} />
					))}
				</pixiContainer>
			)}
		</>
	);
}

// ----------------------------------------------------------------------------
// PingMark — single ping's diamond pulse + bouncing arrow above the tile.
// ----------------------------------------------------------------------------

const PING_COLOR = 0x22d3ee; // cyan-400 — matches LogDisplay ping color
const PING_FILL_ALPHA = 0.18;
const PING_OUTLINE_BASE_ALPHA = 0.85;
const PING_OUTLINE_WIDTH = 4;
const PING_PULSE_PERIOD_MS = 700; // one full pulse expand-and-contract
const PING_BOUNCE_PERIOD_MS = 600; // arrow bounce period
const PING_BOUNCE_AMPLITUDE = 10; // px of vertical bounce
const PING_ARROW_BASE_OFFSET = -TILE_H * 1.4; // arrow sits this far above the tile center
const PING_ARROW_SIZE = 44;
const PING_ARROW = "🡇"; // U+1F847 — plain glyph (not an emoji), so the
//                          fill color below actually applies.
const PING_ARROW_FILL = "#67e8f9"; // cyan-300 — matches the diamond family
const PING_ARROW_STROKE = "#0e7490"; // cyan-700 — darker outline for contrast

interface PingMarkProps {
	cx: number;
	cy: number;
	age: number; // 0..PING_DURATION_MS
}

function PingMark({ cx, cy, age }: PingMarkProps) {
	const progress = age / PING_DURATION_MS;
	// Fade: hold full opacity for the first ~60%, then ease out.
	const fade =
		progress < 0.6 ? 1 : Math.max(0, 1 - (progress - 0.6) / 0.4);

	// Pulse: smooth scale that grows from 1.0 to 1.45 and back to 1.0.
	// Uses (1 - cos) so the pulse starts at 1.0 (not mid-cycle) and feels punchy.
	const pulsePhase =
		(age % PING_PULSE_PERIOD_MS) / PING_PULSE_PERIOD_MS; // 0..1
	const pulse = 1 + 0.45 * (0.5 - 0.5 * Math.cos(pulsePhase * Math.PI * 2));

	// Bounce: arrow bobs up and down above the tile.
	const bouncePhase =
		(age % PING_BOUNCE_PERIOD_MS) / PING_BOUNCE_PERIOD_MS; // 0..1
	const bounce =
		PING_ARROW_BASE_OFFSET -
		PING_BOUNCE_AMPLITUDE * Math.abs(Math.sin(bouncePhase * Math.PI));

	const halfW = (TILE_W / 2) * pulse;
	const halfH = (TILE_H / 2) * pulse;

	const drawDiamond = (g: PixiGraphics) => {
		g.clear();
		// Translucent fill so the tile reads as highlighted.
		g.setFillStyle({ color: PING_COLOR, alpha: PING_FILL_ALPHA * fade });
		g.beginPath();
		g.moveTo(0, -halfH);
		g.lineTo(halfW, 0);
		g.lineTo(0, halfH);
		g.lineTo(-halfW, 0);
		g.closePath();
		g.fill();

		// Bright outline that pulses with the diamond.
		g.setStrokeStyle({
			width: PING_OUTLINE_WIDTH,
			color: PING_COLOR,
			alpha: PING_OUTLINE_BASE_ALPHA * fade,
		});
		g.beginPath();
		g.moveTo(0, -halfH);
		g.lineTo(halfW, 0);
		g.lineTo(0, halfH);
		g.lineTo(-halfW, 0);
		g.closePath();
		g.stroke();
	};

	return (
		<pixiContainer x={cx} y={cy}>
			<pixiGraphics draw={drawDiamond} />
			<pixiText
				text={PING_ARROW}
				x={0}
				y={bounce}
				anchor={0.5}
				alpha={fade}
				style={{
					fontSize: PING_ARROW_SIZE,
					fontWeight: "bold",
					fill: PING_ARROW_FILL,
					stroke: { color: PING_ARROW_STROKE, width: 5, join: "round" },
				}}
			/>
		</pixiContainer>
	);
}

export default MapWorldLayer;
