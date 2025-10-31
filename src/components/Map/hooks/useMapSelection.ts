// components/Map/hooks/useMapSelection.ts
// Hook for managing actor selection and tile hovering

import { useState, useCallback } from "react";

export interface SelectedActor {
	id: string;
	kind: "character" | "entity";
	moveSpeed: number;
}

export interface HoveredTile {
	x: number;
	y: number;
}

export function useMapSelection() {
	const [selectedActor, setSelectedActor] = useState<SelectedActor | null>(
		null
	);
	const [hoveredTile, setHoveredTile] = useState<HoveredTile | null>(null);

	const selectActor = useCallback((actor: SelectedActor | null) => {
		setSelectedActor(actor);
	}, []);

	const toggleActorSelection = useCallback((actor: SelectedActor) => {
		setSelectedActor((current) => {
			// If clicking the same actor, deselect it
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

	return {
		selectedActor,
		hoveredTile,
		selectActor,
		toggleActorSelection,
		clearSelection,
		updateHoveredTile,
	};
}
