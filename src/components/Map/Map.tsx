// Map.tsx — React 19 + @pixi/react v8
// Pan (RMB/MMB), wheel zoom, 90° rotations with a short tween, and cliff faces.

import React, {
  useMemo,
  useRef,
  useState,
  useLayoutEffect,
  useCallback,
  useEffect,
} from 'react';
import { Application, extend } from '@pixi/react';
import { Container as PixiContainer, Graphics as PixiGraphics } from 'pixi.js';

extend({ Container: PixiContainer, Graphics: PixiGraphics });

// Prop types kept to preserve existing usage
import type { Character } from '../../domains/Character/Character';
import type { Entity } from '../../domains/Entity/Entity';
import type { CombatState } from '../../domains/GameState/GameState';
import type { Scene } from '../../domains/Scene/Scene';
import type { Terrain, TerrainType } from '../../domains/Terrain/Terrain';
import { TERRAIN_COLORS } from '../../domains/Terrain/Terrain';

interface MapProps {
  characters: Character[];
  entities: Entity[];
  combatState: CombatState;
  scene: Scene;
  terrain?: Terrain | null;
}

const TILE_W = 64;    // 2:1 isometric tile width
const TILE_H = 32;    // 2:1 isometric tile height
const V_SCALE = 20;   // pixels per height unit

// ───────── helpers ─────────
function hexToNum(hex: string) {
  const h = hex.startsWith('#') ? hex.slice(1) : hex;
  return parseInt(h, 16);
}
function mulColor(rgb: number, factor: number) {
  let r = ((rgb >> 16) & 0xff) * factor;
  let g = ((rgb >> 8) & 0xff) * factor;
  let b = (rgb & 0xff) * factor;
  r = Math.max(0, Math.min(255, r));
  g = Math.max(0, Math.min(255, g));
  b = Math.max(0, Math.min(255, b));
  return ((r & 0xff) << 16) | ((g & 0xff) << 8) | (b & 0xff);
}
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

// World (x,y) → view (rx,ry) by orientation (0,1,2,3)
function rotXY(x: number, y: number, W: number, L: number, o: 0 | 1 | 2 | 3) {
  switch (o) {
    case 0: return { rx: x,             ry: y             };
    case 1: return { rx: y,             ry: W - 1 - x     }; // 90° CW
    case 2: return { rx: W - 1 - x,     ry: L - 1 - y     }; // 180°
    case 3: return { rx: L - 1 - y,     ry: x             }; // 270° CW
  }
}

// For cliff faces, which *original* neighbor is screen-East/South for a given orientation?
function screenEastNeighbor(x: number, y: number, o: 0 | 1 | 2 | 3) {
  switch (o) {
    case 0: return { nx: x + 1, ny: y     }; // east
    case 1: return { nx: x,     ny: y + 1 }; // south
    case 2: return { nx: x - 1, ny: y     }; // west
    case 3: return { nx: x,     ny: y - 1 }; // north
  }
}
function screenSouthNeighbor(x: number, y: number, o: 0 | 1 | 2 | 3) {
  switch (o) {
    case 0: return { nx: x,     ny: y + 1 }; // south
    case 1: return { nx: x - 1, ny: y     }; // west
    case 2: return { nx: x,     ny: y - 1 }; // north
    case 3: return { nx: x + 1, ny: y     }; // east
  }
}

// ───────── measured container ─────────
function useMeasuredContainer<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setSize({ w: Math.max(1, r.width), h: Math.max(1, r.height) });

    const ro = new ResizeObserver((entries) => {
      const cr = entries[0]?.contentRect;
      if (cr) setSize({ w: Math.max(1, cr.width), h: Math.max(1, cr.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return { ref, ...size };
}

// ───────── component ─────────
type BaseTile = { x: number; y: number; h: number; color: number };
type Projected = { cx: number; cy: number; rx: number; ry: number };

export default function Map({ scene, terrain }: MapProps) {
  const { ref, w, h } = useMeasuredContainer<HTMLDivElement>();
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio : 1;

  // View rotation (discrete)
  const [orientation, setOrientation] = useState<0 | 1 | 2 | 3>(0);
  const [anim, setAnim] = useState<null | { from: 0 | 1 | 2 | 3; to: 0 | 1 | 2 | 3; t: number; start: number }>(null);
  const DURATION = 180; // ms

  const startRotate = (dir: 1 | -1) => {
    const now = performance.now();
    // If mid-anim, snap base to nearest side to keep chaining smooth
    let base = orientation;
    if (anim) base = anim.t < 0.5 ? anim.from : anim.to;
    const to = ((base + (dir === 1 ? 1 : 3)) & 3) as 0 | 1 | 2 | 3;
    setOrientation(base);
    setAnim({ from: base, to, t: 0, start: now });
  };
  const rotateCW = () => startRotate(1);
  const rotateCCW = () => startRotate(-1);

  // rAF tween loop
  useEffect(() => {
    if (!anim) return;
    let raf = 0;
    const loop = () => {
      const t = Math.min(1, (performance.now() - anim.start) / DURATION);
      setAnim((prev) => (prev ? { ...prev, t } : null));
      if (t < 1) {
        raf = requestAnimationFrame(loop);
      } else {
        // commit to target orientation
        setOrientation(anim.to);
        setAnim(null);
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anim?.start]);

  // Pan & Zoom
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const panRef = useRef(pan);
  const scaleRef = useRef(scale);
  panRef.current = pan; scaleRef.current = scale;

  const [isPanning, setIsPanning] = useState(false);
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const MIN_SCALE = 0.5, MAX_SCALE = 4;

  const onWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    if (!ref.current) return;
    e.preventDefault();
    const zoomIntensity = 0.0015;
    const zoom = Math.exp(-e.deltaY * zoomIntensity);
    const newScaleUnclamped = scaleRef.current * zoom;
    const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, newScaleUnclamped));
    const actual = newScale / scaleRef.current;
    if (actual === 1) return;

    const rect = ref.current.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;

    // Keep cursor world point stable across zoom
    const cx = currentCenterX; const cy = currentCenterY;
    const worldX = (mx - (cx + panRef.current.x)) / scaleRef.current;
    const worldY = (my - (cy + panRef.current.y)) / scaleRef.current;
    const nextPanX = mx - cx - worldX * newScale;
    const nextPanY = my - cy - worldY * newScale;

    setScale(newScale);
    setPan({ x: nextPanX, y: nextPanY });
  }, /* deps filled below via vars */[]);

  const onMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 1 && e.button !== 2) return; // only MMB/RMB
    e.preventDefault();
    setIsPanning(true);
    dragStart.current = { x: e.clientX, y: e.clientY };
  }, []);
  const onMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!isPanning || !dragStart.current) return;
    const dx = e.clientX - dragStart.current.x;
    const dy = e.clientY - dragStart.current.y;
    dragStart.current = { x: e.clientX, y: e.clientY };
    setPan(p => ({ x: p.x + dx, y: p.y + dy }));
  }, [isPanning]);
  const endPan = useCallback(() => { setIsPanning(false); dragStart.current = null; }, []);

  // Build base tiles (world-space data)
  const baseTiles: BaseTile[] = useMemo(() => {
    if (!terrain) return [];
    const W = terrain.Width, L = terrain.Length;
    const hmap = terrain.HeightMap || [];
    const cmap = terrain.ColorMap || [];
    const out: BaseTile[] = [];
    for (let y = 0; y < L; y++) {
      for (let x = 0; x < W; x++) {
        const hgt = (hmap[y]?.[x] ?? 0) | 0;
        const ttype = (cmap[y]?.[x] ?? ('grey' as TerrainType));
        const color = hexToNum(TERRAIN_COLORS[ttype] ?? '#6b7280');
        out.push({ x, y, h: hgt, color });
      }
    }
    return out;
  }, [terrain]);

  // Project tiles for an orientation
  const projectFor = useCallback((o: 0 | 1 | 2 | 3): Projected[] => {
    if (!terrain) return [];
    const W = terrain.Width, L = terrain.Length;
    const arr: Projected[] = new Array(baseTiles.length);
    for (let i = 0; i < baseTiles.length; i++) {
      const t = baseTiles[i];
      const { rx, ry } = rotXY(t.x, t.y, W, L, o);
      const cx = (rx - ry) * (TILE_W / 2);
      const cy = (rx + ry) * (TILE_H / 2) - t.h * V_SCALE;
      arr[i] = { cx, cy, rx, ry };
    }
    return arr;
  }, [baseTiles, terrain]);

  // Determine from/to orientation for current frame
  const fromO: 0 | 1 | 2 | 3 = anim ? anim.from : orientation;
  const toO:   0 | 1 | 2 | 3 = anim ? anim.to : orientation;
  const tNorm = anim ? easeInOut(anim.t) : 1;

  // Precompute projections for from/to and lerp positions
  const projFrom = useMemo(() => projectFor(fromO), [projectFor, fromO]);
  const projTo   = useMemo(() => projectFor(toO),   [projectFor, toO]);

  // Sort order based on the *target* orientation (stable during tween)
  const order = useMemo(() => {
    if (!terrain) return [] as number[];
    const idxs = baseTiles.map((_, i) => i);
    idxs.sort((ia, ib) => {
      const a = projTo[ia], b = projTo[ib];
      const da = a.rx + a.ry, db = b.rx + b.ry;
      if (da !== db) return da - db;
      return baseTiles[ia].h - baseTiles[ib].h;
    });
    return idxs;
  }, [terrain, baseTiles, projTo]);

  // Lerp centers for display, compute bounds for both orientations and lerp centers
  const boundsCenter = useCallback((proj: Projected[]) => {
    const halfW = TILE_W / 2, halfH = TILE_H / 2;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < proj.length; i++) {
      const p = proj[i];
      minX = Math.min(minX, p.cx - halfW);
      maxX = Math.max(maxX, p.cx + halfW);
      minY = Math.min(minY, p.cy - halfH);
      maxY = Math.max(maxY, p.cy + halfH);
    }
    const gridW = maxX - minX, gridH = maxY - minY;
    return { cx: w / 2 - (minX + gridW / 2), cy: h / 2 - (minY + gridH / 2) };
  }, [w, h]);

  const centerFrom = useMemo(() => (projFrom.length ? boundsCenter(projFrom) : { cx: w / 2, cy: h / 2 }), [projFrom, boundsCenter, w, h]);
  const centerTo   = useMemo(() => (projTo.length   ? boundsCenter(projTo)   : { cx: w / 2, cy: h / 2 }), [projTo,   boundsCenter, w, h]);
  const currentCenterX = centerFrom.cx * (1 - tNorm) + centerTo.cx * tNorm;
  const currentCenterY = centerFrom.cy * (1 - tNorm) + centerTo.cy * tNorm;

  // Draw (cliff faces + top faces) using lerped centers
  const draw = useCallback((g: PixiGraphics) => {
    g.clear();
    if (!terrain || baseTiles.length === 0) return;

    const W = terrain.Width, L = terrain.Length;
    const hmap = terrain.HeightMap || [];
    const halfW = TILE_W / 2, halfH = TILE_H / 2;

    // Decide which orientation to use for *face selection* (swap at mid-tween)
    const faceOrient: 0 | 1 | 2 | 3 = anim ? (anim.t < 0.5 ? anim.from : anim.to) : orientation;

    for (const i of order) {
      const base = baseTiles[i];
      const pf = projFrom[i], pt = projTo[i];
      const cx = pf.cx * (1 - tNorm) + pt.cx * tNorm;
      const cy = pf.cy * (1 - tNorm) + pt.cy * tNorm;
      const color = base.color;

      const topX = cx,           topY = cy - halfH;
      const rightX = cx + halfW, rightY = cy;
      const bottomX = cx,        bottomY = cy + halfH;
      const leftX = cx - halfW,  leftY = cy;

      // EAST (screen-right) face for current face-orientation
      {
        const { nx, ny } = screenEastNeighbor(base.x, base.y, faceOrient);
        const nh = (nx >= 0 && nx < W && ny >= 0 && ny < L) ? (hmap[ny]?.[nx] ?? 0) : 0;
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

      // SOUTH (screen-bottom) face
      {
        const { nx, ny } = screenSouthNeighbor(base.x, base.y, faceOrient);
        const nh = (nx >= 0 && nx < W && ny >= 0 && ny < L) ? (hmap[ny]?.[nx] ?? 0) : 0;
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

      // Top diamond
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
  }, [terrain, baseTiles, projFrom, projTo, order, tNorm, anim, orientation]);

  const ready = w > 0 && h > 0;
  const cursorClass = isPanning ? 'cursor-grabbing' : 'cursor-default';

  return (
    <div
      ref={ref}
      className={`relative h-full w-full bg-base-200 overflow-hidden select-none ${cursorClass}`}
      onWheel={onWheel}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={endPan}
      onMouseLeave={endPan}
      onContextMenu={(e) => e.preventDefault()}
    >
      {ready && (
        <Application
          resizeTo={ref}
          antialias
          autoDensity
          resolution={dpr}
          backgroundAlpha={0}
        >
          <pixiContainer
            x={currentCenterX + pan.x}
            y={currentCenterY + pan.y}
            scale={{ x: scale, y: scale }}
          >
            <pixiGraphics draw={draw} />
          </pixiContainer>
        </Application>
      )}

      {/* UI: rotate buttons */}
      <div className="absolute left-3 top-3 z-10 flex gap-2">
        <button
          type="button"
          className="btn btn-lg rounded-md bg-base-100 shadow hover:bg-base-300"
          onClick={rotateCCW}
          title="Rotate 90° counter-clockwise"
        >
          ⟳
        </button>
        <button
          type="button"
          className="btn btn-lg rounded-md bg-base-100 shadow hover:bg-base-300"
          onClick={rotateCW}
          title="Rotate 90° clockwise"
        >
          ⟲
        </button>
      </div>

      {/* Readouts */}
      <div className="pointer-events-none absolute right-3 bottom-3 rounded-xl bg-base-100/70 px-2 py-1 text-[11px] shadow">
        <span className="opacity-70">Terrain:</span>{' '}
        <span className="font-mono">{terrain?.Name ?? '—'}</span>{' '}
        <span className="opacity-70">| Rot:</span>{' '}
        <span className="font-mono">{(anim ? anim.to : orientation) * 90}°</span>{' '}
        {anim && <span className="opacity-60">({Math.round(tNorm * 100)}%)</span>}
      </div>
    </div>
  );
}
