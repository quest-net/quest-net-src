// components/Map/3DMap.tsx
// Three.js voxel terrain renderer with orthographic isometric camera.
// Addon imports use three/examples/jsm/ -- see CLAUDE.md for why.
// MeshStandardMaterial not MeshLambertMaterial -- see CLAUDE.md for why.

import { useCallback, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { CameraRig, type CameraRigConfig } from '../../utils/camera/CameraRig';
import type { Character } from '../../domains/Character/Character';
import type { Entity } from '../../domains/Entity/Entity';
import { useQuestContext } from '../../domains/Context/ContextProvider';
import { useActionService } from '../../services/Actions/ActionServiceProvider';
import { CampaignActions } from '../../domains/Campaign/CampaignActions';
import { AppSettingActions } from '../../domains/AppSetting/AppSettingActions';
import { getMaxVoxelSurfaceHeight } from '../../utils/terrain/data/VoxelTerrainUtils';
import { getVoxelCount } from '../../utils/terrain/data/VoxelDataUtils';
import { getVoxelTerrainIndex } from '../../utils/terrain/data/VoxelTerrainIndex';
import {
	calculateVoxelMovementRange,
	calculateVoxelRemainingMovementRange,
} from '../../utils/terrain/movement/VoxelMovementUtilities';
import type { VoxelTerrain } from '../../domains/VoxelTerrain/VoxelTerrain';
import { useMapState } from './MapStateProvider';
import { ThreeDActorLayer } from './Actors3D/ThreeDActorLayer';
import { ThreeDMovementLayer } from './Movement3D/ThreeDMovementLayer';
import { ThreeDStickerLayer } from './Stickers3D/ThreeDStickerLayer';
import { ThreeDPingLayer } from './Pings3D/ThreeDPingLayer';
import { ACTOR_TOKEN_DESCRIPTOR_DEFAULTS } from './Actors3D/actorTokenConstants';
import { useActiveStickers } from './hooks/useActiveStickers';
import { useActivePings } from './hooks/useActivePings';
import { useLiveActorPoseOverrides } from './hooks/useLiveActorPoseOverrides';
import { PING_DURATION_MS } from '../../domains/Ping/Ping';
import { usePeerTracking } from '../../hooks/usePeerTracking';
import {
	THREE_D_MAP_CAMERA,
	THREE_D_MAP_CONTROLS,
	THREE_D_MAP_FREECAM,
	THREE_D_MAP_RENDERER,
} from './threeDMapConstants';
import {
	createTerrainSignature,
	useVoxelTerrainGeometryWorker,
} from './Terrain/hooks/useVoxelTerrainGeometryWorker';
import { useTerrainMeshes } from './Terrain/hooks/useTerrainMeshes';
import { useTerrainEnvironment } from './Terrain/hooks/useTerrainEnvironment';
import {
	useMapSceneCore,
	type MapSceneController,
	type MapSceneControllerContext,
} from './Terrain/hooks/useMapSceneCore';

export type CameraPreference = 'ortho' | 'perspective' | 'freecam';

// Map tuning for the shared CameraRig. The per-terrain ortho framing, pan
// limits and shadow camera are still driven by the effects below; this only
// covers what the rig owns (cameras, controls, freecam).
const MAP_CAMERA_RIG_CONFIG: CameraRigConfig = {
	ortho: {
		near: THREE_D_MAP_RENDERER.CAMERA_NEAR,
		far: THREE_D_MAP_RENDERER.CAMERA_FAR,
		initialHalfSize: THREE_D_MAP_CONTROLS.MIN_PAN_LIMIT_RADIUS,
		distanceMultiplier: THREE_D_MAP_CAMERA.DISTANCE_MULTIPLIER,
		framing: {
			floor: 0,
			diagonalMultiplier: THREE_D_MAP_CAMERA.FRAMING_MULTIPLIER,
			heightMultiplier: 0,
		},
	},
	perspective: {
		fov: THREE_D_MAP_CAMERA.PERSPECTIVE_FOV,
		near: THREE_D_MAP_RENDERER.CAMERA_NEAR,
		far: THREE_D_MAP_RENDERER.CAMERA_FAR,
	},
	controls: {
		dampingFactor: THREE_D_MAP_CONTROLS.DAMPING_FACTOR,
		minZoom: THREE_D_MAP_CONTROLS.MIN_ZOOM,
		maxZoom: THREE_D_MAP_CONTROLS.MAX_ZOOM,
	},
	freecam: {
		baseMoveSpeed: THREE_D_MAP_FREECAM.MOVE_SPEED,
		minSpeedMult: 0.15,
		maxSpeedMult: 6,
		speedStep: 1.15,
		initialDistanceMultiplier: THREE_D_MAP_CAMERA.PERSPECTIVE_DISTANCE_MULTIPLIER,
	},
};

interface ThreeDMapProps {
	terrain?: VoxelTerrain | null;
	characters?: Character[];
	entities?: Entity[];
	xRayActors?: boolean;
	cameraPreference?: CameraPreference;
	onReady?: () => void;
}

interface ThreeDMapCameraState {
	position: THREE.Vector3;
	target: THREE.Vector3;
	cursor: THREE.Vector3;
	zoom: number;
}

function getPanLimitRadius(width: number, length: number, maxElevation: number): number {
	const footprintRadius = Math.sqrt(width * width + length * length) / 2;
	return Math.max(
		THREE_D_MAP_CONTROLS.MIN_PAN_LIMIT_RADIUS,
		footprintRadius +
		maxElevation * THREE_D_MAP_CONTROLS.PAN_LIMIT_ELEVATION_SCALE +
		THREE_D_MAP_CONTROLS.PAN_LIMIT_PADDING
	);
}

function findSelectedActor(
	selectedActor: { id: string; kind: "character" | "entity" } | null,
	characters: Character[],
	entities: Entity[]
): Character | Entity | null {
	if (!selectedActor) return null;

	if (selectedActor.kind === "character") {
		return characters.find((character) => character.Id === selectedActor.id) ?? null;
	}

	return entities.find((entity) => entity.Id === selectedActor.id) ?? null;
}

export default function ThreeDMap({
	terrain,
	characters = [],
	entities = [],
	xRayActors = false,
	cameraPreference = 'ortho',
	onReady,
}: ThreeDMapProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const cameraStateRef = useRef<ThreeDMapCameraState | null>(null);
	// Keep a stable ref to onReady so the terrain/scene effects don't need it as a dep.
	const onReadyRef = useRef(onReady);
	useEffect(() => { onReadyRef.current = onReady; });
	const rigRef = useRef<CameraRig | null>(null);
	const directionalLightRef = useRef<THREE.DirectionalLight | null>(null);
	const hasFramedTerrainRef = useRef(false);
	const context = useQuestContext();
	const { actionService } = useActionService();
	const { canAccessActor } = usePeerTracking();
	const {
		selectedActor,
		hoveredTile,
		selectActor,
		toggleActorSelection,
		clearSelection,
		updateHoveredTile,
	} = useMapState();
	const activeStickers = useActiveStickers();
	const { pings: activePings } = useActivePings();
	const liveActorPoses = useLiveActorPoseOverrides(terrain, characters, entities);
	const lastPingTimeRef = useRef(0);
	const performanceModeRef = useRef(AppSettingActions.getPerformanceMode(context));
	const performanceMode = performanceModeRef.current;

	// The tactical view's camera controller: a CameraRig (ortho isometric +
	// perspective + freecam). The shared core (useMapSceneCore) owns the
	// renderer/scene/lights/post-processing/pre-warm/RAF/resize/stats/teardown;
	// this only builds the rig, drives it per-frame, and saves camera state on
	// teardown so a remount reframes to the same view.
	const createCameraRigController = (
		ctx: MapSceneControllerContext
	): MapSceneController => {
		const { renderer, container, setActiveCamera } = ctx;
		const aspect = (container.clientWidth || 1) / (container.clientHeight || 1);
		const rig = new CameraRig(renderer.domElement, aspect, MAP_CAMERA_RIG_CONFIG, {
			onActiveCameraChange: (cam) => setActiveCamera(cam),
		});
		rigRef.current = rig;
		const orthoCamera = rig.orthoCamera;
		const controls = rig.controls;
		controls.maxTargetRadius = THREE_D_MAP_CONTROLS.MIN_PAN_LIMIT_RADIUS;
		rig.resize(container.clientWidth || 1, container.clientHeight || 1);
		// Freecam input (right-hold to look, WASD/QE to fly, scroll for speed) is
		// owned by the rig; it gates on the rig's own mode internally.
		rig.attachInput();

		return {
			camera: orthoCamera,
			// Freecam movement while flying, otherwise damped orbit.
			onFrame: (_now, dt) => rig.update(dt),
			onResize: (width, height) => rig.resize(width, height),
			dispose: () => {
				cameraStateRef.current = {
					position: orthoCamera.position.clone(),
					target: controls.target.clone(),
					cursor: controls.cursor.clone(),
					zoom: orthoCamera.zoom,
				};
				// Detaches freecam input and disposes both controls.
				rig.dispose();
				rigRef.current = null;
			},
		};
	};

	const { sceneResources, requestResize } = useMapSceneCore(containerRef, {
		performanceMode,
		movementHighlightVariants: true,
		directionalLightRef,
		createController: createCameraRigController,
		triangleStatsWidth: "110px",
		formatTriangleStats: (info) => {
			const tris = info.render.triangles.toLocaleString();
			const draws = info.render.calls.toLocaleString();
			const geoms = info.memory.geometries.toLocaleString();
			const texs = info.memory.textures.toLocaleString();
			const progs = (info.programs?.length ?? 0).toLocaleString();
			return `TRIS ${tris}\nDRAW ${draws}\nGEOM ${geoms}\nTEX  ${texs}\nPROG ${progs}`;
		},
		maxDeltaSeconds: 0.1,
	});

	const isDM = context.User.Role === "dm";
	const imageService = (actionService as any)?.imageService ?? null;
	const campaign = CampaignActions.getActiveCampaign(context);
	const selectedActorObject = useMemo(
		() => findSelectedActor(selectedActor, characters, entities),
		[selectedActor, characters, entities]
	);
	const canControlSelected = useMemo(
		() => (selectedActor ? canAccessActor(selectedActor.id) : false),
		[selectedActor, canAccessActor]
	);
	const isCombatActive = campaign.GameState.CombatState?.isActive ?? false;
	const pingActiveActorId =
		context.User.Role === "player"
			? context.User.SelectedCharacters?.[campaign.RoomCode]
			: (context.User.ImpersonatedActors ?? {})[campaign.RoomCode];
	const restrictMovementToRange =
		context.User.Role === "player" &&
		(campaign.Settings.MovementSettings?.restrictPlayerMovementToRange ?? false);
	const preserveFlyingHeightOnTileMove =
		AppSettingActions.getPreserveFlyingHeightOnTileMove(context);
	// Resolve cutout image IDs from the active campaign once per render so
	// descriptors and signatures can both consult the same source of truth.
	const cutoutImageIds = useMemo(() => {
		const ids = new Set<string>();
		for (const image of campaign.Images ?? []) {
			if (image.Cutout) ids.add(image.Id);
		}
		return ids;
	}, [campaign]);
	const terrainSignature = useMemo(() => createTerrainSignature(terrain), [terrain]);
	const terrainIndex = useMemo(
		() => (terrain ? getVoxelTerrainIndex(terrain) : null),
		// terrainSignature is the value-equal identity for the voxel terrain.
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[terrainSignature]
	);
	const terrainGeometry = useVoxelTerrainGeometryWorker(
		terrain,
		terrainSignature,
		sceneResources !== null
	);
	// Memo deps read primitives from Position/TurnStartPosition rather than the
	// actor reference. Move actions replace Position with a new object but
	// keep the actor reference stable, which previously left this BFS stale --
	// e.g. dragging a flier's height up and then click-to-moving them
	// would commit at the OLD h because the cached movement range still had
	// tile.h values from before the height change.
	const selectedActorPositionX = selectedActorObject?.Position.x;
	const selectedActorPositionY = selectedActorObject?.Position.y;
	const selectedActorPositionH = selectedActorObject?.Position.h;
	const selectedActorTurnStartX = selectedActorObject?.TurnStartPosition?.x;
	const selectedActorTurnStartY = selectedActorObject?.TurnStartPosition?.y;
	const selectedActorTurnStartH = selectedActorObject?.TurnStartPosition?.h;
	const selectedActorMoveSpeed = selectedActorObject?.MoveSpeed;
	const selectedActorCanFly = selectedActorObject?.CanFly;
	const movementRange = useMemo(() => {
		if (!terrain || !selectedActorObject || !canControlSelected) return [];

		return calculateVoxelMovementRange(
			terrain,
			selectedActorObject.Position,
			selectedActorMoveSpeed ?? ACTOR_TOKEN_DESCRIPTOR_DEFAULTS.MOVE_SPEED,
			selectedActorCanFly ?? false,
			campaign.Settings.MovementSettings
		).tiles;
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [
		terrain,
		canControlSelected,
		campaign.Settings.MovementSettings,
		selectedActorPositionX,
		selectedActorPositionY,
		selectedActorPositionH,
		selectedActorMoveSpeed,
		selectedActorCanFly,
	]);
	const remainingMovementRange = useMemo(() => {
		if (!terrain || !selectedActorObject || !canControlSelected) return null;
		if (!isCombatActive) return null;

		return calculateVoxelRemainingMovementRange(
			terrain,
			selectedActorObject.Position,
			selectedActorObject.TurnStartPosition,
			selectedActorMoveSpeed ?? ACTOR_TOKEN_DESCRIPTOR_DEFAULTS.MOVE_SPEED,
			selectedActorCanFly ?? false,
			campaign.Settings.MovementSettings
		)?.tiles ?? null;
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [
		terrain,
		canControlSelected,
		isCombatActive,
		campaign.Settings.MovementSettings,
		selectedActorPositionX,
		selectedActorPositionY,
		selectedActorPositionH,
		selectedActorTurnStartX,
		selectedActorTurnStartY,
		selectedActorTurnStartH,
		selectedActorMoveSpeed,
		selectedActorCanFly,
	]);

	const handleActorClick = useCallback(
		(actor: { id: string; kind: "character" | "entity"; moveSpeed: number }) => {
			toggleActorSelection(actor);
		},
		[toggleActorSelection]
	);

	const handleActorSelect = useCallback(
		(actor: { id: string; kind: "character" | "entity"; moveSpeed: number }) => {
			selectActor(actor);
		},
		[selectActor]
	);

	const handleMoveSelectedActor = useCallback(
		(position: { x: number; y: number; h: number }) => {
			if (!selectedActor || !actionService) return;

			if (selectedActor.kind === "character") {
				actionService.execute("character:move", {
					characterId: selectedActor.id,
					position,
				});
			} else {
				actionService.execute("entity:move", {
					entityId: selectedActor.id,
					position,
				});
			}

			updateHoveredTile(null);
			clearSelection();
		},
		[selectedActor, actionService, updateHoveredTile, clearSelection]
	);

	const handlePingTile = useCallback(
		(tile: { x: number; y: number; h: number }) => {
			if (!actionService) return;
			const now = Date.now();
			if (now - lastPingTimeRef.current < PING_DURATION_MS) return;

			actionService.execute("ping:create", {
				x: tile.x,
				y: tile.y,
				h: tile.h,
				actorId: pingActiveActorId,
			});
			lastPingTimeRef.current = now;
		},
		[actionService, pingActiveActorId]
	);

	const canControlActor = useCallback(
		(actor: { id: string; kind: "character" | "entity" }) =>
			canAccessActor(actor.id),
		[canAccessActor]
	);

	const handleActorDragEnd = useCallback(
		(
			actor: { id: string; kind: "character" | "entity"; moveSpeed: number },
			position: { x: number; y: number; h: number }
		) => {
			if (!actionService) return;

			selectActor(actor);
			if (actor.kind === "character") {
				actionService.execute("character:move", {
					characterId: actor.id,
					position,
				});
			} else {
				actionService.execute("entity:move", {
					entityId: actor.id,
					position,
				});
			}

			updateHoveredTile(null);
		},
		[actionService, selectActor, updateHoveredTile]
	);

	// Per-terrain camera framing + pan limits (the rig/scene bootstrap itself lives
	// in useMapSceneCore above). Light/shadow bounds moved to useTerrainEnvironment.
	useEffect(() => {
		if (!sceneResources) return;
		const container = containerRef.current;
		const rig = rigRef.current;
		if (!container || !rig) return;
		if (!terrain || getVoxelCount(terrain.Voxels) === 0) return;

		const controls = rig.controls;
		const orthoCamera = rig.orthoCamera;
		const perspCamera = rig.perspectiveCamera;

		const W = terrain.Width;
		const L = terrain.Length;
		const maxSurfaceHeight = getMaxVoxelSurfaceHeight(terrain);
		const terrainCenterY = (maxSurfaceHeight - 1) / 2;
		const halfSize = (W + L) / Math.SQRT2 / 2 * THREE_D_MAP_CAMERA.FRAMING_MULTIPLIER;
		// Directional light + shadow camera bounds live in useTerrainEnvironment.

		// Let the rig know the terrain extents so freecam entry framing is sized correctly.
		rig.setTerrain({ width: W, length: L, height: maxSurfaceHeight });

		const aspect = (container.clientWidth || 1) / (container.clientHeight || 1);
		// Always reframe the ortho camera (it's the canonical reference for halfSize).
		orthoCamera.left = -halfSize * aspect;
		orthoCamera.right = halfSize * aspect;
		orthoCamera.top = halfSize;
		orthoCamera.bottom = -halfSize;
		orthoCamera.updateProjectionMatrix();
		// Keep the perspective camera's aspect in sync.
		perspCamera.aspect = aspect;
		perspCamera.updateProjectionMatrix();

		controls.cursor.set(0, terrainCenterY, 0);
		controls.maxTargetRadius = getPanLimitRadius(W, L, maxSurfaceHeight);
		if (!hasFramedTerrainRef.current) {
			const previousCameraState = cameraStateRef.current;
			const camDist = halfSize * THREE_D_MAP_CAMERA.DISTANCE_MULTIPLIER;
			if (previousCameraState) {
				orthoCamera.position.copy(previousCameraState.position);
				orthoCamera.zoom = THREE.MathUtils.clamp(
					previousCameraState.zoom,
					controls.minZoom,
					controls.maxZoom
				);
				controls.target.copy(previousCameraState.target);
				controls.cursor.copy(previousCameraState.cursor);
			} else {
				orthoCamera.position.set(camDist, camDist, camDist);
				controls.target.set(0, terrainCenterY, 0);
			}
			orthoCamera.updateProjectionMatrix();
			controls.update();
			hasFramedTerrainRef.current = true;
		}

	}, [sceneResources, terrainSignature]);

	useEffect(() => {
		if (!sceneResources) return;
		const rig = rigRef.current;
		if (!rig) return;

		// The rig swaps the active camera, rebinds controls, positions the
		// perspective entry framing, and fires onActiveCameraChange (which updates
		// sceneResources.camera and the post-processing camera).
		rig.setMode(cameraPreference);
		requestResize();
	}, [cameraPreference, sceneResources, requestResize]);

	// Terrain meshes, AO, movement-highlight, and fog volume -- shared with the
	// first-person view via useTerrainMeshes. World view paints movement range,
	// so movementHighlight is enabled here.
	useTerrainMeshes(sceneResources, terrainGeometry, {
		movementHighlight: true,
		onReady: () => onReadyRef.current?.(),
		performanceMode,
	});

	// Background + directional-light/shadow-bounds -- shared with the first-person
	// view via useTerrainEnvironment. Runs as its own effect(s), independent of the
	// camera-framing effect above (requestShadowUpdate only sets a dirty flag).
	useTerrainEnvironment(sceneResources, terrain, terrainSignature, directionalLightRef);

	// Signal ready immediately when the scene is up but there is no terrain to build
	// (empty terrain or no terrain assigned), so the loading screen doesn't get stuck.
	useEffect(() => {
		if (!sceneResources) return;
		if (terrain && getVoxelCount(terrain.Voxels) > 0) return;
		onReadyRef.current?.();
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [sceneResources, terrain?.Id]);

	return (
		<div className="relative w-full h-full">
			<div ref={containerRef} className="w-full h-full" />
			{sceneResources && terrain && terrainIndex && getVoxelCount(terrain.Voxels) > 0 && (
				<>
					<ThreeDActorLayer
						resources={sceneResources}
						characters={characters}
						entities={entities}
						cutoutImageIds={cutoutImageIds}
						selectedActor={selectedActor}
						terrain={terrain}
						terrainIndex={terrainIndex}
						isDM={isDM}
						xRayActors={xRayActors}
						imageService={imageService}
						liveActorPoses={liveActorPoses}
						onActorClick={handleActorClick}
						onActorSelect={handleActorSelect}
						canControlActor={canControlActor}
						onActorDragEnd={handleActorDragEnd}
					/>
					<ThreeDMovementLayer
						resources={sceneResources}
						terrain={terrain}
						terrainIndex={terrainIndex}
						characters={characters}
						entities={entities}
						selectedActor={selectedActor}
						selectedActorObject={selectedActorObject}
						canControlSelected={canControlSelected}
						movementRange={movementRange}
						remainingMovementRange={remainingMovementRange}
						hoveredTile={hoveredTile}
						restrictMovementToRange={restrictMovementToRange}
						preserveFlyingHeightOnTileMove={preserveFlyingHeightOnTileMove}
						isCombatActive={isCombatActive}
						onHoveredTileChange={updateHoveredTile}
						onMoveSelectedActor={handleMoveSelectedActor}
					/>
					<ThreeDStickerLayer
						resources={sceneResources}
						terrain={terrain}
						characters={characters}
						entities={entities}
						cutoutImageIds={cutoutImageIds}
						activeStickers={activeStickers}
					/>
					<ThreeDPingLayer
						resources={sceneResources}
						terrain={terrain}
						terrainIndex={terrainIndex}
						activePings={activePings}
						onPingTile={handlePingTile}
					/>
				</>
			)}
		</div>
	);
}
