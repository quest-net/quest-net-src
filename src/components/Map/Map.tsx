// tsconfig: { "jsx": "react-jsx", "jsxImportSource": "@pixi/react" }
import React, { useMemo, useRef, useState, useLayoutEffect } from 'react';
import { Application, extend } from '@pixi/react';
import { Container as PixiContainer, Graphics as PixiGraphics } from 'pixi.js';

extend({ Container: PixiContainer, Graphics: PixiGraphics });

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

const TILE_W = 64, TILE_H = 32, V_SCALE = 16;

function hexToNum(hex: string) {
  const h = hex.startsWith('#') ? hex.slice(1) : hex;
  return parseInt(h, 16);
}

function useMeasuredContainer<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  // Measure before first paint to avoid the “jump”
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

  type Tile = { cx: number; cy: number; color: number };
  const tiles: Tile[] = useMemo(() => {
    if (!terrain) return [];
    const out: Tile[] = [];
    for (let y = 0; y < terrain.Length; y++) {
      for (let x = 0; x < terrain.Width; x++) {
        const hh = (terrain.HeightMap[y]?.[x] ?? 0) | 0;
        const tt = (terrain.ColorMap[y]?.[x] ?? ('grey' as TerrainType));
        const color = hexToNum(TERRAIN_COLORS[tt] ?? '#6b7280');
        const cx = (x - y) * (TILE_W / 2);
        const cy = (x + y) * (TILE_H / 2) - hh * V_SCALE;
        out.push({ cx, cy, color });
      }
    }
    return out;
  }, [terrain]);

  // Grid bounds → container position (center the grid)
  const { posX, posY } = useMemo(() => {
    if (!terrain || tiles.length === 0) return { posX: w / 2, posY: h / 2 };
    const halfW = TILE_W / 2, halfH = TILE_H / 2;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const t of tiles) {
      minX = Math.min(minX, t.cx - halfW);
      maxX = Math.max(maxX, t.cx + halfW);
      minY = Math.min(minY, t.cy - halfH);
      maxY = Math.max(maxY, t.cy + halfH);
    }
    const gridW = maxX - minX, gridH = maxY - minY;
    // top-left we want to move to center:
    const originX = minX + gridW / 2;
    const originY = minY + gridH / 2;
    return { posX: w / 2 - originX, posY: h / 2 - originY };
  }, [tiles, terrain, w, h]);

  const draw = React.useCallback((g: PixiGraphics) => {
    g.clear();
    if (!terrain || tiles.length === 0) return;
    const halfW = TILE_W / 2, halfH = TILE_H / 2;
    for (const t of tiles) {
      g.setFillStyle({ color: t.color, alpha: 0.8 });
      g.setStrokeStyle({ width: 1, color: 0x000000, alpha: 0.5 });
      g.beginPath();
      g.moveTo(t.cx, t.cy - halfH);
      g.lineTo(t.cx + halfW, t.cy);
      g.lineTo(t.cx, t.cy + halfH);
      g.lineTo(t.cx - halfW, t.cy);
      g.closePath();
      g.fill();
      g.stroke();
    }
  }, [tiles, terrain]);

  const ready = w > 0 && h > 0;

  return (
    <div ref={ref} className="relative h-full w-full bg-base-200 overflow-hidden">
      {/* Avoid first-paint jump by waiting for initial measurement */}
      {ready && (
        <Application
          resizeTo={ref}
          antialias
          autoDensity
          resolution={dpr}
          backgroundAlpha={0}
        >
          {/* Center via container position; draw tiles in local coords */}
          <pixiContainer x={posX} y={posY}>
            <pixiGraphics draw={draw} />
          </pixiContainer>
        </Application>
      )}

      <div className="pointer-events-none absolute left-3 top-3 rounded-xl bg-base-100/70 p-2 text-xs shadow">
        <div className="font-semibold opacity-70">Scene</div>
        <div className="opacity-80">Environment: <span className="font-mono">{scene?.EnvironmentImageId ?? '—'}</span></div>
        <div className="opacity-80">Focus: <span className="font-mono">{scene?.FocusImageId ?? '—'}</span></div>
        <div className="opacity-80">Terrain: <span className="font-mono">{terrain?.Name ?? '—'}</span></div>
      </div>
    </div>
  );
}
