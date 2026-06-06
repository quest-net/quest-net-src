// components/inputs/VoxelTerrainEditor/DoorPlacement/DoorPlacementOverlay.tsx
//
// The door-placement flow, opened from the editor's "Doors" button. It is a
// self-contained wizard layered over the editor canvas so the editor's own
// brush/undo pipeline stays untouched.
//
// Steps:
//   1. origin       -- pick the door's tile on the terrain being edited.
//   2. pickTerrain  -- choose the destination terrain (reuses TerrainPicker).
//   3. destination  -- pick the door's tile on the destination terrain.
// On completion the door is created (onCreateDoor) and the flow loops back to
// step 1 so the DM can place several doors in a row. Done/Cancel closes it.

import { useState } from "react";
import type { EditableVoxelTerrain } from "../../../../domains/VoxelTerrain/VoxelTerrain";
import {
	anchorsEqual,
	getDoorAnchorsOnTerrain,
	isDoorAnchorOccupied,
	type Door,
	type DoorAnchor,
} from "../../../../domains/Door/Door";
import { TerrainPicker } from "../../TerrainPicker";
import { TerrainTilePickerCanvas } from "./TerrainTilePickerCanvas";

type Step = "origin" | "pickTerrain" | "destination";

interface DoorPlacementOverlayProps {
	/** The terrain being edited, with its current (possibly unsaved) voxels. */
	originTerrain: EditableVoxelTerrain;
	/** All campaign doors, for showing existing ones and preventing overlaps. */
	doors: Door[];
	/** Loads a destination terrain's voxels by id (null if unavailable). */
	loadTerrainVoxels: (terrainId: string) => Promise<EditableVoxelTerrain | null>;
	onCreateDoor: (a: DoorAnchor, b: DoorAnchor) => void;
	onClose: () => void;
}

export function DoorPlacementOverlay({
	originTerrain,
	doors,
	loadTerrainVoxels,
	onCreateDoor,
	onClose,
}: DoorPlacementOverlayProps) {
	const [step, setStep] = useState<Step>("origin");
	const [originAnchor, setOriginAnchor] = useState<DoorAnchor | null>(null);
	const [destinationTerrain, setDestinationTerrain] =
		useState<EditableVoxelTerrain | null>(null);
	const [loadingTerrain, setLoadingTerrain] = useState(false);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [placedCount, setPlacedCount] = useState(0);

	const resetFlow = () => {
		setStep("origin");
		setOriginAnchor(null);
		setDestinationTerrain(null);
		setLoadError(null);
	};

	const handleOriginPick = (anchor: DoorAnchor) => {
		if (isDoorAnchorOccupied(doors, anchor)) {
			setLoadError("A door is already on that tile. Pick another.");
			return;
		}
		setLoadError(null);
		setOriginAnchor(anchor);
		setStep("pickTerrain");
	};

	const handleTerrainChosen = async (terrainId: string) => {
		setLoadError(null);
		if (terrainId === originTerrain.Id) {
			// Same-terrain portal: reuse the already-loaded origin voxels.
			setDestinationTerrain(originTerrain);
			setStep("destination");
			return;
		}
		setLoadingTerrain(true);
		try {
			const loaded = await loadTerrainVoxels(terrainId);
			if (!loaded) {
				setLoadError("Could not load that terrain's voxel data.");
				setStep("origin");
				setOriginAnchor(null);
				return;
			}
			setDestinationTerrain(loaded);
			setStep("destination");
		} finally {
			setLoadingTerrain(false);
		}
	};

	const handleDestinationPick = (anchor: DoorAnchor) => {
		if (!originAnchor) return;
		if (anchorsEqual(anchor, originAnchor)) {
			setLoadError("The two ends can't be the same tile.");
			return;
		}
		if (isDoorAnchorOccupied(doors, anchor)) {
			setLoadError("A door is already on that tile. Pick another.");
			return;
		}
		onCreateDoor(originAnchor, anchor);
		setPlacedCount((n) => n + 1);
		resetFlow();
	};

	const shownTerrain = step === "destination" ? destinationTerrain : originTerrain;
	const existingAnchors = shownTerrain
		? getDoorAnchorsOnTerrain(doors, shownTerrain.Id).map((entry) => entry.anchor)
		: [];

	const stepLabel =
		step === "origin"
			? `Click the door's tile on ${originTerrain.Name}`
			: step === "pickTerrain"
			? "Choose the destination terrain"
			: `Click the destination tile on ${destinationTerrain?.Name ?? "the terrain"}`;

	const stepNumber = step === "origin" ? 1 : step === "pickTerrain" ? 2 : 3;

	return (
		<div className="absolute inset-0 z-30 flex flex-col bg-base-200">
			{/* Header */}
			<div className="shrink-0 border-b-2 bg-base-100 px-3 py-2 flex items-center gap-3">
				<span className="icon-[mdi--door] w-5 h-5 text-primary" />
				<div className="flex flex-col leading-tight">
					<span className="text-sm font-semibold">
						Place a door — step {stepNumber} of 3
					</span>
					<span className="text-xs text-base-content/70">{stepLabel}</span>
				</div>
				{loadError && (
					<span className="text-xs text-error">{loadError}</span>
				)}
				<div className="ml-auto flex items-center gap-2">
					{placedCount > 0 && (
						<span className="text-xs text-base-content/60">
							{placedCount} placed
						</span>
					)}
					{step !== "origin" && (
						<button
							type="button"
							className="btn btn-sm btn-ghost"
							onClick={resetFlow}
						>
							Restart door
						</button>
					)}
					<button type="button" className="btn btn-sm" onClick={onClose}>
						{placedCount > 0 ? "Done" : "Cancel"}
					</button>
				</div>
			</div>

			{/* Canvas */}
			<div className="relative flex-1 min-h-0">
				{shownTerrain && (step === "origin" || step === "destination") && (
					<TerrainTilePickerCanvas
						terrain={shownTerrain}
						existingAnchors={existingAnchors}
						onPick={
							step === "origin" ? handleOriginPick : handleDestinationPick
						}
					/>
				)}
				{loadingTerrain && (
					<div className="absolute inset-0 flex items-center justify-center gap-3 bg-base-200/80">
						<span className="loading loading-spinner loading-sm" />
						<span className="text-sm">Loading terrain...</span>
					</div>
				)}
			</div>

			{/* Destination-terrain picker modal (step 2). */}
			<TerrainPicker
				isOpen={step === "pickTerrain"}
				title="Door leads to..."
				confirmLabel="Select"
				currentTerrainId={originTerrain.Id}
				onConfirm={(terrainId) => void handleTerrainChosen(terrainId)}
				onCancel={() => {
					// Back out to re-pick the origin tile.
					setStep("origin");
					setOriginAnchor(null);
				}}
			/>
		</div>
	);
}
