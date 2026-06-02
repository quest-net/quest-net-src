// Voxel terrain editor.
//
// The editor exposes a 3D voxel grid the user can paint, erase, stamp and
// smooth. State flows in two layers:
//   - terrainRef         -- the canonical committed terrain (matches the form)
//   - editGridRef        -- the live in-memory voxel buffer mutated per-stroke
// Strokes never re-encode the SVO mid-edit. At stroke end we record an undo
// delta, mark the form dirty, and (in preview mode) re-encode for the preview.
//
// Three.js rendering is chunked: a dirty-chunk set drives per-frame mesh and
// grid-line rebuilds in the rAF loop, so a single voxel edit only touches 1-2
// chunk meshes regardless of terrain size.

import {
	forwardRef,
	useCallback,
	useEffect,
	useImperativeHandle,
	useMemo,
	useRef,
	useState,
} from "react";
import * as THREE from "three";
import {
	type VoxelTerrain,
	type VoxelTerrainBackground,
	type VoxelTerrainLighting,
} from "../../../domains/VoxelTerrain/VoxelTerrain";
import { useFormContext } from "../../Form/Form";
import MapScene from "../../Map/MapScene";
import { MapStateProvider } from "../../Map/MapStateProvider";

import {
	createTerrainRevision,
	getVoxelTerrainIndex,
	getVoxelTerrainResolution,
} from "../../../utils/terrain/data/VoxelTerrainIndex";
import {
	buildEditGrid,
	copyEditGrid,
	countEditGridVoxels,
	createEditGrid,
	editGridGetColor,
	editGridHasVoxelAtIndex,
	encodeEditGrid,
	applyDeltaToGrid,
	type EditGrid,
	type GridDelta,
} from "../../../utils/terrain/editor/EditGridUtils";
import {
	chunkIndex,
	computeChunkDims,
	computeChunkDimsForShape,
	markAllChunksDirty,
	markVoxelDirtyChunks,
	reshapeEditGrid,
	unpackChunkIndex,
	type ChunkDims,
} from "../../../utils/terrain/editor/EditGridChunkUtils";
import {
	applyBoxSelectionSmooth,
	applySelectionEdit,
	applyStampToGrid,
	applyVoxelEdit,
	DEFAULT_SMOOTH_PASSES,
	MAX_SMOOTH_PASSES,
	MIN_SMOOTH_PASSES,
} from "../../../utils/terrain/editor/EditGridOperations";
import {
	combineVoxelSelectionBounds,
	createColorVoxelSelection,
	getVoxelSelectionBounds,
	getVoxelSelectionSpaceCount,
	normalizeVoxelSelectionBounds,
	type TerrainSelection,
	type VoxelCoord,
	type VoxelSelectionBounds,
} from "../../../utils/terrain/editor/VoxelTerrainSelectionUtils";
import {
	MAX_BRUSH_SIZE,
	MIN_BRUSH_SIZE,
	getPickSelectionBounds,
	type PickInfo,
} from "../../../utils/terrain/editor/VoxelBrushUtils";
import {
	IDENTITY_STAMP_TRANSFORM,
	mirrorStampTransform,
	rotateStampTransform,
	type StampTransform,
} from "../../../utils/terrain/editor/VoxelStampUtils";
import { normalizeVoxelPaletteIndex } from "../../../utils/terrain/editor/VoxelTerrainEditorUtils";
import { DEFAULT_TERRAIN_COLOR_INDEX } from "../../../utils/terrain/palette/TerrainPaletteUtils";
import {
	buildTerrainFromVox,
	getVoxResolutionOptions,
	parseVoxFile,
	type VoxParseResult,
} from "../../../utils/terrain/import/VoxImportUtils";

import {
	clearObjectGroup,
	createEditorScene,
	disposeObjectTree,
	frameOrthoCamera,
	resizeRenderer,
	type EditorSceneResources,
} from "./editorScene";
import {
	clearAllChunkMeshes,
	rebuildChunk,
} from "./editorChunkMeshes";
import {
	clearAllGridChunkLines,
	createEditorGridGroup,
	rebuildBoundsFrame,
	rebuildGridForChunk,
	type EditorGridGroup,
} from "./editorGridLines";
import {
	updateHoverIndicator,
	updateSelectionIndicator,
} from "./editorHoverIndicator";
import { createPicker, type LockedStrokePlane } from "./editorPicking";
import {
	buildActorMarkers,
	projectActorMarkers,
	type ActorOverlayInfo,
} from "./editorActorMarkers";
import { EditorToolbar } from "./EditorToolbar";
import { EditorSidebar } from "./EditorSidebar";
import { PreviewSettingsPanel } from "./PreviewSettingsPanel";
import { VoxImportModal, type VoxImportModalState } from "./VoxImportModal";
import {
	isSelectionEditTool,
	type CameraMode,
	type EditGranularityType,
	type EditorTool,
	type EditorView,
} from "./editorTypes";

export type { ActorOverlayInfo };

interface VoxelTerrainEditorProps {
	terrain: VoxelTerrain;
	onChange: (terrain: VoxelTerrain) => void;
	readOnly?: boolean;
	actors?: ActorOverlayInfo[];
	/** Stamp-tagged terrains available for the Insert Stamp dropdown.
	 *  May be unhydrated; the editor calls `loadStampVoxels` before use.
	 */
	stampSources?: VoxelTerrain[];
	/** Returns the fully hydrated voxel data for a stamp source by id. */
	loadStampVoxels?: (terrainId: string) => Promise<VoxelTerrain | null>;
}

export interface VoxelTerrainEditorHandle {
	materializeTerrain: () => VoxelTerrain;
	reshapeDraft: (nextShape: {
		width: number;
		length: number;
		height: number;
		resolution: number;
	}) => VoxelTerrain;
}

interface ActiveStroke {
	pointerId: number;
	startClientX: number;
	startClientY: number;
	dragStarted: boolean;
	lockedPlane: LockedStrokePlane;
}

const UNDO_LIMIT = 50;
const STROKE_DRAG_THRESHOLD_PX = 5;

const IS_MAC =
	typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/i.test(navigator.platform);
const MOD_KEY_LABEL = IS_MAC ? "⌘" : "Ctrl";

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

function isTextInputTarget(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;
	const tag = target.tagName.toLowerCase();
	return tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable;
}

const VoxelTerrainEditor = forwardRef<VoxelTerrainEditorHandle, VoxelTerrainEditorProps>(
	function VoxelTerrainEditor(
		{
			terrain,
			onChange,
			readOnly = false,
			actors,
			stampSources,
			loadStampVoxels,
		}: VoxelTerrainEditorProps,
		ref,
	) {
		const { setDirty } = useFormContext();

		// -------------------------------------------------------------------------
		// Refs
		// -------------------------------------------------------------------------
		const containerRef    = useRef<HTMLDivElement>(null);
		const resourcesRef    = useRef<EditorSceneResources | null>(null);
		const gridGroupRef    = useRef<EditorGridGroup | null>(null);
		// Canonical committed terrain. Updated at stroke end, undo/redo, external prop.
		const terrainRef      = useRef(terrain);
		// Live voxel state. Written per-voxel during editing; never re-encoded mid-stroke.
		const editGridRef     = useRef<EditGrid>(createEditGrid(0));
		const occupiedVoxelCountRef = useRef(0);
		// Chunk system: meshes + pending rebuild set.
		const chunkMeshesRef  = useRef<Map<number, THREE.Mesh | null>>(new Map());
		const dirtyChunksRef  = useRef<Set<number>>(new Set());
		const chunkDimsRef    = useRef<ChunkDims | null>(null);
		// Undo / redo as bounded arrays (push at the end; shift when over limit).
		const undoStackRef    = useRef<GridDelta[]>([]);
		const redoStackRef    = useRef<GridDelta[]>([]);
		// Tool/brush state mirrors kept as refs for the event-handler hot path.
		const toolRef          = useRef<EditorTool>("place");
		const granularityRef   = useRef<EditGranularityType>("tactical");
		const brushSizeRef     = useRef(1);
		const selectedColorRef = useRef(DEFAULT_TERRAIN_COLOR_INDEX);
		const readOnlyRef      = useRef(readOnly);
		const actorsRef        = useRef<ActorOverlayInfo[]>(actors ?? []);
		const showActorsRef    = useRef(true);
		const activeViewRef    = useRef<EditorView>("edit");
		const actorMarkerElemsRef = useRef<Map<string, HTMLDivElement>>(new Map());
		const actorOverlayRef  = useRef<HTMLDivElement>(null);
		// Stroke state.
		const activeStrokeRef        = useRef<ActiveStroke | null>(null);
		const strokeStartedRef       = useRef(false);
		// Delta accumulator: maps flat voxel index -> packed pre-stroke state
		// (bit 8 = was occupied, bits 0-7 = old color). Null when no stroke is
		// in progress.
		const strokeDeltaRef         = useRef<Map<number, number> | null>(null);
		const lastEditKeyRef         = useRef<string | null>(null);
		// Shape change detection for camera framing.
		const lastShapeSignatureRef  = useRef<string | null>(null);
		// Tracks the last Voxels string we emitted so we can ignore our own echoes
		// when the terrain prop bounces back from the parent after onChange.
		const lastEmittedVoxelsRef   = useRef(terrain.Voxels);
		const onChangeRef            = useRef(onChange);
		// Stamp state.
		const stampSourceRef         = useRef<VoxelTerrain | null>(null);
		const stampTransformRef      = useRef<StampTransform>(IDENTITY_STAMP_TRANSFORM);
		const loadStampVoxelsRef     = useRef(loadStampVoxels);
		const previousToolRef        = useRef<EditorTool>("place");
		// Selection state mirrored in refs for pointer handlers, in React for UI.
		const selectionRef           = useRef<TerrainSelection | null>(null);
		const boxSelectionAnchorRef  = useRef<VoxelSelectionBounds | null>(null);
		const selectionIdRef         = useRef(1);
		// Hover ghost refresh helpers wired up by the scene effect.
		const refreshHoverRef        = useRef<(() => void) | null>(null);
		const refreshSelectionRef    = useRef<(() => void) | null>(null);
		// Freecam state. cameraModeRef mirrors the React state for the rAF/event
		// hot path. pointerLockedRef tracks PointerLockControls' lock state so
		// the input handlers can gate hover/paint when the cursor is hidden.
		// lastNonFreecamModeRef remembers ortho vs perspective so F can restore
		// the user's preferred non-fly camera.
		const cameraModeRef          = useRef<CameraMode>("ortho");
		const lastNonFreecamModeRef  = useRef<CameraMode>("ortho");
		const pointerLockedRef       = useRef(false);

		// -------------------------------------------------------------------------
		// React state
		// -------------------------------------------------------------------------
		const [activeView,         setActiveView]         = useState<EditorView>("edit");
		const [tool,               setTool]               = useState<EditorTool>("place");
		const [granularity,        setGranularity]        = useState<EditGranularityType>("tactical");
		const [brushSize,          setBrushSize]          = useState(1);
		const [smoothPasses,       setSmoothPasses]       = useState(DEFAULT_SMOOTH_PASSES);
		const [selectedColorIndex, setSelectedColorIndex] = useState(DEFAULT_TERRAIN_COLOR_INDEX);
		// Grid visibility is derived from `granularity`.
		const showTacticalGrid = granularity === "tactical";
		const showVoxelGrid    = granularity === "voxel";
		const [showActors,         setShowActors]         = useState(true);
		const [undoDepth,          setUndoDepth]          = useState(0);
		const [redoDepth,          setRedoDepth]          = useState(0);
		const [cameraMode,         setCameraMode]         = useState<CameraMode>("ortho");
		const [freecamSpeedMult,   setFreecamSpeedMult]   = useState(1);
		const [voxImportModal,     setVoxImportModal]     = useState<VoxImportModalState | null>(null);
		const voxFileInputRef = useRef<HTMLInputElement>(null);
		const [stampSource,        setStampSource]        = useState<VoxelTerrain | null>(null);
		const [stampTransform,     setStampTransform]     = useState<StampTransform>(IDENTITY_STAMP_TRANSFORM);
		const [stampLoadingId,     setStampLoadingId]     = useState<string | null>(null);
		const [selection,          setSelectionState]     = useState<TerrainSelection | null>(null);
		const [boxSelectionAnchor, setBoxSelectionAnchorState] = useState<VoxelSelectionBounds | null>(null);
		const [previewTerrain,     setPreviewTerrain]     = useState<VoxelTerrain | null>(null);
		// editGen ticks on stroke end / undo/redo / external prop. Gates React-
		// visible updates (sidebar count, camera framing). Never bumped per-voxel.
		const [editGen, setEditGen] = useState(0);
		const bumpEditGen = useCallback(() => setEditGen((g) => g + 1), []);
		const markDraftDirty = useCallback(() => {
			if (!readOnlyRef.current) setDirty(true);
		}, [setDirty]);

		// -------------------------------------------------------------------------
		// Selection helpers
		// -------------------------------------------------------------------------
		const setTerrainSelection = useCallback((next: TerrainSelection | null) => {
			selectionRef.current = next;
			setSelectionState(next);
			refreshSelectionRef.current?.();
		}, []);

		const setBoxSelectionAnchor = useCallback((next: VoxelSelectionBounds | null) => {
			boxSelectionAnchorRef.current = next;
			setBoxSelectionAnchorState(next);
			refreshSelectionRef.current?.();
		}, []);

		const nextSelectionId = useCallback(() => selectionIdRef.current++, []);

		// editGen is read so React treats voxelCount / selectionSummary as deps.
		void editGen;
		const voxelCount = occupiedVoxelCountRef.current;
		const lighting = terrain.Lighting;
		const background = terrain.Background;

		const selectionSummary = useMemo(() => {
			if (!selection) return null;
			return {
				bounds: getVoxelSelectionBounds(selection),
				spaceCount: getVoxelSelectionSpaceCount(selection),
			};
		}, [selection]);

		const createDraftTerrainSnapshot = useCallback((): VoxelTerrain => {
			const dims = chunkDimsRef.current;
			if (!dims) return terrainRef.current;
			return {
				...terrainRef.current,
				Voxels: encodeEditGrid(editGridRef.current, dims.vW, dims.vH, dims.vL),
				VoxelsLoaded: true,
			};
		}, []);

		const refreshPreviewTerrain = useCallback(() => {
			setPreviewTerrain(createDraftTerrainSnapshot());
		}, [createDraftTerrainSnapshot]);

		const emitTerrainUpdate = (nextTerrain: VoxelTerrain) => {
			terrainRef.current = nextTerrain;
			lastEmittedVoxelsRef.current = nextTerrain.Voxels;
			onChangeRef.current(nextTerrain);
		};

		const updateLighting = (updates: Partial<VoxelTerrainLighting>) => {
			if (readOnly) return;
			const nextTerrain = {
				...terrain,
				Lighting: { ...lighting, ...updates },
			};
			emitTerrainUpdate(nextTerrain);
			if (activeViewRef.current === "preview") refreshPreviewTerrain();
		};

		const updateBackground = (updates: VoxelTerrainBackground) => {
			if (readOnly) return;
			const nextTerrain = { ...terrain, Background: updates };
			emitTerrainUpdate(nextTerrain);
			if (activeViewRef.current === "preview") refreshPreviewTerrain();
		};

		const selectVoxelsByColor = useCallback((colorIndex: number) => {
			const dims = chunkDimsRef.current;
			if (!dims) return;

			setBoxSelectionAnchor(null);
			setTerrainSelection(
				createColorVoxelSelection(
					editGridRef.current,
					dims,
					normalizeVoxelPaletteIndex(colorIndex),
					nextSelectionId(),
				),
			);
		}, [nextSelectionId, setBoxSelectionAnchor, setTerrainSelection]);

		const updateBoxSelectionBound = useCallback((
			edge: "min" | "max",
			axis: keyof VoxelCoord,
			value: number,
		) => {
			if (!selectionRef.current || selectionRef.current.kind !== "box") return;
			const dims = chunkDimsRef.current;
			if (!dims) return;

			const min = { ...selectionRef.current.bounds.min };
			const max = { ...selectionRef.current.bounds.max };
			if (edge === "min") min[axis] = value;
			else max[axis] = value;

			setTerrainSelection({
				kind: "box",
				id: nextSelectionId(),
				bounds: normalizeVoxelSelectionBounds(min, max, dims),
			});
		}, [nextSelectionId, setTerrainSelection]);

		const clearSelection = useCallback(() => {
			setBoxSelectionAnchor(null);
			setTerrainSelection(null);
		}, [setBoxSelectionAnchor, setTerrainSelection]);

		const chooseColorIndex = useCallback((colorIndex: number) => {
			const normalized = normalizeVoxelPaletteIndex(colorIndex);
			selectedColorRef.current = normalized;
			setSelectedColorIndex(normalized);
			if (toolRef.current === "colorSelect") {
				selectVoxelsByColor(normalized);
			}
		}, [selectVoxelsByColor]);

		// -------------------------------------------------------------------------
		// Sync refs from props/state
		// -------------------------------------------------------------------------
		useEffect(() => { onChangeRef.current = onChange; }, [onChange]);

		useEffect(() => {
			toolRef.current          = tool;
			granularityRef.current   = granularity;
			brushSizeRef.current     = brushSize;
			selectedColorRef.current = selectedColorIndex;
			readOnlyRef.current      = readOnly;
			// Tool/brush changes affect the hover ghost; reflect them without
			// waiting for the next pointer move (matters when leaving stamp mode).
			refreshHoverRef.current?.();
		}, [tool, granularity, brushSize, selectedColorIndex, readOnly]);

		useEffect(() => { actorsRef.current    = actors ?? []; }, [actors]);
		useEffect(() => { showActorsRef.current = showActors;   }, [showActors]);
		useEffect(() => { activeViewRef.current = activeView;   }, [activeView]);
		useEffect(() => {
			cameraModeRef.current = cameraMode;
			// Track the last non-freecam camera mode so F can restore it.
			if (cameraMode !== "freecam") lastNonFreecamModeRef.current = cameraMode;
		}, [cameraMode]);
		useEffect(() => {
			stampSourceRef.current = stampSource;
			refreshHoverRef.current?.();
		}, [stampSource]);
		useEffect(() => {
			stampTransformRef.current = stampTransform;
			// R/M presses don't move the cursor, so push the new orientation.
			refreshHoverRef.current?.();
		}, [stampTransform]);
		useEffect(() => { loadStampVoxelsRef.current = loadStampVoxels; }, [loadStampVoxels]);

		useEffect(() => {
			if (tool !== "boxSelect" && boxSelectionAnchorRef.current) {
				setBoxSelectionAnchor(null);
			}
		}, [setBoxSelectionAnchor, tool]);

		// -------------------------------------------------------------------------
		// Terrain prop adoption
		// -------------------------------------------------------------------------
		useEffect(() => {
			// Skip our own echo: the parent re-renders after our onChange call and
			// passes back the same Voxels string we just emitted.
			if (
				createTerrainRevision(terrain) === createTerrainRevision(terrainRef.current) &&
				terrain.Voxels === lastEmittedVoxelsRef.current
			) {
				terrainRef.current = terrain;
				return;
			}

			terrainRef.current = terrain;
			lastEmittedVoxelsRef.current = terrain.Voxels;

			const index = getVoxelTerrainIndex(terrain);
			const newDims = computeChunkDims(index);
			const oldDims = chunkDimsRef.current;
			const shapeChanged =
				!oldDims ||
				oldDims.vW !== newDims.vW ||
				oldDims.vH !== newDims.vH ||
				oldDims.vL !== newDims.vL;

			chunkDimsRef.current = newDims;
			setTerrainSelection(null);
			setBoxSelectionAnchor(null);

			const newGrid = buildEditGrid(terrain, index);
			if (editGridRef.current.length === newGrid.length) {
				copyEditGrid(editGridRef.current, newGrid);
			} else {
				editGridRef.current = newGrid;
			}
			occupiedVoxelCountRef.current = countEditGridVoxels(newGrid);

			const resources = resourcesRef.current;
			const gridGroup = gridGroupRef.current;
			if (shapeChanged && resources && gridGroup) {
				clearAllChunkMeshes(resources.chunkGroup, chunkMeshesRef.current);
				clearAllGridChunkLines(gridGroup);
				rebuildBoundsFrame(gridGroup, newDims);
				clearObjectGroup(resources.hoverGroup);
				clearObjectGroup(resources.selectionGroup);
				// Skip auto-reframe in freecam -- the user's position is preserved.
				if (cameraModeRef.current === "ortho") {
					const container = containerRef.current;
					if (container) frameOrthoCamera(resources, terrain, container);
				}
			}

			markAllChunksDirty(dirtyChunksRef.current, newDims);
			bumpEditGen();
		}, [terrain, bumpEditGen, setBoxSelectionAnchor, setTerrainSelection]);

		// Clear undo history when switching to a different terrain entirely.
		useEffect(() => {
			undoStackRef.current.length = 0;
			redoStackRef.current.length = 0;
			setUndoDepth(0);
			setRedoDepth(0);
			lastShapeSignatureRef.current = null;
			clearSelection();
		}, [clearSelection, terrain.Id]);

		// -------------------------------------------------------------------------
		// Draft commit (called once at stroke end -- never per-rAF)
		// -------------------------------------------------------------------------
		const commitDraftChange = useCallback(() => {
			bumpEditGen();
			markDraftDirty();
			if (activeViewRef.current === "preview") refreshPreviewTerrain();
		}, [bumpEditGen, markDraftDirty, refreshPreviewTerrain]);

		const materializeTerrain = useCallback((): VoxelTerrain => {
			const nextTerrain = createDraftTerrainSnapshot();
			terrainRef.current = nextTerrain;
			lastEmittedVoxelsRef.current = nextTerrain.Voxels;
			return nextTerrain;
		}, [createDraftTerrainSnapshot]);

		const reshapeDraft = useCallback(
			(nextShape: {
				width: number;
				length: number;
				height: number;
				resolution: number;
			}): VoxelTerrain => {
				const oldDims =
					chunkDimsRef.current ??
					computeChunkDimsForShape(
						terrainRef.current.Width,
						terrainRef.current.Length,
						terrainRef.current.Height,
						getVoxelTerrainResolution(terrainRef.current),
					);
				const result = reshapeEditGrid(editGridRef.current, oldDims, nextShape);

				editGridRef.current = result.grid;
				chunkDimsRef.current = result.dims;
				occupiedVoxelCountRef.current = result.count;
				undoStackRef.current.length = 0;
				redoStackRef.current.length = 0;
				setUndoDepth(0);
				setRedoDepth(0);
				clearSelection();

				const nextTerrain: VoxelTerrain = {
					...terrainRef.current,
					Width:  result.shape.width,
					Length: result.shape.length,
					Height: result.shape.height,
					Resolution: result.shape.resolution,
				};
				terrainRef.current = nextTerrain;

				const resources = resourcesRef.current;
				const gridGroup = gridGroupRef.current;
				if (resources && gridGroup) {
					clearAllChunkMeshes(resources.chunkGroup, chunkMeshesRef.current);
					clearAllGridChunkLines(gridGroup);
					rebuildBoundsFrame(gridGroup, result.dims);
					clearObjectGroup(resources.hoverGroup);
					clearObjectGroup(resources.selectionGroup);
					markAllChunksDirty(dirtyChunksRef.current, result.dims);
					if (cameraModeRef.current === "ortho") {
						const container = containerRef.current;
						if (container) frameOrthoCamera(resources, nextTerrain, container);
					}
				}

				lastShapeSignatureRef.current = null;
				commitDraftChange();
				return nextTerrain;
			},
			[clearSelection, commitDraftChange],
		);

		useImperativeHandle(
			ref,
			() => ({ materializeTerrain, reshapeDraft }),
			[materializeTerrain, reshapeDraft],
		);

		// -------------------------------------------------------------------------
		// Undo / Redo (bounded arrays, push/shift in place)
		// -------------------------------------------------------------------------
		const recordUndo = useCallback(() => {
			const acc = strokeDeltaRef.current;
			strokeDeltaRef.current = null;
			if (!acc || acc.size === 0) return;

			const n = acc.size;
			const indices    = new Uint32Array(n);
			const oldStates  = new Uint16Array(n);
			const newStates  = new Uint16Array(n);
			let   countDelta = 0;
			let   i          = 0;
			for (const [idx, oldPacked] of acc) {
				const newOccupied = editGridHasVoxelAtIndex(editGridRef.current, idx);
				const newColor    = editGridRef.current.colors[idx];
				const newPacked   = (newOccupied ? 0x100 : 0) | newColor;
				indices[i]   = idx;
				oldStates[i] = oldPacked;
				newStates[i] = newPacked;
				countDelta  += (newOccupied ? 1 : 0) - ((oldPacked & 0x100) ? 1 : 0);
				i++;
			}

			const delta: GridDelta = { indices, oldStates, newStates, countDelta };
			undoStackRef.current.push(delta);
			if (undoStackRef.current.length > UNDO_LIMIT) undoStackRef.current.shift();
			redoStackRef.current.length = 0;
			setUndoDepth(undoStackRef.current.length);
			setRedoDepth(0);
		}, []);

		const undo = useCallback(() => {
			if (undoStackRef.current.length === 0) return;
			const dims = chunkDimsRef.current;
			if (!dims) return;

			const delta = undoStackRef.current.pop();
			if (!delta) return;

			applyDeltaToGrid(
				editGridRef.current,
				delta,
				"undo",
				dims.vW,
				dims.vL,
				(vx, vy, vz) => markVoxelDirtyChunks(vx, vy, vz, dirtyChunksRef.current, dims),
			);
			occupiedVoxelCountRef.current -= delta.countDelta;
			redoStackRef.current.push(delta);
			if (redoStackRef.current.length > UNDO_LIMIT) redoStackRef.current.shift();

			setUndoDepth(undoStackRef.current.length);
			setRedoDepth(redoStackRef.current.length);
			refreshSelectionRef.current?.();
			bumpEditGen();
			markDraftDirty();
		}, [bumpEditGen, markDraftDirty]);

		const redo = useCallback(() => {
			if (redoStackRef.current.length === 0) return;
			const dims = chunkDimsRef.current;
			if (!dims) return;

			const delta = redoStackRef.current.pop();
			if (!delta) return;

			applyDeltaToGrid(
				editGridRef.current,
				delta,
				"redo",
				dims.vW,
				dims.vL,
				(vx, vy, vz) => markVoxelDirtyChunks(vx, vy, vz, dirtyChunksRef.current, dims),
			);
			occupiedVoxelCountRef.current += delta.countDelta;
			undoStackRef.current.push(delta);
			if (undoStackRef.current.length > UNDO_LIMIT) undoStackRef.current.shift();

			setUndoDepth(undoStackRef.current.length);
			setRedoDepth(redoStackRef.current.length);
			refreshSelectionRef.current?.();
			bumpEditGen();
			markDraftDirty();
		}, [bumpEditGen, markDraftDirty]);

		// -------------------------------------------------------------------------
		// Pre-mutation hook: records the voxel's pre-stroke state in the delta
		// accumulator so we can build a precise undo delta at stroke end.
		// -------------------------------------------------------------------------
		const recordVoxelBefore = useCallback((gIdx: number) => {
			let acc = strokeDeltaRef.current;
			if (acc === null) {
				strokeDeltaRef.current = new Map();
				acc = strokeDeltaRef.current;
			}
			if (acc.has(gIdx)) return; // already recorded for this stroke
			const occupied = editGridHasVoxelAtIndex(editGridRef.current, gIdx);
			const color    = editGridRef.current.colors[gIdx];
			acc.set(gIdx, (occupied ? 0x100 : 0) | color);
		}, []);

		// -------------------------------------------------------------------------
		// Apply edit -- writes directly to editGrid (no React, no encode)
		// -------------------------------------------------------------------------
		const applyEdit = useCallback((pick: PickInfo): boolean => {
			if (readOnlyRef.current) return false;

			const index = getVoxelTerrainIndex(terrainRef.current);
			const dims  = chunkDimsRef.current;
			if (!dims) return false;

			// Capture once so TypeScript can narrow through the dispatch chain.
			const tool = toolRef.current;

			if (tool === "boxSelect") {
				const pickBounds = getPickSelectionBounds(index, pick, granularityRef.current, dims);
				const anchor = boxSelectionAnchorRef.current;
				if (!anchor) {
					setTerrainSelection(null);
					setBoxSelectionAnchor(pickBounds);
				} else {
					setTerrainSelection({
						kind: "box",
						id: nextSelectionId(),
						bounds: combineVoxelSelectionBounds(anchor, pickBounds, dims),
					});
					setBoxSelectionAnchor(null);
				}
				return false;
			}

			if (tool === "colorSelect") {
				const sampledColor = editGridGetColor(
					editGridRef.current,
					pick.voxel.x, pick.voxel.y, pick.voxel.z,
					dims.vW, dims.vH, dims.vL,
				);
				if (sampledColor === null) return false;
				selectedColorRef.current = sampledColor;
				setSelectedColorIndex(sampledColor);
				selectVoxelsByColor(sampledColor);
				return false;
			}

			const activeSelection = selectionRef.current;
			if (activeSelection && isSelectionEditTool(tool)) {
				const selectionResult = applySelectionEdit(
					editGridRef.current,
					dirtyChunksRef.current,
					dims,
					activeSelection,
					tool,
					selectedColorRef.current,
					recordVoxelBefore,
				);
				if (!selectionResult.changed) return false;
				occupiedVoxelCountRef.current += selectionResult.countDelta;
				refreshSelectionRef.current?.();
				if (!strokeStartedRef.current) strokeStartedRef.current = true;
				return true;
			}

			if (tool === "stamp") {
				const source = stampSourceRef.current;
				if (!source) return false;
				const anchor: VoxelCoord = pick.ground
					? { ...pick.voxel }
					: {
						x: pick.voxel.x + pick.normal.x,
						y: pick.voxel.y + pick.normal.y,
						z: pick.voxel.z + pick.normal.z,
					};
				const stampResult = applyStampToGrid(
					editGridRef.current,
					dirtyChunksRef.current,
					dims,
					anchor,
					source,
					stampTransformRef.current,
					recordVoxelBefore,
				);
				if (!stampResult.changed) return false;
				occupiedVoxelCountRef.current += stampResult.countDelta;
				if (!strokeStartedRef.current) strokeStartedRef.current = true;
				return true;
			}

			// Fill only operates on an active selection (handled above). With no
			// selection there is nothing to flood, so it has no brush behaviour.
			if (tool === "fill") return false;

			// At this point the box/color/stamp/selection paths have all returned,
			// so the live tool must be one of the brush tools the dispatcher
			// understands. The cast carries that invariant through to TypeScript.
			const brushTool = tool as "place" | "erase" | "paint" | "sample";
			const result = applyVoxelEdit(
				editGridRef.current,
				index,
				dirtyChunksRef.current,
				dims,
				pick,
				brushTool,
				granularityRef.current,
				brushSizeRef.current,
				selectedColorRef.current,
				recordVoxelBefore,
			);

			if (result.sampledColor !== null) {
				selectedColorRef.current = result.sampledColor;
				setSelectedColorIndex(result.sampledColor);
				toolRef.current = "paint";
				setTool("paint");
				return false;
			}

			if (!result.changed) return false;
			occupiedVoxelCountRef.current += result.countDelta;
			if (!strokeStartedRef.current) strokeStartedRef.current = true;
			return true;
		}, [
			recordVoxelBefore,
			nextSelectionId,
			selectVoxelsByColor,
			setBoxSelectionAnchor,
			setTerrainSelection,
		]);

		const smoothBoxSelection = useCallback(() => {
			if (readOnlyRef.current) return;
			const activeSelection = selectionRef.current;
			if (!activeSelection || activeSelection.kind !== "box") return;
			const dims = chunkDimsRef.current;
			if (!dims) return;

			strokeDeltaRef.current = null;
			const result = applyBoxSelectionSmooth(
				editGridRef.current,
				dirtyChunksRef.current,
				dims,
				activeSelection.bounds,
				smoothPasses,
				recordVoxelBefore,
			);
			if (!result.changed) {
				strokeDeltaRef.current = null;
				return;
			}

			occupiedVoxelCountRef.current += result.countDelta;
			recordUndo();
			refreshSelectionRef.current?.();
			commitDraftChange();
		}, [commitDraftChange, recordUndo, recordVoxelBefore, smoothPasses]);

		// -------------------------------------------------------------------------
		// Stamp mode entry/exit
		// -------------------------------------------------------------------------
		const exitStampMode = useCallback(() => {
			setTool(previousToolRef.current);
			setStampSource(null);
			setStampTransform(IDENTITY_STAMP_TRANSFORM);
			setStampLoadingId(null);
		}, []);

		const selectStamp = useCallback(async (terrainId: string) => {
			const loader = loadStampVoxelsRef.current;
			if (!loader) return;
			if (toolRef.current !== "stamp") {
				previousToolRef.current = toolRef.current;
			}
			setStampLoadingId(terrainId);
			try {
				const hydrated = await loader(terrainId);
				if (!hydrated) {
					console.warn(`[VoxelTerrainEditor] Failed to load stamp source: ${terrainId}`);
					setStampLoadingId(null);
					return;
				}
				setStampSource(hydrated);
				setStampTransform(IDENTITY_STAMP_TRANSFORM);
				setTool("stamp");
			} finally {
				setStampLoadingId((current) => (current === terrainId ? null : current));
			}
		}, []);

		const getEditKey = useCallback((pick: PickInfo): string => {
			if (toolRef.current === "stamp") {
				const source = stampSourceRef.current;
				const transform = stampTransformRef.current;
				return [
					"stamp",
					source?.Id ?? "none",
					transform.rotation,
					transform.mirror ? 1 : 0,
					pick.voxel.x, pick.voxel.y, pick.voxel.z,
					pick.normal.x, pick.normal.y, pick.normal.z,
				].join(":");
			}
			return [
				toolRef.current,
				granularityRef.current,
				brushSizeRef.current,
				pick.voxel.x, pick.voxel.y, pick.voxel.z,
				pick.normal.x, pick.normal.y, pick.normal.z,
			].join(":");
		}, []);

		// -------------------------------------------------------------------------
		// Imperative actor overlay
		// -------------------------------------------------------------------------
		useEffect(() => {
			const overlay = actorOverlayRef.current;
			if (!overlay) return;
			actorMarkerElemsRef.current = buildActorMarkers(overlay, actors ?? []);
		}, [actors]);

		// -------------------------------------------------------------------------
		// Three.js mount (runs once)
		// -------------------------------------------------------------------------
		useEffect(() => {
			const container = containerRef.current;
			if (!container) return;

			const resources = createEditorScene(container, readOnlyRef.current);
			resourcesRef.current = resources;
			const gridGroup = createEditorGridGroup(resources.gridGroup);
			gridGroupRef.current = gridGroup;

			// Initialize edit grid + chunks from the current terrain.
			const initTerrain = terrainRef.current;
			const initIndex   = getVoxelTerrainIndex(initTerrain);
			const initDims    = computeChunkDims(initIndex);
			chunkDimsRef.current  = initDims;
			editGridRef.current   = buildEditGrid(initTerrain, initIndex);
			occupiedVoxelCountRef.current = countEditGridVoxels(editGridRef.current);
			markAllChunksDirty(dirtyChunksRef.current, initDims);
			rebuildBoundsFrame(gridGroup, initDims);
			frameOrthoCamera(resources, initTerrain, container);
			lastShapeSignatureRef.current =
				`${initIndex.width}:${initIndex.length}:${initIndex.height}:${initIndex.resolution}`;

			const picker = createPicker({
				resourcesRef,
				dimsRef: chunkDimsRef,
				editGridRef,
				terrainRef,
			});

			// --- rAF loop ---
			let rafId = 0;
			let lastFrameMs = 0;
			const animate = (nowMs: number) => {
				rafId = requestAnimationFrame(animate);
				const dt = lastFrameMs > 0 ? Math.min(0.1, (nowMs - lastFrameMs) / 1000) : 1 / 60;
				lastFrameMs = nowMs;

				// Rebuild any chunks dirtied by edits this frame. Per-chunk grid
				// lines rebuild in lockstep so a small edit only repaints the 1-2
				// chunks it actually touches.
				const dirty = dirtyChunksRef.current;
				if (dirty.size > 0) {
					const grid = editGridRef.current;
					const dims = chunkDimsRef.current;
					if (dims) {
						const wantTactical = activeViewRef.current === "edit" && granularityRef.current === "tactical";
						const wantVoxel    = activeViewRef.current === "edit" && granularityRef.current === "voxel";
						for (const idx of dirty) {
							const { cx, cy, cz } = unpackChunkIndex(idx, dims);
							rebuildChunk(
								idx, cx, cy, cz,
								grid, dims,
								resources.chunkGroup,
								resources.terrainMaterial,
								chunkMeshesRef.current,
							);
							rebuildGridForChunk(
								gridGroup, grid, dims,
								idx, cx, cy, cz,
								wantTactical, wantVoxel,
							);
						}
						dirty.clear();
					}
				}

				// Freecam movement while flying, otherwise damped orbit.
				resources.rig.update(dt);

				resources.renderer.render(resources.scene, resources.camera);

				const overlay = actorOverlayRef.current;
				if (overlay && actorMarkerElemsRef.current.size > 0) {
					projectActorMarkers(
						resources.renderer.domElement,
						resources.camera,
						terrainRef.current,
						actorsRef.current,
						actorMarkerElemsRef.current,
						showActorsRef.current,
					);
				}
			};
			rafId = requestAnimationFrame(animate);

			const resizeObserver = new ResizeObserver(() => {
				resizeRenderer(resources, container);
			});
			resizeObserver.observe(container);

			// --- Hover / selection refresh helpers ---
			// Caches the most recent pick so external callers (stamp R/M, tool
			// change) can re-render the ghost without a new pointer event.
			let lastHoverPick: PickInfo | null = null;
			const refreshSelection = (pick: PickInfo | null = lastHoverPick) => {
				const dims = chunkDimsRef.current;
				if (!dims) return;
				if (activeViewRef.current !== "edit") {
					clearObjectGroup(resources.selectionGroup);
					return;
				}

				const previewBounds =
					toolRef.current === "boxSelect" && boxSelectionAnchorRef.current && pick
						? combineVoxelSelectionBounds(
							boxSelectionAnchorRef.current,
							getPickSelectionBounds(
								getVoxelTerrainIndex(terrainRef.current),
								pick,
								granularityRef.current,
								dims,
							),
							dims,
						)
						: null;

				updateSelectionIndicator(resources, dims, selectionRef.current, previewBounds);
			};
			const refreshHover = (pick: PickInfo | null) => {
				lastHoverPick = pick;
				const dims = chunkDimsRef.current;
				if (!dims) return;
				if (activeViewRef.current !== "edit") {
					clearObjectGroup(resources.hoverGroup);
					refreshSelection(pick);
					return;
				}
				// Selection-edit tools show the selection outline, not a brush ghost.
				// Fill always defers to the selection (it has no brush form), so it
				// never draws a misleading per-voxel ghost when nothing is selected.
				if (
					toolRef.current === "fill" ||
					(selectionRef.current && isSelectionEditTool(toolRef.current))
				) {
					clearObjectGroup(resources.hoverGroup);
					refreshSelection(pick);
					return;
				}
				updateHoverIndicator(resources, {
					grid: editGridRef.current,
					dims,
					index: getVoxelTerrainIndex(terrainRef.current),
					pick,
					tool: toolRef.current,
					granularity: granularityRef.current,
					brushSize: brushSizeRef.current,
					colorIndex: selectedColorRef.current,
					stampSource: stampSourceRef.current,
					stampTransform: stampTransformRef.current,
				});
				refreshSelection(pick);
			};
			refreshHoverRef.current = () => refreshHover(lastHoverPick);
			refreshSelectionRef.current = () => refreshSelection(lastHoverPick);

			const getPickForStroke = (
				event: PointerEvent,
				activeStroke: ActiveStroke | null,
			): PickInfo | null => {
				if (activeStroke && !event.shiftKey) {
					return picker.getLockedPlanePickInfo(event, activeStroke.lockedPlane);
				}
				return picker.getPickInfo(event);
			};

			const hasMovedPastDragThreshold = (
				event: PointerEvent,
				stroke: ActiveStroke,
			): boolean => {
				const dx = event.clientX - stroke.startClientX;
				const dy = event.clientY - stroke.startClientY;
				return dx * dx + dy * dy >= STROKE_DRAG_THRESHOLD_PX ** 2;
			};

			const clearStrokeState = () => {
				activeStrokeRef.current  = null;
				strokeStartedRef.current = false;
				strokeDeltaRef.current   = null;
				lastEditKeyRef.current   = null;
			};

			// --- Pointer handlers ---
			const handlePointerMove = (event: PointerEvent) => {
				if (activeViewRef.current !== "edit") return;
				if (pointerLockedRef.current) return;
				const activeStroke =
					activeStrokeRef.current?.pointerId === event.pointerId
						? activeStrokeRef.current : null;
				const pick = getPickForStroke(event, activeStroke);
				refreshHover(pick);
				// Sample is one-shot; stamp is one-per-click; selection tools are
				// single-click. None of them drag-paint.
				if (
					!activeStroke ||
					!pick ||
					toolRef.current === "sample" ||
					toolRef.current === "stamp" ||
					toolRef.current === "boxSelect" ||
					toolRef.current === "colorSelect" ||
					(selectionRef.current && isSelectionEditTool(toolRef.current))
				) return;

				if (!activeStroke.dragStarted) {
					if (!hasMovedPastDragThreshold(event, activeStroke)) return;
					activeStroke.dragStarted = true;
				}

				const editKey = getEditKey(pick);
				if (lastEditKeyRef.current === editKey) return;
				lastEditKeyRef.current = editKey;

				const changed = applyEdit(pick);
				if (changed) refreshHover(getPickForStroke(event, activeStroke));
			};

			const handlePointerDown = (event: PointerEvent) => {
				if (activeViewRef.current !== "edit") return;
				// Pointer-locked freecam consumes mouse motion -- skip paint dispatch.
				if (pointerLockedRef.current) return;
				if (event.button === 1) { event.preventDefault(); return; }
				if (event.button !== 0 || readOnlyRef.current) return;
				event.preventDefault();

				const pick = picker.getPickInfo(event);
				if (!pick) return;

				resources.renderer.domElement.setPointerCapture(event.pointerId);

				const activeStroke: ActiveStroke = {
					pointerId:    event.pointerId,
					startClientX: event.clientX,
					startClientY: event.clientY,
					dragStarted:  false,
					lockedPlane: {
						plane:  pick.plane.clone(),
						normal: { ...pick.normal },
						ground: pick.ground,
					},
				};
				activeStrokeRef.current  = activeStroke;
				strokeStartedRef.current = false;
				strokeDeltaRef.current   = null;
				lastEditKeyRef.current   = getEditKey(pick);

				const wasSelectionTool =
					toolRef.current === "boxSelect" || toolRef.current === "colorSelect";
				const wasSampleTool = toolRef.current === "sample";
				applyEdit(pick);
				refreshHover(getPickForStroke(event, activeStroke));
				if (wasSampleTool || wasSelectionTool) {
					resources.renderer.domElement.releasePointerCapture(event.pointerId);
					clearStrokeState();
				}
			};

			const finishStroke = (event: PointerEvent) => {
				if (
					activeStrokeRef.current &&
					activeStrokeRef.current.pointerId !== event.pointerId
				) {
					return;
				}
				if (resources.renderer.domElement.hasPointerCapture(event.pointerId)) {
					resources.renderer.domElement.releasePointerCapture(event.pointerId);
				}
				if (strokeStartedRef.current) {
					recordUndo();
					commitDraftChange();
				}
				clearStrokeState();
			};

			const handlePointerLeave = () => {
				if (!activeStrokeRef.current) refreshHover(null);
			};

			const preventContextMenu       = (e: MouseEvent) => e.preventDefault();
			const preventMiddleMouseScroll = (e: MouseEvent) => { if (e.button === 1) e.preventDefault(); };

			// Freecam input (right-hold to look + WASD/QE to fly, scroll for speed)
			// is owned by the CameraRig. Editor-specific side effects are wired in
			// through callbacks: commit the in-flight stroke before yielding the
			// cursor, hide the hover ghost while flying, and surface speed to the HUD.
			resources.rig.setCallbacks({
				onActiveCameraChange: (cam) => { resources.camera = cam; },
				onPointerLockChange: (locked) => {
					pointerLockedRef.current = locked;
					if (locked) clearObjectGroup(resources.hoverGroup);
				},
				onFreecamSpeedChange: (mult) => setFreecamSpeedMult(mult),
				beforePointerLock: () => {
					if (strokeStartedRef.current) {
						recordUndo();
						commitDraftChange();
					}
					clearStrokeState();
				},
			});
			resources.rig.attachInput();

			const dom = resources.renderer.domElement;
			dom.addEventListener("pointermove",   handlePointerMove);
			dom.addEventListener("pointerdown",   handlePointerDown, true);
			dom.addEventListener("pointerup",     finishStroke);
			dom.addEventListener("pointercancel", finishStroke);
			dom.addEventListener("pointerleave",  handlePointerLeave);
			dom.addEventListener("mousedown",     preventMiddleMouseScroll, true);
			dom.addEventListener("auxclick",      preventMiddleMouseScroll);
			dom.addEventListener("contextmenu",   preventContextMenu);

			return () => {
				cancelAnimationFrame(rafId);
				resizeObserver.disconnect();
				dom.removeEventListener("pointermove",   handlePointerMove);
				dom.removeEventListener("pointerdown",   handlePointerDown, true);
				dom.removeEventListener("pointerup",     finishStroke);
				dom.removeEventListener("pointercancel", finishStroke);
				dom.removeEventListener("pointerleave",  handlePointerLeave);
				dom.removeEventListener("mousedown",     preventMiddleMouseScroll, true);
				dom.removeEventListener("auxclick",      preventMiddleMouseScroll);
				dom.removeEventListener("contextmenu",   preventContextMenu);
				if (pointerLockedRef.current) resources.pointerLockControls.unlock();
				// Detaches freecam input and disposes both controls.
				resources.rig.dispose();
				clearAllChunkMeshes(resources.chunkGroup, chunkMeshesRef.current);
				clearAllGridChunkLines(gridGroup);
				resources.terrainMaterial.dispose();
				disposeObjectTree(resources.gridGroup);
				disposeObjectTree(resources.hoverGroup);
				disposeObjectTree(resources.selectionGroup);
				resources.renderer.dispose();
				if (dom.parentElement === container) container.removeChild(dom);
				activeStrokeRef.current     = null;
				resourcesRef.current        = null;
				gridGroupRef.current        = null;
				refreshHoverRef.current     = null;
				refreshSelectionRef.current = null;
			};
		}, [applyEdit, commitDraftChange, getEditKey, recordUndo]);

		// -------------------------------------------------------------------------
		// editGen effects (camera framing on shape change)
		// -------------------------------------------------------------------------
		useEffect(() => {
			const resources = resourcesRef.current;
			const container = containerRef.current;
			if (!resources || !container) return;

			const t = terrainRef.current;
			const index = getVoxelTerrainIndex(t);
			const sig = `${index.width}:${index.length}:${index.height}:${index.resolution}`;

			if (lastShapeSignatureRef.current !== sig) {
				clearObjectGroup(resources.hoverGroup);
				// Reframe only the ortho camera; freecam stays where the user left it.
				if (cameraModeRef.current === "ortho") {
					frameOrthoCamera(resources, t, container);
				}
				lastShapeSignatureRef.current = sig;
			}
		}, [editGen]);

		// Granularity / view changes: re-emit grid lines for every chunk using the
		// new visibility flags.
		useEffect(() => {
			const resources = resourcesRef.current;
			const gridGroup = gridGroupRef.current;
			const dims = chunkDimsRef.current;
			if (!resources || !gridGroup || !dims) return;

			const wantTactical = activeView === "edit" && showTacticalGrid;
			const wantVoxel    = activeView === "edit" && showVoxelGrid;
			const grid = editGridRef.current;
			for (let cy = 0; cy < dims.chunksY; cy++) {
				for (let cz = 0; cz < dims.chunksZ; cz++) {
					for (let cx = 0; cx < dims.chunksX; cx++) {
						const idx = chunkIndex(cx, cy, cz, dims);
						rebuildGridForChunk(
							gridGroup, grid, dims,
							idx, cx, cy, cz,
							wantTactical, wantVoxel,
						);
					}
				}
			}

			if (activeView !== "edit") {
				clearObjectGroup(resources.hoverGroup);
				clearObjectGroup(resources.selectionGroup);
			} else {
				refreshSelectionRef.current?.();
			}
			if (activeView === "preview") refreshPreviewTerrain();
		}, [activeView, refreshPreviewTerrain, showTacticalGrid, showVoxelGrid]);

		useEffect(() => {
			const resources = resourcesRef.current;
			const container = containerRef.current;
			if (!resources || !container) return;
			resizeRenderer(resources, container);
		}, [activeView]);

		useEffect(() => {
			const resources = resourcesRef.current;
			if (!resources) return;
			resources.renderer.domElement.style.cursor =
				readOnly || activeView !== "edit" ? "default" : "crosshair";
		}, [activeView, readOnly]);

		// -------------------------------------------------------------------------
		// Camera-mode selector (ortho / perspective / freecam)
		// Declared before the keyboard-shortcuts effect since the F handler
		// includes it in its dep array.
		// -------------------------------------------------------------------------
		const setCameraModeTo = useCallback((next: CameraMode) => {
			const resources = resourcesRef.current;
			if (!resources) return;
			if (next === cameraModeRef.current) return;

			// Commit any in-flight stroke before swapping cameras so the partial
			// edit isn't lost in the camera transition.
			if (strokeStartedRef.current) {
				recordUndo();
				commitDraftChange();
			}
			activeStrokeRef.current  = null;
			strokeStartedRef.current = false;
			strokeDeltaRef.current   = null;
			lastEditKeyRef.current   = null;

			// The rig handles camera selection, control re-binding, pointer-lock
			// release, and the perspective/freecam entry framing (it reads the
			// current terrain extents to start at a comfortable distance).
			const t = terrainRef.current;
			resources.rig.setTerrain({ width: t.Width, length: t.Length, height: t.Height });
			resources.rig.setMode(next);

			// Make sure projection matches the new active camera + container.
			const container = containerRef.current;
			if (container) resizeRenderer(resources, container);
			cameraModeRef.current = next;
			setCameraMode(next);
			// Hover ghost depends on the active camera; force a refresh.
			refreshHoverRef.current?.();
		}, [commitDraftChange, recordUndo]);

		// F toggles between the last non-freecam mode and freecam.
		const toggleCameraMode = useCallback(() => {
			const current = cameraModeRef.current;
			setCameraModeTo(current === "freecam" ? lastNonFreecamModeRef.current : "freecam");
		}, [setCameraModeTo]);

		// -------------------------------------------------------------------------
		// Keyboard shortcuts
		// -------------------------------------------------------------------------
		useEffect(() => {
			const handleKeyDown = (event: KeyboardEvent) => {
				if (isTextInputTarget(event.target)) return;

				if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
					event.preventDefault();
					if (event.shiftKey) redo(); else undo();
					return;
				}
				if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
					event.preventDefault();
					redo();
					return;
				}
				if (event.ctrlKey || event.metaKey || event.altKey) return;

				const key = event.key.toLowerCase();

				// F toggles freecam regardless of camera state (must work even when
				// the cursor isn't focused on the canvas).
				if (key === "f") {
					event.preventDefault();
					toggleCameraMode();
					return;
				}

				// Suppress brush-tool shortcuts while flying so WASD navigation
				// doesn't flip the active tool out from under the user.
				if (pointerLockedRef.current) return;

				if (toolRef.current === "stamp") {
					if (key === "r") {
						event.preventDefault();
						setStampTransform((t) => rotateStampTransform(t));
						return;
					}
					if (key === "m") {
						event.preventDefault();
						setStampTransform((t) => mirrorStampTransform(t));
						return;
					}
					if (key === "escape") {
						event.preventDefault();
						exitStampMode();
						return;
					}
				}

				if (key === "escape" && (selectionRef.current || boxSelectionAnchorRef.current)) {
					event.preventDefault();
					clearSelection();
					return;
				}

				switch (key) {
					case "p": case "t": setTool("place");  break;
					case "l":           setTool("fill");   break;
					case "r":           setTool("erase");  break;
					case "g":           setTool("paint");  break;
					case "i":           setTool("sample"); break;
					case "b":
						if (selectionRef.current?.kind === "mask") clearSelection();
						setTool("boxSelect");
						break;
					case "c":
						if (selectionRef.current?.kind === "box" || boxSelectionAnchorRef.current) {
							clearSelection();
						}
						setTool("colorSelect");
						break;
					case "1":           setGranularity("tactical"); break;
					case "2":           setGranularity("voxel");    break;
				}
			};
			window.addEventListener("keydown", handleKeyDown);
			return () => window.removeEventListener("keydown", handleKeyDown);
		}, [clearSelection, exitStampMode, redo, toggleCameraMode, undo]);

		// -------------------------------------------------------------------------
		// VOX import
		// -------------------------------------------------------------------------
		const applyVoxImport = useCallback(
			(parsed: VoxParseResult, res: number) => {
				const result = buildTerrainFromVox(parsed, res);
				const nextTerrain = { ...terrainRef.current, ...result };
				undoStackRef.current.length = 0;
				redoStackRef.current.length = 0;
				setUndoDepth(0);
				setRedoDepth(0);
				clearSelection();
				setVoxImportModal(null);
				onChangeRef.current(nextTerrain);
			},
			[clearSelection],
		);

		const handleVoxFile = useCallback(async (file: File) => {
			try {
				const buffer  = await file.arrayBuffer();
				const parsed  = parseVoxFile(buffer);
				const options = getVoxResolutionOptions(parsed);
				const valid   = options.filter((o) => o.fits);
				if (valid.length === 0) {
					setVoxImportModal({
						kind: "error",
						message: `This file's dimensions (${parsed.voxWidth}x${parsed.voxLength}x${parsed.voxHeight} voxels) are too large to import at any resolution. Maximum terrain size is 64x64x64 tactical units.`,
					});
					return;
				}
				if (valid.length === 1) { applyVoxImport(parsed, valid[0].resolution); return; }
				setVoxImportModal({ kind: "pick", parsed, options, selected: valid[0].resolution });
			} catch (err) {
				setVoxImportModal({
					kind: "error",
					message: err instanceof Error ? err.message : "Failed to parse .vox file.",
				});
			}
		}, [applyVoxImport]);

		const showPreview = useCallback(() => {
			refreshPreviewTerrain();
			setActiveView("preview");
		}, [refreshPreviewTerrain]);

		// -------------------------------------------------------------------------
		// Derived UI
		// -------------------------------------------------------------------------
		const activeSelectionTool =
			boxSelectionAnchor || selection?.kind === "box"
				? "boxSelect"
				: selection?.kind === "mask"
				? "colorSelect"
				: null;

		const handleToolButtonClick = useCallback((buttonId: EditorTool) => {
			if (buttonId === "boxSelect" || buttonId === "colorSelect") {
				if (activeSelectionTool === buttonId) {
					clearSelection();
					return;
				}
				if (activeSelectionTool && activeSelectionTool !== buttonId) {
					clearSelection();
				}
			}
			setTool(buttonId);
		}, [activeSelectionTool, clearSelection]);

		const handleBrushSizeChange = useCallback((value: number) => {
			setBrushSize(clamp(Math.floor(value) || MIN_BRUSH_SIZE, MIN_BRUSH_SIZE, MAX_BRUSH_SIZE));
		}, []);

		const handleSmoothPassesChange = useCallback((value: number) => {
			setSmoothPasses(clamp(Math.floor(value) || DEFAULT_SMOOTH_PASSES, MIN_SMOOTH_PASSES, MAX_SMOOTH_PASSES));
		}, []);

		// -------------------------------------------------------------------------
		// Render
		// -------------------------------------------------------------------------
		return (
			<>
				<div className="border-2 rounded-lg bg-base-100 min-h-152 h-[72dvh] flex overflow-hidden">
					<div className="flex-1 min-w-0 flex flex-col">
						<EditorToolbar
							tool={tool}
							activeSelectionTool={activeSelectionTool}
							onToolClick={handleToolButtonClick}
							brushSize={brushSize}
							onBrushSizeChange={handleBrushSizeChange}
							granularity={granularity}
							onGranularityChange={setGranularity}
							readOnly={readOnly}
							stampSources={stampSources}
							loadStampVoxels={loadStampVoxels}
							stampLoadingId={stampLoadingId}
							onSelectStamp={selectStamp}
							onExitStampMode={exitStampMode}
							undoDepth={undoDepth}
							redoDepth={redoDepth}
							onUndo={undo}
							onRedo={redo}
							modKeyLabel={MOD_KEY_LABEL}
							activeView={activeView}
							onShowEdit={() => setActiveView("edit")}
							onShowPreview={showPreview}
							onVoxFileSelected={(file) => void handleVoxFile(file)}
							voxFileInputRef={voxFileInputRef}
							cameraMode={cameraMode}
							onSelectCameraMode={setCameraModeTo}
							freecamSpeedMult={freecamSpeedMult}
						/>

						<div className="relative flex-1 min-h-0 bg-base-200">
							<div className={activeView === "edit" ? "absolute inset-0" : "hidden"}>
								<div ref={containerRef} className="absolute inset-0" />
								<div ref={actorOverlayRef} className="absolute inset-0 pointer-events-none overflow-hidden" />
							</div>
							{activeView === "preview" && (
								<div className="absolute inset-0">
									<MapStateProvider>
										<MapScene terrain={previewTerrain ?? terrain} />
									</MapStateProvider>
								</div>
							)}
						</div>
					</div>

					<div className="w-64 shrink-0 border-l-2 bg-base-100 p-3 overflow-y-auto">
						<div className="space-y-5">
							{activeView === "preview" ? (
								<PreviewSettingsPanel
									lighting={lighting}
									background={background}
									readOnly={readOnly}
									onLightingChange={updateLighting}
									onBackgroundChange={updateBackground}
								/>
							) : (
								<EditorSidebar
									voxelCount={voxelCount}
									tool={tool}
									selection={selection}
									boxSelectionAnchor={boxSelectionAnchor}
									selectionSummary={selectionSummary}
									dims={chunkDimsRef.current}
									readOnly={readOnly}
									selectedColorIndex={selectedColorIndex}
									onChooseColorIndex={chooseColorIndex}
									onUpdateBoxSelectionBound={updateBoxSelectionBound}
									smoothPasses={smoothPasses}
									onSmoothPassesChange={handleSmoothPassesChange}
									onSmoothBoxSelection={smoothBoxSelection}
									actors={actors}
									showActors={showActors}
									onShowActorsChange={setShowActors}
								/>
							)}
						</div>
					</div>
				</div>

				{voxImportModal && (
					<VoxImportModal
						state={voxImportModal}
						onSelectResolution={(resolution) =>
							setVoxImportModal((prev) =>
								prev?.kind === "pick" ? { ...prev, selected: resolution } : prev,
							)
						}
						onConfirm={applyVoxImport}
						onClose={() => setVoxImportModal(null)}
					/>
				)}
			</>
		);
	},
);

export default VoxelTerrainEditor;
