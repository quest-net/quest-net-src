// Shared types for the VoxelTerrainEditor subcomponents.

export type EditorView = "edit" | "preview";

export type EditorTool =
	| "place"
	| "fill"
	| "erase"
	| "paint"
	| "sample"
	| "stamp"
	| "boxSelect"
	| "colorSelect";

export type EditGranularityType = "tactical" | "voxel";

export type SelectionEditTool = "place" | "fill" | "erase" | "paint";

/** Which camera the editor canvas is driven by. */
export type CameraMode = "ortho" | "perspective" | "freecam";

export function isSelectionEditTool(tool: EditorTool): tool is SelectionEditTool {
	return tool === "place" || tool === "fill" || tool === "erase" || tool === "paint";
}
