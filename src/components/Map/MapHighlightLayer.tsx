// components/Map/MapHighlightLayer.tsx
// Renders hover and selection highlights on the map

import { useMemo } from 'react';
import { Graphics as PixiGraphics } from 'pixi.js';
import type { Terrain } from '../../domains/Terrain/Terrain';
import type { BaseTile, Projected } from './MapUtilities';
import { TILE_W, TILE_H, getTileIndex } from './MapUtilities';

interface MapHighlightLayerProps {
  terrain: Terrain | undefined | null;
  baseTiles: BaseTile[];
  currentProjections: Projected[];
  hoveredTile: { x: number; y: number } | null;
  selectedTile: { x: number; y: number } | null;
}

export function MapHighlightLayer({
  terrain,
  baseTiles,
  currentProjections,
  hoveredTile,
  selectedTile
}: MapHighlightLayerProps) {
  
  const drawHover = useMemo(() => (g: PixiGraphics) => {
    g.clear();
    
    if (!hoveredTile || !terrain || baseTiles.length === 0 || currentProjections.length === 0) {
      return;
    }

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

  const drawSelection = useMemo(() => (g: PixiGraphics) => {
    g.clear();
    
    if (!selectedTile || !terrain || baseTiles.length === 0 || currentProjections.length === 0) {
      return;
    }

    const tileIndex = getTileIndex(selectedTile.x, selectedTile.y, terrain.Width);
    const proj = currentProjections[tileIndex];
    if (!proj) return;

    const halfW = TILE_W / 2;
    const halfH = TILE_H / 2;

    g.setStrokeStyle({ width: 3, color: '002bff', alpha: 1 });
    g.beginPath();
    g.moveTo(proj.cx, proj.cy - halfH);
    g.lineTo(proj.cx + halfW, proj.cy);
    g.lineTo(proj.cx, proj.cy + halfH);
    g.lineTo(proj.cx - halfW, proj.cy);
    g.closePath();
    g.stroke();
  }, [selectedTile, terrain, baseTiles, currentProjections]);

  return (
    <>
      {hoveredTile && <pixiGraphics draw={drawHover} />}
      {selectedTile && <pixiGraphics draw={drawSelection} />}
    </>
  );
}