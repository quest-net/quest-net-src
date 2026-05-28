// Shared types for the VoxelTerrainEditor subcomponents.

export type EditorView = "edit" | "preview";

export type EditorTool =
	| "place"
	| "erase"
	| "paint"
	| "sample"
	| "stamp"
	| "boxSelect"
	| "colorSelect";

export type EditGranularityType = "tactical" | "voxel";

export type SelectionEditTool = "place" | "erase" | "paint";

export function isSelectionEditTool(tool: EditorTool): tool is SelectionEditTool {
	return tool === "place" || tool === "erase" || tool === "paint";
}
