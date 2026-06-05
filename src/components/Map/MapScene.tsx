// components/Map/MapScene.tsx
//
// The single persistent map component. It owns ONE shared scene (renderer,
// lights, post-processing, terrain meshes) via useMapSceneCore + a MapModeController
// that hosts both camera systems. Toggling between the world view and the
// first-person view swaps the active camera + input + mode-specific layers in
// place -- the WebGL stack, terrain geometry, materials and compiled shaders all
// stay resident, so there is no teardown/rebuild stutter on a view switch.
//
// World-view logic (movement range, click-to-move, actor drag, framing) lives
// here directly. First-person logic lives in <FirstPersonView>, which plugs its
// capsule simulation into the shared MapModeController. The actor/sticker/ping
// layers are rendered once here and shared by both modes.
//
// Addon imports use three/examples/jsm/ -- see CLAUDE.md for why.

import { useCallback, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { CameraRigConfig } from '../../utils/camera/CameraRig';
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
	shouldRestrictPlayerMovementToRange,
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
import { findFirstPersonActor } from './FirstPerson/actor';
import FirstPersonView from './FirstPerson/FirstPersonView';
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
import { MapModeController, type MapViewMode } from './MapModeController';

export type CameraPreference = 'ortho' | 'perspective' | 'freecam';

// Map tuning for the shared CameraRig (owned by MapModeController). Per-terrain
// ortho framing, pan limits and shadow camera are still driven by the effects
// below; this only covers what the rig owns (cameras, controls, freecam).
const MAP_CAMERA_RIG_CONFIG: CameraRigConfig = {
	ortho: {
		near: THREE_D_MAP_RENDERER.ORTHO_CAMERA_NEAR,
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

interface MapSceneProps {
	terrain?: VoxelTerrain | null;
	characters?: Character[];
	entities?: Entity[];
	xRayActors?: boolean;
	cameraPreference?: CameraPreference;
	viewMode?: MapViewMode;
	onReady?: () => void;
	onExitFirstPerson?: () => void;
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

export default function MapScene({
	terrain,
	characters = [],
	entities = [],
	xRayActors = false,
	cameraPreference = 'ortho',
	viewMode = 'world',
	onReady,
	onExitFirstPerson,
}: MapSceneProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const controllerRef = useRef<MapModeController | null>(null);
	const directionalLightRef = useRef<THREE.DirectionalLight | null>(null);
	const hasFramedTerrainRef = useRef(false);
	const viewModeInitializedRef = useRef(false);
	// Keep a stable ref to onReady so the terrain/scene effects don't need it as a dep.
	const onReadyRef = useRef(onReady);
	useEffect(() => { onReadyRef.current = onReady; });

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

	const isWorld = viewMode === 'world';

	// One MapModeController for the scene's lifetime. The shared core
	// (useMapSceneCore) owns renderer/scene/lights/post/pre-warm/RAF/resize/stats/
	// teardown; the controller hosts both camera systems and switches in place.
	const createController = (
		ctx: MapSceneControllerContext
	): MapSceneController => {
		const { renderer, container, setActiveCamera } = ctx;
		const aspect = (container.clientWidth || 1) / (container.clientHeight || 1);
		const controller = new MapModeController(
			renderer.domElement,
			aspect,
			MAP_CAMERA_RIG_CONFIG,
			setActiveCamera
		);
		controllerRef.current = controller;
		controller.rig.controls.maxTargetRadius = THREE_D_MAP_CONTROLS.MIN_PAN_LIMIT_RADIUS;
		controller.onResize(container.clientWidth || 1, container.clientHeight || 1);
		return controller;
	};

	const { sceneResources, requestResize } = useMapSceneCore(containerRef, {
		performanceMode,
		directionalLightRef,
		createController,
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
		shouldRestrictPlayerMovementToRange(
			context.User.Role,
			isCombatActive,
			campaign.Settings.MovementSettings
		);
	const preserveFlyingHeightOnTileMove =
		AppSettingActions.getPreserveFlyingHeightOnTileMove(context);

	// The first-person actor (used to hide the controlled actor's own standee in
	// the shared layer while in first-person mode).
	const firstPersonActor = useMemo(
		() =>
			isWorld
				? null
				: findFirstPersonActor(
						isDM ? "dm" : "player",
						campaign.RoomCode,
						context.User.SelectedCharacters,
						context.User.ImpersonatedActors,
						characters,
						entities
				  ),
		[
			isWorld,
			isDM,
			campaign.RoomCode,
			context.User.SelectedCharacters,
			context.User.ImpersonatedActors,
			characters,
			entities,
		]
	);
	const visibleCharacters = useMemo(
		() =>
			firstPersonActor?.kind === "character"
				? characters.filter((character) => character.Id !== firstPersonActor.id)
				: characters,
		[firstPersonActor?.id, firstPersonActor?.kind, characters]
	);
	const visibleEntities = useMemo(
		() =>
			firstPersonActor?.kind === "entity"
				? entities.filter((entity) => entity.Id !== firstPersonActor.id)
				: entities,
		[firstPersonActor?.id, firstPersonActor?.kind, entities]
	);

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
	const {
		geometry: terrainGeometry,
		error: terrainGeometryError,
		retry: retryTerrainGeometry,
	} = useVoxelTerrainGeometryWorker(
		terrain,
		terrainSignature,
		sceneResources !== null
	);

	// Memo deps read primitives from Position/TurnStartPosition rather than the
	// actor reference (move actions replace Position with a new object but keep
	// the actor reference stable). Movement range is world-view-only.
	const selectedActorPositionX = selectedActorObject?.Position.x;
	const selectedActorPositionY = selectedActorObject?.Position.y;
	const selectedActorPositionH = selectedActorObject?.Position.h;
	const selectedActorTurnStartX = selectedActorObject?.TurnStartPosition?.x;
	const selectedActorTurnStartY = selectedActorObject?.TurnStartPosition?.y;
	const selectedActorTurnStartH = selectedActorObject?.TurnStartPosition?.h;
	const selectedActorMoveSpeed = selectedActorObject?.MoveSpeed;
	const selectedActorCanFly = selectedActorObject?.CanFly;
	const movementRange = useMemo(() => {
		if (!isWorld || !terrain || !selectedActorObject || !canControlSelected) return [];

		return calculateVoxelMovementRange(
			terrain,
			selectedActorObject.Position,
			selectedActorMoveSpeed ?? ACTOR_TOKEN_DESCRIPTOR_DEFAULTS.MOVE_SPEED,
			selectedActorCanFly ?? false,
			campaign.Settings.MovementSettings
		).tiles;
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [
		isWorld,
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
		if (!isWorld || !terrain || !selectedActorObject || !canControlSelected) return null;
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
		isWorld,
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

	// Reachable rules-height span at the selected actor's own column, used to
	// clamp the flying height-drag ("ladder") when a player is restricted to
	// their remaining combat movement range. null = unrestricted (DM, setting
	// off, outside combat, or couldn't compute) -> the drag stays bounded only by
	// the terrain.
	const draggableHeightRange = useMemo(() => {
		if (!isWorld || !restrictMovementToRange || !selectedActorObject) return null;
		const range = remainingMovementRange;
		if (!range || range.length === 0) return null;
		const x = Math.round(selectedActorObject.Position.x);
		const y = Math.round(selectedActorObject.Position.y);
		let min = Infinity;
		let max = -Infinity;
		for (const tile of range) {
			if (tile.x !== x || tile.y !== y) continue;
			if (tile.h < min) min = tile.h;
			if (tile.h > max) max = tile.h;
		}
		return min === Infinity ? null : { min, max };
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [
		isWorld,
		restrictMovementToRange,
		isCombatActive,
		movementRange,
		remainingMovementRange,
		selectedActorPositionX,
		selectedActorPositionY,
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

	// Reframe once per terrain. A view toggle never reframes (no remount), so the
	// user's pan/zoom is preserved across world <-> first-person switches.
	useEffect(() => {
		hasFramedTerrainRef.current = false;
	}, [terrainSignature]);

	// Per-terrain camera framing + pan limits. Light/shadow bounds live in
	// useTerrainEnvironment.
	useEffect(() => {
		const controller = controllerRef.current;
		if (!sceneResources || !controller) return;
		const container = containerRef.current;
		if (!container) return;
		if (!terrain || getVoxelCount(terrain.Voxels) === 0) return;

		const rig = controller.rig;
		const controls = rig.controls;
		const orthoCamera = rig.orthoCamera;
		const perspCamera = rig.perspectiveCamera;

		const W = terrain.Width;
		const L = terrain.Length;
		const maxSurfaceHeight = getMaxVoxelSurfaceHeight(terrain);
		const terrainCenterY = (maxSurfaceHeight - 1) / 2;
		const halfSize = (W + L) / Math.SQRT2 / 2 * THREE_D_MAP_CAMERA.FRAMING_MULTIPLIER;

		// Let the rig know the terrain extents so freecam / perspective entry
		// framing (and the view tween's world endpoint) is sized correctly.
		controller.setTerrain({ width: W, length: L, height: maxSurfaceHeight });

		const aspect = (container.clientWidth || 1) / (container.clientHeight || 1);
		orthoCamera.left = -halfSize * aspect;
		orthoCamera.right = halfSize * aspect;
		orthoCamera.top = halfSize;
		orthoCamera.bottom = -halfSize;
		orthoCamera.updateProjectionMatrix();
		perspCamera.aspect = aspect;
		perspCamera.updateProjectionMatrix();

		controls.cursor.set(0, terrainCenterY, 0);
		controls.maxTargetRadius = getPanLimitRadius(W, L, maxSurfaceHeight);
		if (!hasFramedTerrainRef.current) {
			const camDist = halfSize * THREE_D_MAP_CAMERA.DISTANCE_MULTIPLIER;
			orthoCamera.position.set(camDist, camDist, camDist);
			controls.target.set(0, terrainCenterY, 0);
			orthoCamera.updateProjectionMatrix();
			controls.update();
			hasFramedTerrainRef.current = true;
		}
	}, [sceneResources, terrainSignature]);

	// Apply the world camera preference (ortho/perspective/freecam). Stored on the
	// controller and re-applied when returning from first-person.
	useEffect(() => {
		const controller = controllerRef.current;
		if (!sceneResources || !controller) return;
		controller.setWorldCameraPreference(cameraPreference);
		requestResize();
	}, [sceneResources, cameraPreference, requestResize]);

	// Drive the view-mode switch. The very first application (once the scene is
	// up) is immediate; subsequent toggles tween.
	useEffect(() => {
		const controller = controllerRef.current;
		if (!sceneResources || !controller) return;
		if (!viewModeInitializedRef.current) {
			viewModeInitializedRef.current = true;
			controller.setViewMode(viewMode, true);
		} else {
			controller.setViewMode(viewMode);
		}
	}, [sceneResources, viewMode]);

	// Terrain meshes, AO, movement-highlight, and fog volume. World view paints
	// movement range so movementHighlight is enabled.
	useTerrainMeshes(sceneResources, terrainGeometry, {
		movementHighlight: true,
		onReady: () => onReadyRef.current?.(),
		performanceMode,
	});

	// Background + directional-light/shadow-bounds.
	useTerrainEnvironment(sceneResources, terrain, terrainSignature, directionalLightRef);

	// Signal ready immediately when the scene is up but there is no terrain to
	// build, so the loading screen doesn't get stuck.
	useEffect(() => {
		if (!sceneResources) return;
		if (terrain && getVoxelCount(terrain.Voxels) > 0) return;
		onReadyRef.current?.();
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [sceneResources, terrain?.Id]);

	// A blocked WASM asset, CSP rule, or worker crash should not leave the outer
	// loading overlay spinning forever.
	useEffect(() => {
		if (!terrainGeometryError) return;
		onReadyRef.current?.();
	}, [terrainGeometryError]);

	const hasTerrain =
		sceneResources && terrain && terrainIndex && getVoxelCount(terrain.Voxels) > 0;
	const controller = controllerRef.current;

	return (
		<div className="relative w-full h-full">
			<div ref={containerRef} className="w-full h-full" />
			{hasTerrain && (
				<>
					<ThreeDActorLayer
						resources={sceneResources}
						characters={visibleCharacters}
						entities={visibleEntities}
						cutoutImageIds={cutoutImageIds}
						selectedActor={selectedActor}
						terrain={terrain}
						terrainIndex={terrainIndex}
						isDM={isDM}
						performanceMode={performanceMode}
						xRayActors={isWorld && xRayActors}
						imageService={imageService}
						liveActorPoses={liveActorPoses}
						onActorClick={handleActorClick}
						onActorSelect={handleActorSelect}
						canControlActor={isWorld ? canControlActor : undefined}
						onActorDragEnd={isWorld ? handleActorDragEnd : undefined}
						draggableHeightRange={draggableHeightRange}
					/>
					{isWorld && (
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
					)}
					<ThreeDStickerLayer
						resources={sceneResources}
						terrain={terrain}
						characters={visibleCharacters}
						entities={visibleEntities}
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
			{sceneResources && !isWorld && controller && (
				<FirstPersonView
					controller={controller}
					terrain={terrain ?? null}
					terrainIndex={terrainIndex}
					characters={characters}
					entities={entities}
					onExitFirstPerson={onExitFirstPerson}
				/>
			)}
			{terrainGeometryError && (
				<div
					className="absolute inset-0 z-40 flex items-center justify-center bg-base-200/95 px-6 text-base-content"
					role="alert"
				>
					<div className="flex max-w-lg flex-col items-center gap-3 text-center">
						<span className="icon-[mdi--alert-circle] h-12 w-12 text-error" />
						<span className="text-lg font-semibold">Terrain rendering failed</span>
						<span className="text-sm opacity-80">{terrainGeometryError}</span>
						<div className="flex gap-2">
							<button className="btn btn-primary btn-sm" onClick={retryTerrainGeometry}>
								Retry
							</button>
							{!isWorld && onExitFirstPerson && (
								<button className="btn btn-neutral btn-sm" onClick={onExitFirstPerson}>
									Exit first-person
								</button>
							)}
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
