// components/Map/MapScene.tsx
//
// The single persistent map component. It owns ONE shared scene (renderer,
// lights, post-processing, terrain meshes) via useMapSceneCore + a
// MapModeController that hosts both camera systems. Switching camera modes swaps
// the active camera + input + mode-specific layers in place -- the WebGL stack,
// terrain geometry, materials and compiled shaders all stay resident, so there
// is no teardown/rebuild stutter on a mode switch.
//
// Two independent axes run through this file, and conflating them is what the
// prop names here are careful to avoid:
//   - cameraMode      -- which camera renders (and so whether world layers show)
//   - interactionMode -- who owns the pointer. Follow renders the world but
//                        takes the pointer while right click is held, so map
//                        input layers gate on THIS, and stay mounted regardless.
//
// World-pointer logic (movement range, click-to-move, actor drag, framing) lives
// here directly. <ControlledActorLocomotion> plugs one shared capsule runtime
// into MapModeController for First Person and Follow. The actor/sticker/ping
// layers are rendered once here and shared by every mode.
//
// Addon imports use three/examples/jsm/ -- see CLAUDE.md for why.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSnapshot } from 'valtio';
import * as THREE from 'three';
import type { CameraRigConfig } from '../../utils/camera/CameraRig';
import {
	isActorCameraMode,
	type MapCameraMode,
	type MapInteractionMode,
} from '../../utils/camera/CameraModes';
import type { Character } from '../../domains/Character/Character';
import type { Entity } from '../../domains/Entity/Entity';
import type { Position } from '../../domains/Actor/Actor';
import { useQuestContext } from '../../domains/Context/ContextProvider';
import { useActionService } from '../../services/Actions/ActionServiceProvider';
import { CampaignUtils } from '../../domains/Campaign/CampaignUtils';
import { AppSettingUtils } from '../../domains/AppSetting/AppSettingUtils';
import { getMaxVoxelSurfaceHeight } from '../../domains/VoxelTerrain/VoxelTerrainQueries';
import { getVoxelCount } from '../../utils/terrain/data/VoxelDataUtils';
import { getVoxelTerrainIndex } from '../../utils/terrain/data/VoxelTerrainIndex';
import { resolveTerrainVoxels } from '../../utils/terrain/data/terrainPayloadStore';
import {
	calculateVoxelMovementRange,
	calculateVoxelRemainingMovementRange,
	shouldRestrictPlayerMovementToRange,
} from '../../domains/VoxelTerrain/VoxelMovementUtilities';
import type { VoxelTerrain } from '../../domains/VoxelTerrain/VoxelTerrain';
import { useMapState } from './MapStateProvider';
import { ThreeDActorLayer } from './Actors3D/ThreeDActorLayer';
import { ThreeDMovementLayer } from './Movement3D/ThreeDMovementLayer';
import { ThreeDStickerLayer } from './Stickers3D/ThreeDStickerLayer';
import { ThreeDPingLayer } from './Pings3D/ThreeDPingLayer';
import { ThreeDTargetingLayer } from './Targeting/ThreeDTargetingLayer';
import { cancelTargeting, targetingStore } from './Targeting/targetingStore';
import { ThreeDTerrainLinkLayer, type TerrainLinkInteractionFocus } from './TerrainLinks3D/ThreeDTerrainLinkLayer';
import { ACTOR_TOKEN_DESCRIPTOR_DEFAULTS } from './Actors3D/actorTokenConstants';
import { useActiveStickers } from './hooks/useActiveStickers';
import { useActivePings } from './hooks/useActivePings';
import { PING_DURATION_MS } from '../../domains/Ping/Ping';
import { usePeerTracking } from '../../hooks/usePeerTracking';
import { findControlledActor } from './ActorCamera/actor';
import ControlledActorLocomotion from './ActorCamera/ControlledActorLocomotion';
import {
	THREE_D_MAP_CAMERA,
	THREE_D_MAP_CONTROLS,
	THREE_D_MAP_FOLLOW_CAMERA,
	THREE_D_MAP_FREECAM,
	THREE_D_MAP_RENDERER,
	MAP_FOLLOW_RIG_CONFIG,
} from './threeDMapConstants';
import type { TrackedActorVisual } from './Actors3D/actorTokenTypes';
import {
	createTerrainSignature,
	useVoxelTerrainGeometryWorker,
} from './Terrain/hooks/useVoxelTerrainGeometryWorker';
import { useTerrainMeshes } from './Terrain/hooks/useTerrainMeshes';
import { useTerrainEnvironment } from './Terrain/hooks/useTerrainEnvironment';
import { useSurroundingsPlane } from './Terrain/hooks/useSurroundingsPlane';
import {
	useMapSceneCore,
	type MapSceneController,
	type MapSceneControllerContext,
} from './Terrain/hooks/useMapSceneCore';
import { MapModeController } from './MapModeController';
import { useViewedTerrain } from './useViewedTerrain';
import { useHeroOcclusion } from './useHeroOcclusion';

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
		minDistanceMultiplier: THREE_D_MAP_CONTROLS.PERSPECTIVE_MIN_DISTANCE_MULTIPLIER,
		maxDistanceMultiplier: THREE_D_MAP_CONTROLS.PERSPECTIVE_MAX_DISTANCE_MULTIPLIER,
	},
	controls: {
		dampingFactor: THREE_D_MAP_CONTROLS.DAMPING_FACTOR,
		minZoom: THREE_D_MAP_CONTROLS.MIN_ZOOM,
		maxZoom: THREE_D_MAP_CONTROLS.MAX_ZOOM,
		minRotateSpeed: THREE_D_MAP_CONTROLS.ADAPTIVE_ROTATE_MIN_SPEED,
		maxRotateSpeed: THREE_D_MAP_CONTROLS.ADAPTIVE_ROTATE_MAX_SPEED,
	},
	freecam: {
		baseMoveSpeed: THREE_D_MAP_FREECAM.MOVE_SPEED,
		minSpeedMult: 0.15,
		maxSpeedMult: 6,
		speedStep: 1.15,
		initialDistanceMultiplier: THREE_D_MAP_CAMERA.PERSPECTIVE_DISTANCE_MULTIPLIER,
	},
	follow: MAP_FOLLOW_RIG_CONFIG,
};

interface MapSceneProps {
	terrain?: VoxelTerrain | null;
	characters?: Character[];
	entities?: Entity[];
	xRayActors?: boolean;
	showTerrainLinks?: boolean;
	cameraMode?: MapCameraMode;
	/** Pause the render loop while the map is mounted but not visible (e.g. the
	 *  DM has switched to another tab). Keeps the WebGL scene resident. */
	paused?: boolean;
	onReady?: () => void;
	onLeaveActorCamera?: () => void;
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
	showTerrainLinks = false,
	cameraMode = 'ortho',
	paused = false,
	onReady,
	onLeaveActorCamera,
}: MapSceneProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const controllerRef = useRef<MapModeController | null>(null);
	const directionalLightRef = useRef<THREE.DirectionalLight | null>(null);
	const hasFramedTerrainRef = useRef(false);
	const cameraModeInitializedRef = useRef(false);
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
	const { pings: allActivePings } = useActivePings();
	// Only show pings placed on the terrain currently being rendered.
	const activePings = useMemo(
		() => (terrain ? allActivePings.filter((p) => p.terrainId === terrain.Id) : []),
		[allActivePings, terrain]
	);
	const lastPingTimeRef = useRef(0);
	const performanceModeRef = useRef(AppSettingUtils.getPerformanceMode(context));
	const performanceMode = performanceModeRef.current;
	const [actorPointerLocked, setActorPointerLocked] = useState(false);

	// Which camera renders, and which scheme owns the pointer, are two different
	// questions -- Follow renders the world but takes the pointer while right
	// click is held. `isWorld` answers the first (are the world layers visible),
	// `interactionMode` the second (do map layers accept cursor input).
	const isWorld = cameraMode !== 'first-person';
	const usesActorLocomotion = isActorCameraMode(cameraMode);
	const interactionMode: MapInteractionMode =
		cameraMode === 'first-person' ||
		(cameraMode === 'follow' && actorPointerLocked)
			? 'actor-look'
			: 'world-pointer';
	const worldPointer = interactionMode === 'world-pointer';
	const handleTrackedActorVisualChange = useCallback(
		(visual: TrackedActorVisual | null) => {
			controllerRef.current?.setFollowActorVisual(
				visual,
				THREE_D_MAP_FOLLOW_CAMERA.ANCHOR_HEIGHT_Y
			);
		},
		[]
	);

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
		// Through the rig rather than onto `controls` directly, so the value is
		// recorded and survives a follow excursion (follow releases the clamp).
		controller.rig.setOrthoPanLimit(THREE_D_MAP_CONTROLS.MIN_PAN_LIMIT_RADIUS);
		controller.onResize(container.clientWidth || 1, container.clientHeight || 1);
		return controller;
	};

	const { sceneResources, requestResize } = useMapSceneCore(containerRef, {
		performanceMode,
		directionalLightRef,
		createController,
		paused,
	});

	useEffect(() => {
		const controller = controllerRef.current;
		if (!sceneResources || !controller) return;
		return controller.subscribePointerLock(setActorPointerLocked);
	}, [sceneResources]);

	const isDM = context.User.Role === "dm";
	const imageService = actionService?.imageService ?? null;
	const campaign = CampaignUtils.getActiveCampaign(context);
	const { setViewedTerrain } = useViewedTerrain();
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

	// The actor a terrain link would move: the player's selected character, or the
	// DM's impersonated actor. Resolve from canonical GameState instead of the
	// rendered actor props so DM impersonation does not depend on the visible-actor
	// filter.
	const controlledActorForLinks = useMemo(() => {
		if (!pingActiveActorId) return null;
		const character = campaign.GameState.Characters.find((c) => c.Id === pingActiveActorId);
		if (character) {
			return { id: character.Id, kind: "character" as const, position: character.Position };
		}
		const entity = campaign.GameState.Entities.find((e) => e.Id === pingActiveActorId);
		if (entity) {
			return { id: entity.Id, kind: "entity" as const, position: entity.Position };
		}
		return null;
	}, [pingActiveActorId, campaign.GameState.Characters, campaign.GameState.Entities]);

	// Hero-occlusion cutout: fade terrain between the camera and the focused actor
	// so a token hidden behind geometry stays visible. Focus = the player's played
	// actor (SelectedCharacters), or the DM's inspector selection (selectedActor).
	const heroOcclusionEnabled = AppSettingUtils.getHeroOcclusionEnabled(context);
	const heroOcclusionRadius = AppSettingUtils.getHeroOcclusionRadius(context);
	const heroFocusActorId = isDM
		? selectedActor?.id ?? null
		: context.User.SelectedCharacters?.[campaign.RoomCode] ?? null;
	const heroFocusActor = useMemo(() => {
		if (!heroFocusActorId) return null;
		const character = campaign.GameState.Characters.find((c) => c.Id === heroFocusActorId);
		if (character) return { position: character.Position, size: character.Size ?? null };
		const entity = campaign.GameState.Entities.find((e) => e.Id === heroFocusActorId);
		if (entity) return { position: entity.Position, size: entity.Size ?? null };
		return null;
	}, [heroFocusActorId, campaign.GameState.Characters, campaign.GameState.Entities]);
	useHeroOcclusion({
		resources: sceneResources,
		terrain: terrain ?? null,
		focusedActorPosition: heroFocusActor?.position ?? null,
		focusedActorSize: heroFocusActor?.size ?? null,
		isWorld,
		enabled: heroOcclusionEnabled,
		radius: heroOcclusionRadius,
	});

	// Terrain id -> name, for the link's "leads to ___" hover/prompt label.
	const terrainNamesById = useMemo(() => {
		const map = new Map<string, string>();
		for (const t of campaign.VoxelTerrains) map.set(t.Id, t.Name);
		return map;
	}, [campaign.VoxelTerrains]);

	const [linkFocus, setLinkFocus] = useState<TerrainLinkInteractionFocus | null>(null);
	const liveActorRulesPositionRef = useRef<Position | null>(null);
	const getControlledLinkActorPosition = useCallback((): Position | null => {
		if (usesActorLocomotion && liveActorRulesPositionRef.current) {
			return liveActorRulesPositionRef.current;
		}
		return controlledActorForLinks?.position ?? null;
	}, [controlledActorForLinks, usesActorLocomotion]);
	const handleLiveActorRulesPositionChange = useCallback((position: Position | null) => {
		liveActorRulesPositionRef.current = position;
	}, []);
	useEffect(() => {
		if (!usesActorLocomotion) liveActorRulesPositionRef.current = null;
	}, [usesActorLocomotion]);
	const restrictMovementToRange =
		shouldRestrictPlayerMovementToRange(
			context.User.Role,
			isCombatActive,
			campaign.Settings.MovementSettings
		);
	const preserveFlyingHeightOnTileMove =
		AppSettingUtils.getPreserveFlyingHeightOnTileMove(context);

	// The controlled actor: the player's played character, or the DM's impersonated
	// actor. Drives BOTH first-person (whose standee is hidden while inside it) and
	// the follow camera's anchor -- resolved in either view mode, since follow lives
	// in the world view while first-person does not.
	//
	// Deliberately NOT heroFocusActorId above: that resolves to the DM's inspector
	// selection, so anchoring the camera to it would yank the view onto whatever
	// token the DM last clicked.
	const controlledActor = useMemo(
		() =>
			findControlledActor(
				isDM ? "dm" : "player",
				campaign.RoomCode,
				context.User.SelectedCharacters,
				context.User.ImpersonatedActors,
				characters,
				entities
			),
		[
			isDM,
			campaign.RoomCode,
			context.User.SelectedCharacters,
			context.User.ImpersonatedActors,
			characters,
			entities,
		]
	);
	const firstPersonActor = isWorld ? null : controlledActor;
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
	// DM terrain edits mutate the canonical terrain object in place before the
	// VoxelTerrains array is shallow-cloned. Derive primitive keys so this
	// persistent scene notices ContentHash/shape changes even when object identity
	// is unchanged. createTerrainSignature embeds the payload's content hash (not
	// the raw bytes) so the geometry/index caches still key on a precise
	// value-equal revision.
	const terrainShapeKey = terrain
		? [
			terrain.Id,
			terrain.Width,
			terrain.Length,
			terrain.Height,
			terrain.Resolution ?? 1,
		].join(":")
		: "";
	const terrainContentKey = terrain
		? `${terrainShapeKey}:${terrain.ContentHash ?? ""}`
		: "";
	const terrainSignature = useMemo(
		() => createTerrainSignature(terrain),
		[terrain, terrainContentKey]
	);
	// Identity that determines camera FRAMING: which terrain and its extents,
	// deliberately excluding voxel content. The framing reset must fire on a
	// terrain switch or resize but NOT on a content edit, otherwise every voxel
	// change (e.g. a synced DM edit) would snap the viewer's rotation/pan back to
	// the default isometric pose. (Zoom is on orthoCamera.zoom, which the reset
	// never touches, which is why only rotation/pan were resetting.)
	const terrainFramingKey = terrainShapeKey;
	const terrainVoxels = useMemo(
		() => (terrain ? resolveTerrainVoxels(terrain) : new Uint8Array(0)),
		// terrainSignature is the value-equal identity for the voxel terrain.
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[terrainSignature]
	);
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

			actionService.execute("actor:move", {
				actorId: selectedActor.id,
				position,
			});

			updateHoveredTile(null);
			clearSelection();
		},
		[selectedActor, actionService, updateHoveredTile, clearSelection]
	);

	// Using a terrain link is just a terrain-crossing move of the controlled actor
	// to the link's opposite anchor (the move handler honors the destination
	// terrainId and re-anchors the combat budget on a terrain change). For a player
	// this switches their selected character's terrain, so Main re-renders the new
	// map.
	const handleLinkTraverse = useCallback(
		(
			actor: { id: string; kind: "character" | "entity" },
			destination: { terrainId: string; x: number; y: number; h: number }
		) => {
			if (!actionService) return;
			if (!isWorld) {
				liveActorRulesPositionRef.current = destination;
			}
			actionService.execute("actor:move", {
				actorId: actor.id,
				position: destination,
			});
			if (isDM) {
				setViewedTerrain(destination.terrainId);
			}
			setLinkFocus(null);
		},
		[actionService, isDM, isWorld, setViewedTerrain]
	);

	const handleToggleLinkLocked = useCallback(
		(linkId: string, locked: boolean) => {
			if (!actionService || !isDM) return;
			actionService.execute("terrainLink:edit", {
				linkId,
				updates: { Locked: locked },
			});
			setLinkFocus(null);
		},
		[actionService, isDM]
	);

	const handlePingTile = useCallback(
		(tile: { x: number; y: number; h: number }) => {
			if (!actionService) return;
			const now = Date.now();
			if (now - lastPingTimeRef.current < PING_DURATION_MS) return;

			actionService.execute("ping:create", {
				terrainId: terrain?.Id ?? "",
				x: tile.x,
				y: tile.y,
				h: tile.h,
				actorId: pingActiveActorId,
			});
			lastPingTimeRef.current = now;
		},
		[actionService, pingActiveActorId, terrain]
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
			actionService.execute("actor:move", {
				actorId: actor.id,
				position,
			});

			updateHoveredTile(null);
		},
		[actionService, selectActor, updateHoveredTile]
	);

	// Reframe only when the terrain identity/extents change (switch or resize),
	// not on content edits -- so a synced voxel edit preserves the viewer's
	// rotation/pan/zoom. A view toggle never reframes (no remount), so pan/zoom is
	// also preserved across world <-> first-person switches.
	useEffect(() => {
		hasFramedTerrainRef.current = false;
	}, [terrainFramingKey]);

	// Per-terrain camera framing + pan limits. Light/shadow bounds live in
	// useTerrainEnvironment.
	useEffect(() => {
		const controller = controllerRef.current;
		if (!sceneResources || !controller) return;
		if (!terrain || getVoxelCount(terrainVoxels) === 0) return;

		// The rig owns the orthographic framing math (shared with the terrain
		// editor); we supply only the terrain extents and the map-specific pan-limit
		// radius. Passing the surface height as the framing height keeps the orbit
		// pivot at the terrain's vertical centre, and (since the map config's height
		// multiplier is 0) leaves the frustum half-size unchanged. Reframe
		// (reposition the camera) only on first framing so a synced content edit or a
		// resize preserves the viewer's pan/zoom/rotation.
		const maxSurfaceHeight = getMaxVoxelSurfaceHeight(terrain);
		const dims = {
			width: terrain.Width,
			length: terrain.Length,
			height: maxSurfaceHeight,
		};
		const framingOptions = {
			maxTargetRadius: getPanLimitRadius(terrain.Width, terrain.Length, maxSurfaceHeight),
		};
		if (!hasFramedTerrainRef.current) {
			controller.rig.frameOrtho(dims, framingOptions);
			hasFramedTerrainRef.current = true;
		} else {
			controller.rig.updateOrthoExtents(dims, framingOptions);
		}
	}, [sceneResources, terrainSignature]);

	// One public mode drives both the rig-owned world cameras and First Person.
	// The first application skips the transition because there is no previous
	// rendered pose to fly from.
	useEffect(() => {
		const controller = controllerRef.current;
		if (!sceneResources || !controller) return;
		const immediate = !cameraModeInitializedRef.current;
		cameraModeInitializedRef.current = true;
		controller.setCameraMode(cameraMode, immediate);
		requestResize();
	}, [sceneResources, cameraMode, requestResize]);

	// The Follow anchor is NOT computed here. ThreeDActorLayer registers the
	// followed token's rendered THREE.Group (handleTrackedActorVisualChange
	// above) and the controller reads its world transform every frame, which is
	// the only source that covers click-to-move animation, height dragging,
	// capsule movement, remote live poses and authoritative repositioning at
	// once. A second canonical-position anchor computed from the campaign state
	// would only ever be a frame-late duplicate of it -- and would silently
	// anchor to the wrong grid when the actor is on another terrain, since the
	// token (correctly) is not rendered at all in that case.

	// Terrain meshes, AO, movement-highlight, and fog volume. World view paints
	// movement range so movementHighlight is enabled.
	useTerrainMeshes(sceneResources, terrainGeometry, {
		movementHighlight: true,
		onReady: () => onReadyRef.current?.(),
		performanceMode,
	});

	// Background + directional-light/shadow-bounds.
	useTerrainEnvironment(sceneResources, terrain, terrainSignature, directionalLightRef);

	// Decorative surroundings plane (no-op unless configured on the terrain).
	// The occupancy snapshot drives the interior fill over open voxel columns;
	// until the first build lands it falls back to the plain outer ring.
	useSurroundingsPlane(
		sceneResources,
		terrain,
		terrainGeometry?.occupancy ?? null,
		performanceMode
	);

	// Signal ready immediately when the scene is up but there is no terrain to
	// build, so the loading screen doesn't get stuck.
	useEffect(() => {
		if (!sceneResources) return;
		if (terrain && getVoxelCount(terrainVoxels) > 0) return;
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
		sceneResources && terrain && terrainIndex && getVoxelCount(terrainVoxels) > 0;
	const controller = controllerRef.current;
	const { request: targetingRequest, hover: targetingHover } =
		useSnapshot(targetingStore);

	// Resolve the live hover into a human label for the targeting cue banner.
	let targetingHoverText: string | null = null;
	if (targetingRequest && targetingHover) {
		if (targetingHover.kind === "actor") {
			const hovered =
				visibleCharacters.find((c) => c.Id === targetingHover.actorId) ??
				visibleEntities.find((e) => e.Id === targetingHover.actorId);
			targetingHoverText = hovered?.Name ?? "actor";
		} else {
			targetingHoverText = `(${targetingHover.x}, ${targetingHover.y}, ${targetingHover.h})`;
		}
	}

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
						onActorClick={handleActorClick}
						onActorSelect={handleActorSelect}
						canControlActor={isWorld ? canControlActor : undefined}
						onActorDragEnd={isWorld ? handleActorDragEnd : undefined}
						interactionMode={interactionMode}
						trackedActor={
							cameraMode === 'follow' && controlledActor
								? { id: controlledActor.id, kind: controlledActor.kind }
								: null
						}
						onTrackedActorVisualChange={handleTrackedActorVisualChange}
						draggableHeightRange={draggableHeightRange}
					/>
					{/* Stays MOUNTED while Follow holds the pointer, and gates its input
					    on interactionMode instead: unmounting would tear down and rebuild
					    the highlight InstancedMesh on every right-click press. */}
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
							interactionMode={interactionMode}
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
						interactionMode={interactionMode}
					/>
					<ThreeDTargetingLayer
						resources={sceneResources}
						terrainIndex={terrainIndex}
						terrainId={terrain.Id}
						interactionMode={interactionMode}
						// Right click is the actor-look button in both actor camera
						// modes, so it must not double as "cancel targeting" there --
						// including in Follow while still unlocked.
						cancelWithRightClick={!usesActorLocomotion}
					/>
					<ThreeDTerrainLinkLayer
						resources={sceneResources}
						interactionMode={interactionMode}
						terrain={terrain}
						terrainIndex={terrainIndex}
						links={campaign.TerrainLinks}
						terrainNamesById={terrainNamesById}
						controlledActor={controlledActorForLinks}
						getControlledActorPosition={getControlledLinkActorPosition}
						isDM={isDM}
						showLinkMarkers={worldPointer && isDM && showTerrainLinks}
						onTraverse={handleLinkTraverse}
						onToggleLinkLocked={handleToggleLinkLocked}
						onFocusChange={setLinkFocus}
					/>
				</>
			)}
			{/* First-person aim reticle: while targeting, the crosshair at screen
			    centre is the aim point. Turns primary when it's over a valid target
			    (targetingHover set). World mode uses the cursor reticle instead. */}
			{targetingRequest && !worldPointer && (
				<div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center">
					<span
						className={`icon-[mdi--target] h-8 w-8 drop-shadow ${
							targetingHover ? "text-primary" : "text-base-content/70"
						}`}
					/>
				</div>
			)}
			{/* Item/skill targeting cue: shown while a use is waiting for a target.
			    Sits above the DM map toolbar (z-40) and clear of its top bar. */}
			{targetingRequest && (
				<div className="pointer-events-none absolute inset-x-0 top-16 z-50 flex justify-center">
					<div className="pointer-events-auto flex items-center gap-3 rounded-full bg-base-100/90 border border-base-300 px-4 py-2 text-sm font-semibold text-base-content shadow">
						<span className="icon-[mdi--target] h-5 w-5 text-primary" />
						<span>
							Pick a target for {targetingRequest.label}
							{targetingHoverText ? (
								<span className="text-primary"> · {targetingHoverText}</span>
							) : null}
							<span className="opacity-70"> — Esc to cancel</span>
						</span>
						<button
							type="button"
							className="btn btn-ghost btn-xs"
							onClick={() => cancelTargeting()}
						>
							Cancel
						</button>
					</div>
				</div>
			)}
			{/* World-view link hover tooltip: follows the cursor, reveals destination. */}
			{hasTerrain && worldPointer && linkFocus?.screen && (
				<div
					className="pointer-events-none fixed z-40 -translate-x-1/2 -translate-y-[140%] whitespace-nowrap rounded bg-base-100/90 border border-base-300 px-3 py-1.5 text-sm font-semibold text-base-content shadow"
					style={{ left: linkFocus.screen.x, top: linkFocus.screen.y }}
				>
					{linkFocus.authoring ? (
						<span className="flex items-center gap-1">
							<span
								className={`${
									linkFocus.locked
										? "icon-[mdi--lock]"
										: "icon-[mdi--lock-open-variant]"
								} h-3.5 w-3.5`}
							/>
							{linkFocus.destinationName
								? `To ${linkFocus.destinationName}`
								: "Terrain link"}
							<span className="opacity-70">
								- click to {linkFocus.locked ? "unlock" : "lock"}
							</span>
						</span>
					) : (
						<span className="flex items-center gap-1">
							<span className="icon-[mdi--link-variant] h-3.5 w-3.5" />
							{linkFocus.destinationName
								? `To ${linkFocus.destinationName}`
								: "Terrain link"}
							{linkFocus.usable && (
								<span className="opacity-70">- click to enter</span>
							)}
						</span>
					)}
				</div>
			)}
			{sceneResources && usesActorLocomotion && controller && (
				<ControlledActorLocomotion
					controller={controller}
					cameraMode={cameraMode}
					terrain={terrain ?? null}
					terrainIndex={terrainIndex}
					onUnavailable={onLeaveActorCamera}
					onLiveRulesPositionChange={handleLiveActorRulesPositionChange}
					linkFocus={linkFocus}
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
						<span className="text-sm opacity-70">{terrainGeometryError}</span>
						<div className="flex gap-2">
							<button className="btn btn-primary btn-sm" onClick={retryTerrainGeometry}>
								Retry
							</button>
							{!isWorld && onLeaveActorCamera && (
								<button className="btn btn-neutral btn-sm" onClick={onLeaveActorCamera}>
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
