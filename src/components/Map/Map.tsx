// Map.tsx - React 19 + @pixi/react v8
// Isometric map with pan, zoom, smooth rotation animations, PAN LIMITS, and tile selection

import {
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

import type { Character } from '../../domains/Character/Character';
import type { Entity } from '../../domains/Entity/Entity';
import type { CombatState } from '../../domains/GameState/GameState';
import type { Scene } from '../../domains/Scene/Scene';
import type { Terrain } from '../../domains/Terrain/Terrain';

import {
  TILE_W,
  TILE_H,
  V_SCALE,
  MIN_SCALE,
  MAX_SCALE,
  type Orientation,
  type AnimationState,
  type GridBounds,
  easeInOut,
  buildBaseTiles,
  projectTiles,
  lerpProjections,
  sortTilesByDepth,
  calculateGridBounds,
  centerGridInView,
  lerpCenter,
  screenEastNeighbor,
  screenSouthNeighbor,
  mulColor,
  clampPan,
  screenToTile,
  getTileIndex,
} from './MapUtilities';

interface MapProps {
  characters: Character[];
  entities: Entity[];
  combatState: CombatState;
  scene: Scene;
  terrain?: Terrain | null;
}

const PAN_PADDING = 500;

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

export default function Map({ scene, terrain }: MapProps) {
  const { ref, w, h } = useMeasuredContainer<HTMLDivElement>();
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio : 1;

  const [orientation, setOrientation] = useState<Orientation>(0);
  const [anim, setAnim] = useState<AnimationState | null>(null);
  const DURATION = 180;

  const startRotate = (dir: 1 | -1) => {
    const now = performance.now();
    let base = orientation;
    if (anim) base = anim.t < 0.5 ? anim.from : anim.to;
    const to = ((base + (dir === 1 ? 1 : 3)) & 3) as Orientation;
    setOrientation(base);
    setAnim({ from: base, to, t: 0, start: now });
  };

  const rotateCW = () => startRotate(1);
  const rotateCCW = () => startRotate(-1);

  useEffect(() => {
    if (!anim) return;
    let raf = 0;
    const loop = () => {
      const t = Math.min(1, (performance.now() - anim.start) / DURATION);
      setAnim((prev) => (prev ? { ...prev, t } : null));
      if (t < 1) {
        raf = requestAnimationFrame(loop);
      } else {
        setOrientation(anim.to);
        setAnim(null);
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [anim?.start]);

  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const panRef = useRef(pan);
  const scaleRef = useRef(scale);
  const centerRef = useRef({ x: 0, y: 0 });
  const boundsRef = useRef<GridBounds | null>(null);
  panRef.current = pan;
  scaleRef.current = scale;

  const [isPanning, setIsPanning] = useState(false);
  const dragStart = useRef<{ x: number; y: number } | null>(null);

  // Tile selection state
  const [hoveredTile, setHoveredTile] = useState<{ x: number; y: number } | null>(null);
  const [selectedTile, setSelectedTile] = useState<{ x: number; y: number } | null>(null);

  // Track if we've had the first hover to trigger a one-time redraw fix
  const hasHoveredOnce = useRef(false);
  const [forceRedraw, setForceRedraw] = useState(0);

  const baseTiles = useMemo(() => terrain ? buildBaseTiles(terrain) : [], [terrain]);

  const fromO = anim ? anim.from : orientation;
  const toO = anim ? anim.to : orientation;
  const tNorm = anim ? easeInOut(anim.t) : 1;

  const projFrom = useMemo(() => !terrain || baseTiles.length === 0 ? [] : projectTiles(baseTiles, terrain.Width, terrain.Length, fromO), [baseTiles, terrain, fromO]);
  const projTo = useMemo(() => !terrain || baseTiles.length === 0 ? [] : projectTiles(baseTiles, terrain.Width, terrain.Length, toO), [baseTiles, terrain, toO]);
  const currentProjections = useMemo(() => (projFrom.length === 0 || projTo.length === 0) ? [] : lerpProjections(projFrom, projTo, tNorm), [projFrom, projTo, tNorm]);
  const order = useMemo(() => !terrain || baseTiles.length === 0 || projTo.length === 0 ? [] : sortTilesByDepth(baseTiles, projTo), [terrain, baseTiles, projTo]);

  const centerFrom = useMemo(() => projFrom.length === 0 ? { cx: w / 2, cy: h / 2 } : centerGridInView(calculateGridBounds(projFrom), w, h), [projFrom, w, h]);
  const centerTo = useMemo(() => {
    if (projTo.length === 0) return { cx: w / 2, cy: h / 2 };
    const bounds = calculateGridBounds(projTo);
    boundsRef.current = bounds;
    return centerGridInView(bounds, w, h);
  }, [projTo, w, h]);

  const currentCenter = useMemo(() => lerpCenter(centerFrom, centerTo, tNorm), [centerFrom, centerTo, tNorm]);
  centerRef.current = { x: currentCenter.cx, y: currentCenter.cy };

  const onWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    if (!ref.current || !boundsRef.current) return;
    e.preventDefault();
    const zoomIntensity = 0.0015;
    const zoom = Math.exp(-e.deltaY * zoomIntensity);
    const newScaleUnclamped = scaleRef.current * zoom;
    const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, newScaleUnclamped));
    const actual = newScale / scaleRef.current;
    if (actual === 1) return;

    const rect = ref.current.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    const cx = centerRef.current.x;
    const cy = centerRef.current.y;
    const worldX = (mx - (cx + panRef.current.x)) / scaleRef.current;
    const worldY = (my - (cy + panRef.current.y)) / scaleRef.current;
    const nextPanX = mx - cx - worldX * newScale;
    const nextPanY = my - cy - worldY * newScale;

    const clampedPan = clampPan(
      { x: nextPanX, y: nextPanY },
      centerRef.current,
      boundsRef.current,
      newScale,
      rect.width,
      rect.height,
      PAN_PADDING
    );

    setScale(newScale);
    setPan(clampedPan);
  }, []);

  const onMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 1 && e.button !== 2) return;
    e.preventDefault();
    setIsPanning(true);
    dragStart.current = { x: e.clientX, y: e.clientY };
  }, []);

  const onMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!isPanning || !dragStart.current || !boundsRef.current) return;
    const dx = e.clientX - dragStart.current.x;
    const dy = e.clientY - dragStart.current.y;
    dragStart.current = { x: e.clientX, y: e.clientY };
    setPan((p) => clampPan(
      { x: p.x + dx, y: p.y + dy },
      centerRef.current,
      boundsRef.current!,
      scaleRef.current,
      w,
      h,
      PAN_PADDING
    ));
  }, [isPanning, w, h]);

  const endPan = useCallback(() => {
    setIsPanning(false);
    dragStart.current = null;
  }, []);

  // Tile interaction handlers
  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!ref.current || !terrain || isPanning) return;

    const rect = ref.current.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;

    // Use the "to" orientation for hit testing during animation
    const currentOrientation: Orientation = anim ? anim.to : orientation;

    const tile = screenToTile(
      screenX,
      screenY,
      centerRef.current.x,
      centerRef.current.y,
      panRef.current.x,
      panRef.current.y,
      scaleRef.current,
      terrain.Width,
      terrain.Length,
      currentOrientation,
      terrain.HeightMap
    );

    if (tile && !hasHoveredOnce.current) {
      hasHoveredOnce.current = true;
      setForceRedraw(1);
    }
    setHoveredTile(tile);
  }, [terrain, isPanning, anim, orientation]);

  const handlePointerDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    // Only handle left click for tile selection
    if (e.button !== 0 || !hoveredTile || !terrain) return;
    
    setSelectedTile(hoveredTile);
    console.log(`Selected tile: (${hoveredTile.x}, ${hoveredTile.y})`);
  }, [hoveredTile, terrain]);

  const draw = useCallback((g: PixiGraphics) => {
    g.clear();
    if (!terrain || baseTiles.length === 0 || currentProjections.length === 0) return;
    const W = terrain.Width;
    const L = terrain.Length;
    const hmap = terrain.HeightMap || [];
    const halfW = TILE_W / 2;
    const halfH = TILE_H / 2;
    const faceOrient: Orientation = anim ? (anim.t < 0.5 ? anim.from : anim.to) : orientation;
    for (const i of order) {
      const base = baseTiles[i];
      const proj = currentProjections[i];
      const cx = proj.cx;
      const cy = proj.cy;
      const color = base.color;
      const topX = cx;
      const topY = cy - halfH;
      const rightX = cx + halfW;
      const rightY = cy;
      const bottomX = cx;
      const bottomY = cy + halfH;
      const leftX = cx - halfW;
      const leftY = cy;
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
  }, [terrain, baseTiles, currentProjections, order, anim, orientation, forceRedraw]);

  // Draw hover highlight
  const drawHoverHighlight = useCallback((g: PixiGraphics) => {
    g.clear();
    if (!hoveredTile || !terrain || baseTiles.length === 0 || currentProjections.length === 0) return;

    const tileIndex = getTileIndex(hoveredTile.x, hoveredTile.y, terrain.Width);
    const proj = currentProjections[tileIndex];
    if (!proj) return;

    const halfW = TILE_W / 2;
    const halfH = TILE_H / 2;

    g.setFillStyle({ color: 0xffffff, alpha: 0.3 });
    g.setStrokeStyle({ width: 2, color: 0xffffff, alpha: 0.8 });
    g.beginPath();
    g.moveTo(proj.cx, proj.cy - halfH);
    g.lineTo(proj.cx + halfW, proj.cy);
    g.lineTo(proj.cx, proj.cy + halfH);
    g.lineTo(proj.cx - halfW, proj.cy);
    g.closePath();
    g.fill();
    g.stroke();
  }, [hoveredTile, terrain, baseTiles, currentProjections]);

  // Draw selection highlight
  const drawSelectionHighlight = useCallback((g: PixiGraphics) => {
    g.clear();
    if (!selectedTile || !terrain || baseTiles.length === 0 || currentProjections.length === 0) return;

    const tileIndex = getTileIndex(selectedTile.x, selectedTile.y, terrain.Width);
    const proj = currentProjections[tileIndex];
    if (!proj) return;

    const halfW = TILE_W / 2;
    const halfH = TILE_H / 2;

    g.setStrokeStyle({ width: 3, color: 0x00ff00, alpha: 1 });
    g.beginPath();
    g.moveTo(proj.cx, proj.cy - halfH);
    g.lineTo(proj.cx + halfW, proj.cy);
    g.lineTo(proj.cx, proj.cy + halfH);
    g.lineTo(proj.cx - halfW, proj.cy);
    g.closePath();
    g.stroke();
  }, [selectedTile, terrain, baseTiles, currentProjections]);

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
      onPointerMove={handlePointerMove}
      onClick={handlePointerDown}
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
            x={currentCenter.cx + pan.x}
            y={currentCenter.cy + pan.y}
            scale={{ x: scale, y: scale }}
          >
            {/* Base terrain layer */}
            <pixiGraphics draw={draw} />
            
            {/* Hover highlight layer */}
            {hoveredTile && <pixiGraphics draw={drawHoverHighlight} />}
            
            {/* Selection highlight layer */}
            {selectedTile && <pixiGraphics draw={drawSelectionHighlight} />}
          </pixiContainer>
        </Application>
      )}
      <div className="absolute left-3 top-3 z-10 flex gap-2">
        <button
          type="button"
          className="btn btn-lg rounded-md bg-base-100 shadow hover:bg-base-300"
          onClick={rotateCCW}
          title="Rotate 90 degrees counter-clockwise"
        >
          ⟳
        </button>
        <button
          type="button"
          className="btn btn-lg rounded-md bg-base-100 shadow hover:bg-base-300"
          onClick={rotateCW}
          title="Rotate 90 degrees clockwise"
        >
          ⟲
        </button>
      </div>
      <div className="pointer-events-none absolute right-3 bottom-3 rounded-xl bg-base-100/70 px-2 py-1 text-[11px] shadow">
        <span className="opacity-70">Terrain:</span>{' '}
        <span className="font-mono">{terrain?.Name ?? '-'}</span>{' '}
        <span className="opacity-70">| Rot:</span>{' '}
        <span className="font-mono">{(anim ? anim.to : orientation) * 90}°</span>{' '}
        {anim && <span className="opacity-60">({Math.round(tNorm * 100)}%)</span>}
        {hoveredTile && (
          <>
            {' '}<span className="opacity-70">| Hover:</span>{' '}
            <span className="font-mono">({hoveredTile.x}, {hoveredTile.y})</span>
          </>
        )}
        {selectedTile && (
          <>
            {' '}<span className="opacity-70">| Selected:</span>{' '}
            <span className="font-mono">({selectedTile.x}, {selectedTile.y})</span>
          </>
        )}
      </div>
    </div>
  );
}