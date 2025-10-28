// components/Map/MapWorldLayer.tsx
// Interleaved terrain + actors by diagonal rows (rx+ry), with a top ghost pass.
//
// Usage (next step): replace MapTerrainLayer + MapActorLayer with <MapWorldLayer .../>
// Keep MapHighlightLayer on top unchanged.
//
// Notes:
// - Terrain per row is batched in a single Graphics for better perf.
// - Shadows always render; nearer terrain rows naturally occlude them.
// - Main token alpha is lowered; a ghost token is drawn on top afterward.
// - Occlusion detection (diagonal scan) can be added later to conditionally
//   draw ghosts, but for now ghosts always render per your plan.

import { useMemo, useRef } from 'react';
import type { Terrain } from '../../domains/Terrain/Terrain';
import type { Character } from '../../domains/Character/Character';
import type { Entity } from '../../domains/Entity/Entity';
import {
  TILE_W,
  TILE_H,
  V_SCALE,
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
} from './MapUtilities';
import type { Graphics as PixiGraphics } from 'pixi.js';
import { SpriteDisplay } from '../../domains/Image/SpriteDisplay';

// -------------------------- Tunables --------------------------
const MAIN_ALPHA = 1.00;          // lower main token opacity
const GHOST_ALPHA = 0.15;         // ghost overlay on top (visual "sum" ≈ 100%)
const SHADOW_SCALE_K = 0.35;      // same curve as before
const SHADOW_SCALE_MIN = 0.25;
const SHADOW_ALPHA_BASE = 0.20;
const SHADOW_ALPHA_MIN = 0.12;

// Token footprint & styling
const TOKEN_W = TILE_W * 0.8;
const TOKEN_H = TILE_W * 0.8;
const CORNER_RADIUS = Math.min(TOKEN_W, TOKEN_H) * 0.45;
const OUTLINE_OUTER_WIDTH = 2;

// ------------------------ Helpers -----------------------------
function shadowParams(heightDelta: number) {
  const d = Math.max(0, heightDelta);
  const scale = Math.max(SHADOW_SCALE_MIN, 1 / (1 + SHADOW_SCALE_K * d));
  const alpha = Math.max(SHADOW_ALPHA_MIN, SHADOW_ALPHA_BASE * scale);
  return { scale, alpha };
}

function FallbackToken({ cx, cy, alpha = 1 }: { cx: number; cy: number; alpha?: number }) {
  const draw = useMemo(
    () => (g: PixiGraphics) => {
      g.clear();
      g.setFillStyle({ color: 0x4b5563, alpha: 0.95 * alpha });
      g.setStrokeStyle({ width: 2, color: 0xffffff, alpha: 0.65 * alpha });
      g.circle(cx, cy - 2, TILE_W * 0.28);
      g.fill();
      g.stroke();
    },
    [cx, cy, alpha]
  );
  return <pixiGraphics draw={draw} />;
}

function Token({
  imageId,
  cx,
  cy,
  alpha = 1,
  drawOutline = true,
}: {
  imageId?: string;
  cx: number;
  cy: number;
  alpha?: number;
  drawOutline?: boolean;
}) {
  const maskRef = useRef<PixiGraphics | null>(null);
  const rx = -TOKEN_W * 0.5;
  const ry = -TOKEN_H * 1.25;

  const drawMask = useMemo(
    () => (g: PixiGraphics) => {
      g.clear();
      g.setFillStyle({ color: 0xffffff, alpha: 1 });
      g.beginPath();
      g.roundRect(rx, ry, TOKEN_W, TOKEN_H, CORNER_RADIUS);
      g.closePath();
      g.fill();
    },
    [rx, ry]
  );

  const drawOutlinePath = useMemo(
    () => (g: PixiGraphics) => {
      g.clear();
      g.setStrokeStyle({ width: OUTLINE_OUTER_WIDTH, color: 0x323333, alpha: alpha });
      g.beginPath();
      g.roundRect(rx, ry, TOKEN_W, TOKEN_H, CORNER_RADIUS);
      g.closePath();
      g.stroke();
    },
    [rx, ry]
  );

  if (!imageId) {
    return <FallbackToken cx={cx} cy={cy} alpha={alpha} />;
  }

  return (
    <pixiContainer x={cx} y={cy}>
      <pixiGraphics ref={maskRef} draw={drawMask} />
      <pixiContainer mask={maskRef.current ?? undefined}>
        <SpriteDisplay
          imageId={imageId}
          x={0}
          y={0}
          anchor={{ x: 0.5, y: 1.0 }}
          width={TOKEN_W}
          height={TOKEN_H}
          alpha={alpha}
        />
      </pixiContainer>
      {drawOutline && <pixiGraphics draw={drawOutlinePath} />}
    </pixiContainer>
  );
}

// ----------------------- Types -------------------------------
type Kind = 'character' | 'entity';
interface ActorView {
  id: string;
  kind: Kind;
  name: string;
  imageId?: string;
  x: number;
  y: number;
  h: number;       // actor elevation (tile levels)
  tileH: number;   // tile elevation under feet

  // projected positions
  cx: number;
  cy: number;
  scx: number;     // shadow cx (grounded)
  scy: number;     // shadow cy (grounded)

  // rotated grid (for row grouping)
  rx: number;
  ry: number;

  depth: number;   // tie-break within same row
}

// -------------------- Component ------------------------------
export interface MapWorldLayerProps {
  terrain: Terrain | undefined | null;
  baseTiles: BaseTile[];
  currentProjections: Projected[];
  orientation: Orientation;
  animationState: AnimationState | null;
  characters: Character[];
  entities: Entity[];
}

export function MapWorldLayer({
  terrain,
  baseTiles,
  currentProjections,
  orientation,
  animationState,
  characters,
  entities,
}: MapWorldLayerProps) {
  if (!terrain || baseTiles.length === 0 || currentProjections.length === 0) return null;

  const W = terrain.Width;
  const L = terrain.Length;
  const hmap = terrain.HeightMap || [];

  const tNorm = animationState ? easeInOut(animationState.t) : 1;
  const fromO = animationState ? animationState.from : orientation;
  const toO   = animationState ? animationState.to   : orientation;

  // Pick face orientation (same trick you used) to keep faces stable mid-tween.
  const faceOrient: Orientation = animationState
    ? (animationState.t < 0.5 ? animationState.from : animationState.to)
    : orientation;

  // ---------------- Tiles grouped by diagonal row (rx+ry) ----------------
  const rows = useMemo(() => {
    const maxS = (W - 1) + (L - 1);
    const g: number[][] = Array.from({ length: maxS + 1 }, () => []);
    for (let i = 0; i < baseTiles.length; i++) {
      const p = currentProjections[i];
      const s = p.rx + p.ry;
      g[s].push(i);
    }
    // Stable per-row order—left to right by rx (or ry), then height
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
    const maxS = (W - 1) + (L - 1);
    const g: ActorView[][] = Array.from({ length: maxS + 1 }, () => []);

    const pushActor = (
      id: string,
      kind: Kind,
      name: string,
      imageId: string | undefined,
      x: number,
      y: number,
      h: number
    ) => {
      if (x < 0 || x >= W || y < 0 || y >= L) return;

      const tileH = (hmap[y]?.[x] ?? 0) | 0;

      // From/to projections
      const rf = rotXY(x, y, W, L, fromO);
      const rt = rotXY(x, y, W, L, toO);

      const sf = isoToScreen(rf.rx, rf.ry, h);
      const st = isoToScreen(rt.rx, rt.ry, h);
      const cx = sf.cx * (1 - tNorm) + st.cx * tNorm;
      const cy = sf.cy * (1 - tNorm) + st.cy * tNorm;

      const sSf = isoToScreen(rf.rx, rf.ry, tileH);
      const sSt = isoToScreen(rt.rx, rt.ry, tileH);
      const scx = sSf.cx * (1 - tNorm) + sSt.cx * tNorm;
      const scy = sSf.cy * (1 - tNorm) + sSt.cy * tNorm;

      const s = rt.rx + rt.ry;
      const depth = (s * 1000) + (tileH * 10) + (h - tileH);

      g[s].push({
        id, kind, name, imageId, x, y, h, tileH,
        cx, cy, scx, scy, rx: rt.rx, ry: rt.ry, depth
      });
    };

    for (const c of characters ?? []) {
      const { x, y, h } = c.Position ?? { x: 0, y: 0, h: 0 };
      pushActor(c.Id, 'character', c.Name, c.Image, x, y, h ?? 0);
    }
    for (const e of entities ?? []) {
      const pos = (e as any).Position ?? { x: 0, y: 0, h: 0 };
      pushActor(e.Id, 'entity', (e as any).Name ?? 'Entity', (e as any).Image, pos.x, pos.y, pos.h ?? 0);
    }

    // Stable order within row
    for (const arr of g) arr.sort((a, b) => a.depth - b.depth);
    return g;
  }, [characters, entities, W, L, hmap, fromO, toO, tNorm]);

  // -------------------- Terrain row drawer (batched) ----------------------
  const makeDrawTerrainRow = (rowIndices: number[]) =>
    (g: PixiGraphics) => {
      g.clear();
      if (rowIndices.length === 0) return;

      const halfW = TILE_W / 2;
      const halfH = TILE_H / 2;

      for (const i of rowIndices) {
        const base = baseTiles[i];
        const proj = currentProjections[i];
        const cx = proj.cx;
        const cy = proj.cy;
        const color = base.color;

        // Diamond corners
        const topX = cx,        topY = cy - halfH;
        const rightX = cx + halfW, rightY = cy;
        const bottomX = cx,     bottomY = cy + halfH;
        const leftX = cx - halfW,  leftY = cy;

        // East face
        {
          const { nx, ny } = screenEastNeighbor(base.x, base.y, faceOrient);
          const nh = nx >= 0 && nx < W && ny >= 0 && ny < L ? hmap[ny]?.[nx] ?? 0 : 0;
          if (base.h > nh) {
            const dh = (base.h - nh) * V_SCALE;
            g.setFillStyle({ color: mulColor(color, 0.82) });
            g.setStrokeStyle({ width: 1, color: 0x000000, alpha: 0.08 });
            g.beginPath();
            g.moveTo(rightX, rightY);
            g.lineTo(bottomX, bottomY);
            g.lineTo(bottomX, bottomY + dh);
            g.lineTo(rightX, rightY + dh);
            g.closePath();
            g.fill();
            g.stroke();
          }
        }

        // South face
        {
          const { nx, ny } = screenSouthNeighbor(base.x, base.y, faceOrient);
          const nh = nx >= 0 && nx < W && ny >= 0 && ny < L ? hmap[ny]?.[nx] ?? 0 : 0;
          if (base.h > nh) {
            const dh = (base.h - nh) * V_SCALE;
            g.setFillStyle({ color: mulColor(color, 0.68) });
            g.setStrokeStyle({ width: 1, color: 0x000000, alpha: 0.1 });
            g.beginPath();
            g.moveTo(bottomX, bottomY);
            g.lineTo(leftX, leftY);
            g.lineTo(leftX, leftY + dh);
            g.lineTo(bottomX, bottomY + dh);
            g.closePath();
            g.fill();
            g.stroke();
          }
        }

        // Top face (diamond)
        g.setFillStyle({ color });
        g.setStrokeStyle({ width: 1, color: 0x000000, alpha: 0.12 });
        g.beginPath();
        g.moveTo(topX, topY);
        g.lineTo(rightX, rightY);
        g.lineTo(bottomX, bottomY);
        g.lineTo(leftX, leftY);
        g.closePath();
        g.fill();
        g.stroke();
      }
    };

  // -------------------- Shadow drawer per row (batched) -------------------
  const makeDrawShadowsRow = (rowActors: ActorView[]) =>
    (g: PixiGraphics) => {
      g.clear();
      if (!rowActors || rowActors.length === 0) return;

      for (const a of rowActors) {
        const diff = a.h - a.tileH;
        const { scale, alpha } = shadowParams(diff);
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
          {/* Terrain batch for this row */}
          <pixiGraphics draw={makeDrawTerrainRow(tileIdxs)} />

          {/* Shadows for actors on this row */}
          {!!actorsByRow[s]?.length && (
            <pixiGraphics draw={makeDrawShadowsRow(actorsByRow[s])} />
          )}

          {/* Main tokens on this row (reduced alpha) */}
          {actorsByRow[s]?.map(a => (
            <Token
              key={`${a.kind}:${a.id}:main`}
              imageId={a.imageId}
              cx={a.cx}
              cy={a.cy}
              alpha={MAIN_ALPHA}
              // Keep outline for main token for readability
              drawOutline
            />
          ))}
        </pixiContainer>
      ))}

      {/* Ghost overlay on top (no outline, slightly higher alpha) */}
      <pixiContainer>
        {actorsByRow.flat().map(a => (
          <Token
            key={`${a.kind}:${a.id}:ghost`}
            imageId={a.imageId}
            cx={a.cx}
            cy={a.cy}
            alpha={GHOST_ALPHA}
            drawOutline={true}
          />
        ))}
      </pixiContainer>
    </>
  );
}

export default MapWorldLayer;
