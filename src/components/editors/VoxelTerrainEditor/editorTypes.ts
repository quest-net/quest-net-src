// Shared types for the VoxelTerrainEditor subcomponents.

import type { ActorlessRigCameraMode } from "../../../utils/camera/CameraModes";

export type EditorView = "edit" | "preview";

export type EditorTool =
	| "place"
	| "fill"
	| "erase"
	| "paint"
	| "sample"
	| "stamp"
	| "link"
	| "boxSelect"
	| "colorSelect";

export type EditGranularityType = "tactical" | "voxel";

export type SelectionEditTool = "place" | "fill" | "erase" | "paint";

/** Which camera the editor canvas is driven by. The editor has no actors, so
 *  this is exactly the rig's actorless mode set -- aliased rather than respelt
 *  so the two can never drift. */
export type CameraMode = ActorlessRigCameraMode;

export function isSelectionEditTool(tool: EditorTool): tool is SelectionEditTool {
	return tool === "place" || tool === "fill" || tool === "erase" || tool === "paint";
}
