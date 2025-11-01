// components/Map/MapStateProvider.tsx
import { createContext, useContext, useState, ReactNode, useCallback } from "react";

export interface SelectedActor {
  id: string;
  kind: "character" | "entity";
  moveSpeed: number;
}

export interface HoveredTile {
  x: number;
  y: number;
}

interface MapState {
  selectedActor: SelectedActor | null;
  hoveredTile: HoveredTile | null;
}

interface MapContextValue extends MapState {
  selectActor: (actor: SelectedActor | null) => void;
  toggleActorSelection: (actor: SelectedActor) => void;
  clearSelection: () => void;
  updateHoveredTile: (tile: HoveredTile | null) => void;
}

const MapContext = createContext<MapContextValue | null>(null);

export function MapStateProvider({ children }: { children: ReactNode }) {
  const [selectedActor, setSelectedActor] = useState<SelectedActor | null>(null);
  const [hoveredTile, setHoveredTile] = useState<HoveredTile | null>(null);

  const selectActor = useCallback((actor: SelectedActor | null) => {
    setSelectedActor(actor);
  }, []);

  const toggleActorSelection = useCallback((actor: SelectedActor) => {
    setSelectedActor((current) => {
      if (current && current.id === actor.id) {
        return null;
      }
      return actor;
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedActor(null);
  }, []);

  const updateHoveredTile = useCallback((tile: HoveredTile | null) => {
    setHoveredTile(tile);
  }, []);

  return (
    <MapContext.Provider
      value={{
        selectedActor,
        hoveredTile,
        selectActor,
        toggleActorSelection,
        clearSelection,
        updateHoveredTile,
      }}
    >
      {children}
    </MapContext.Provider>
  );
}

export function useMapState() {
  const context = useContext(MapContext);
  if (!context) {
    throw new Error("useMapState must be used within MapStateProvider");
  }
  return context;
}