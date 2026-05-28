// components/Map/3DMap.tsx
// Three.js voxel terrain renderer with orthographic isometric camera.
// Addon imports use three/examples/jsm/ -- see CLAUDE.md for why.
// MeshStandardMaterial not MeshLambertMaterial -- see CLAUDE.md for why.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import Stats from 'three/examples/jsm/libs/stats.module.js';
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
import type { ThreeDSceneResources } from './Actors3D/actorTokenTypes';
import { useActiveStickers } from './hooks/useActiveStickers';
import { useActivePings } from './hooks/useActivePings';
import { useLiveActorPoseOverrides } from './hooks/useLiveActorPoseOverrides';
import { PING_DURATION_MS } from '../../domains/Ping/Ping';
import { usePeerTracking } from '../../hooks/usePeerTracking';
import { getShadowCameraBounds } from './shadowCameraBounds';
import { createThreeDMapPostProcessing } from './mapPostProcessing';
import {
	applyVoxelTerrainBackground,
	applyVoxelTerrainDirectionalLight,
} from './terrainEnvironment';
import {
	THREE_D_MAP_CAMERA,
	THREE_D_MAP_CONTROLS,
	THREE_D_MAP_FREECAM,
	THREE_D_MAP_LIGHTING,
	THREE_D_MAP_RENDERER,
	THREE_D_MAP_SHADOW,
} from './threeDMapConstants';
import type { ThreeDMapPostProcessing } from './mapPostProcessing';
import {
	createTerrainSignature,
	useVoxelTerrainGeometryWorker,
} from './Terrain/hooks/useVoxelTerrainGeometryWorker';
import {
	createMovementHighlightTexture,
	createDummyTerrainGeometry,
	createPlaceholderVoxelAoTexture,
	createVoxelAoTexture,
	TERRAIN_MATERIAL_REGISTRY,
	type MovementHighlightTexture,
	type VoxelAoTexture,
} from './Terrain/materials';

export type CameraPreference = 'ortho' | 'perspective' | 'freecam';

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

interface TerrainRenderResources {
	meshes: THREE.Mesh[];
	geometries: THREE.BufferGeometry[];
	materials: THREE.MeshStandardMaterial[];
	movementHighlight: MovementHighlightTexture;
	voxelAo: VoxelAoTexture;
	animationFrameCallbacks: ((timeMs: number) => void)[];
}

function disposeTerrainResources(resources: TerrainRenderResources): void {
	for (const geo of resources.geometries) geo.dispose();
	for (const mat of resources.materials) mat.dispose();
	resources.movementHighlight.texture.dispose();
	resources.voxelAo.texture.dispose();
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
	const sceneResourcesRef = useRef<ThreeDSceneResources | null>(null);
	// Keep a stable ref to onReady so the terrain/scene effects don't need it as a dep.
	const onReadyRef = useRef(onReady);
	useEffect(() => { onReadyRef.current = onReady; });
	const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const statsRef = useRef<any>(null);
	const triangleStatsRef = useRef<HTMLDivElement | null>(null);
	const controlsRef = useRef<OrbitControls | null>(null);
	const orthoCameraRef = useRef<THREE.OrthographicCamera | null>(null);
	const perspCameraRef = useRef<THREE.PerspectiveCamera | null>(null);
	const pointerLockControlsRef = useRef<PointerLockControls | null>(null);
	const cameraPreferenceRef = useRef<CameraPreference>('ortho');
	const freecamKeysRef = useRef({ w: false, a: false, s: false, d: false });
	const postProcessingRef = useRef<ThreeDMapPostProcessing | null>(null);
	const updateCameraProjectionRef = useRef<(() => void) | null>(null);
	const directionalLightRef = useRef<THREE.DirectionalLight | null>(null);
	const terrainResourcesRef = useRef<TerrainRenderResources | null>(null);
	const warmGeometryRef = useRef<THREE.BufferGeometry | null>(null);
	const warmMeshesRef = useRef<THREE.Mesh[]>([]);
	const currentHalfSizeRef = useRef<number>(THREE_D_MAP_CONTROLS.MIN_PAN_LIMIT_RADIUS);
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
	const [sceneResources, setSceneResources] = useState<ThreeDSceneResources | null>(null);
	const activeStickers = useActiveStickers();
	const { pings: activePings } = useActivePings();
	const liveActorPoses = useLiveActorPoseOverrides(terrain, characters, entities);
	const lastPingTimeRef = useRef(0);
	const performanceModeRef = useRef(AppSettingActions.getPerformanceMode(context));
	const performanceMode = performanceModeRef.current;
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
	const terrainLighting = terrain?.Lighting;
	const terrainBackgroundColor = terrain?.Background.Color;
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

	// Backtick (`) shortcut to toggle the Stats.js overlay
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === '`' && !e.ctrlKey && !e.metaKey && !e.altKey) {
				const stats = statsRef.current;
				if (!stats) return;
				const nextDisplay = stats.dom.style.display === 'none' ? 'block' : 'none';
				stats.dom.style.display = nextDisplay;
				if (triangleStatsRef.current) {
					triangleStatsRef.current.style.display = nextDisplay;
				}
			}
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, []);

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

	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;

		const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
		renderer.setPixelRatio(
			Math.min(
				window.devicePixelRatio,
				performanceMode
					? THREE_D_MAP_RENDERER.PERFORMANCE_MAX_PIXEL_RATIO
					: THREE_D_MAP_RENDERER.MAX_PIXEL_RATIO
			)
		);
		renderer.setSize(container.clientWidth || 1, container.clientHeight || 1);
		renderer.outputColorSpace = THREE.SRGBColorSpace;
		renderer.info.autoReset = false;
		renderer.shadowMap.enabled = true;
		renderer.shadowMap.autoUpdate = false;
		renderer.shadowMap.needsUpdate = true;
		renderer.shadowMap.type = THREE.PCFSoftShadowMap;
		container.appendChild(renderer.domElement);
		rendererRef.current = renderer;

		const stats = new Stats();
		stats.showPanel(0); // 0: FPS, 1: ms/frame, 2: MB -- click to cycle
		stats.dom.style.position = 'absolute';
		stats.dom.style.top = '0px';
		stats.dom.style.left = '0px';
		stats.dom.style.display = 'none';
		container.appendChild(stats.dom);
		statsRef.current = stats;

		const triangleStats = document.createElement('div');
		triangleStats.style.position = 'absolute';
		triangleStats.style.top = '48px';
		triangleStats.style.left = '0px';
		triangleStats.style.width = '110px';
		triangleStats.style.boxSizing = 'border-box';
		triangleStats.style.padding = '2px 3px';
		triangleStats.style.background = 'rgba(0, 0, 0, 0.8)';
		triangleStats.style.color = '#0ff';
		triangleStats.style.font = 'bold 9px Helvetica, Arial, sans-serif';
		triangleStats.style.lineHeight = '11px';
		triangleStats.style.whiteSpace = 'pre';
		triangleStats.style.pointerEvents = 'none';
		triangleStats.style.display = 'none';
		triangleStats.textContent = 'TRIS 0\nDRAW 0\nGEOM 0\nTEX  0\nPROG 0';
		container.appendChild(triangleStats);
		triangleStatsRef.current = triangleStats;

		const scene = new THREE.Scene();
		scene.background = null;

		const aspect = (container.clientWidth || 1) / (container.clientHeight || 1);
		const initialHalfSize = currentHalfSizeRef.current;
		const orthoCamera = new THREE.OrthographicCamera(
			-initialHalfSize * aspect,
			initialHalfSize * aspect,
			initialHalfSize,
			-initialHalfSize,
			THREE_D_MAP_RENDERER.CAMERA_NEAR,
			THREE_D_MAP_RENDERER.CAMERA_FAR
		);
		const camDist = initialHalfSize * THREE_D_MAP_CAMERA.DISTANCE_MULTIPLIER;
		orthoCamera.position.set(camDist, camDist, camDist);
		orthoCameraRef.current = orthoCamera;

		const perspCamera = new THREE.PerspectiveCamera(
			THREE_D_MAP_CAMERA.PERSPECTIVE_FOV,
			aspect,
			THREE_D_MAP_RENDERER.CAMERA_NEAR,
			THREE_D_MAP_RENDERER.CAMERA_FAR
		);
		perspCamera.position.set(camDist, camDist, camDist);
		perspCameraRef.current = perspCamera;

		const camera = orthoCamera;

		const hemi = new THREE.HemisphereLight(
			THREE_D_MAP_LIGHTING.HEMISPHERE_SKY_COLOR,
			THREE_D_MAP_LIGHTING.HEMISPHERE_GROUND_COLOR,
			Math.PI * THREE_D_MAP_LIGHTING.HEMISPHERE_INTENSITY_MULTIPLIER
		);
		scene.add(hemi);

		const dirLight = new THREE.DirectionalLight(
			THREE_D_MAP_LIGHTING.DIRECTIONAL_COLOR,
			Math.PI * THREE_D_MAP_LIGHTING.DIRECTIONAL_INTENSITY_MULTIPLIER
		);
		dirLight.castShadow = true;
		const shadowMapSize = performanceMode
			? THREE_D_MAP_SHADOW.PERFORMANCE_MAP_SIZE
			: THREE_D_MAP_SHADOW.MAP_SIZE;
		dirLight.shadow.mapSize.set(shadowMapSize, shadowMapSize);
		dirLight.shadow.bias = THREE_D_MAP_SHADOW.BIAS;
		dirLight.shadow.normalBias = THREE_D_MAP_SHADOW.NORMAL_BIAS;
		scene.add(dirLight);
		scene.add(dirLight.target);
		directionalLightRef.current = dirLight;

		const controls = new OrbitControls(camera, renderer.domElement);
		controls.enableDamping = true;
		controls.dampingFactor = THREE_D_MAP_CONTROLS.DAMPING_FACTOR;
		controls.minZoom = THREE_D_MAP_CONTROLS.MIN_ZOOM;
		controls.maxZoom = THREE_D_MAP_CONTROLS.MAX_ZOOM;
		controls.maxTargetRadius = THREE_D_MAP_CONTROLS.MIN_PAN_LIMIT_RADIUS;
		controls.update();
		controlsRef.current = controls;

		const plc = new PointerLockControls(perspCamera, renderer.domElement);
		pointerLockControlsRef.current = plc;

		const onFreecamMouseDown = (e: MouseEvent) => {
			if (cameraPreferenceRef.current === 'freecam' && e.button === 2) {
				e.preventDefault();
				plc.lock();
			}
		};
		const onFreecamMouseUp = (e: MouseEvent) => {
			if (cameraPreferenceRef.current === 'freecam' && e.button === 2) {
				plc.unlock();
			}
		};
		const onFreecamContextMenu = (e: Event) => {
			if (cameraPreferenceRef.current === 'freecam') e.preventDefault();
		};
		renderer.domElement.addEventListener('mousedown', onFreecamMouseDown);
		renderer.domElement.addEventListener('mouseup', onFreecamMouseUp);
		renderer.domElement.addEventListener('contextmenu', onFreecamContextMenu);

		const onFreecamKeyDown = (e: KeyboardEvent) => {
			if (cameraPreferenceRef.current !== 'freecam') return;
			switch (e.code) {
				case 'KeyW': freecamKeysRef.current.w = true; break;
				case 'KeyA': freecamKeysRef.current.a = true; break;
				case 'KeyS': freecamKeysRef.current.s = true; break;
				case 'KeyD': freecamKeysRef.current.d = true; break;
			}
		};
		const onFreecamKeyUp = (e: KeyboardEvent) => {
			switch (e.code) {
				case 'KeyW': freecamKeysRef.current.w = false; break;
				case 'KeyA': freecamKeysRef.current.a = false; break;
				case 'KeyS': freecamKeysRef.current.s = false; break;
				case 'KeyD': freecamKeysRef.current.d = false; break;
			}
		};
		window.addEventListener('keydown', onFreecamKeyDown);
		window.addEventListener('keyup', onFreecamKeyUp);

		const postProcessing = createThreeDMapPostProcessing(renderer, scene, camera, {
			performanceMode,
		});
		postProcessingRef.current = postProcessing;

		const movementHighlight = createMovementHighlightTexture(1, 1, 1);
		const resources: ThreeDSceneResources = {
			scene,
			camera,
			domElement: renderer.domElement,
			occlusionTargets: [],
			movementHighlight,
			animationCallbacks: new Set(),
			requestShadowUpdate: () => {
				renderer.shadowMap.needsUpdate = true;
			},
			actorPickTargets: [],
			dragState: { active: false },
		};

		// Pre-warm: compile every registered shader variant before exposing the
		// scene to the rest of the app, so no stutter when terrain first appears.
		let cancelled = false;
		void (async () => {
			const dummyGeo = createDummyTerrainGeometry();
			warmGeometryRef.current = dummyGeo;
			const dummyHighlight = createMovementHighlightTexture(1, 1, 1);
			const dummyVoxelAo = createPlaceholderVoxelAoTexture();
			const warmMeshes: THREE.Mesh[] = [];
			for (const [, factory] of TERRAIN_MATERIAL_REGISTRY) {
				for (const acceptsMovementHighlight of [false, true]) {
					const result = factory({
						acceptsMovementHighlight,
						performanceMode,
						movementHighlight: acceptsMovementHighlight ? dummyHighlight : undefined,
						voxelAo: dummyVoxelAo,
					});
					const warmMesh = new THREE.Mesh(dummyGeo, result.material);
					scene.add(warmMesh);
					warmMeshes.push(warmMesh);
				}
			}
			warmMeshesRef.current = warmMeshes;
			await renderer.compileAsync(scene, camera);
			if (cancelled) {
				dummyHighlight.texture.dispose();
				dummyVoxelAo.texture.dispose();
				return;
			}
			for (const warmMesh of warmMeshes) scene.remove(warmMesh);
			warmMeshesRef.current = [];
			dummyHighlight.texture.dispose();
			dummyVoxelAo.texture.dispose();
			// Warm geometry and materials are intentionally kept alive (not disposed)
			// so the compiled WebGL programs remain resident in the driver cache.
			sceneResourcesRef.current = resources;
			setSceneResources(resources);
		})();

		// Pre-allocated vectors for freecam movement to avoid per-frame allocations.
		const _freecamDir = new THREE.Vector3();
		const _freecamRight = new THREE.Vector3();
		const _worldUp = new THREE.Vector3(0, 1, 0);

		let rafId = 0;
		let lastFrameTime = performance.now();
		const animate = () => {
			rafId = requestAnimationFrame(animate);
			const now = performance.now();
			const delta = Math.min((now - lastFrameTime) / 1000, 0.1);
			lastFrameTime = now;
			for (const callback of resources.animationCallbacks) {
				callback(now);
			}
			if (cameraPreferenceRef.current === 'freecam') {
				if (plc.isLocked) {
					const speed = THREE_D_MAP_FREECAM.MOVE_SPEED * delta;
					const keys = freecamKeysRef.current;
					// Move along the camera's true look direction (including vertical tilt).
					perspCamera.getWorldDirection(_freecamDir);
					_freecamRight.crossVectors(_freecamDir, _worldUp).normalize();
					if (keys.w) perspCamera.position.addScaledVector(_freecamDir, speed);
					if (keys.s) perspCamera.position.addScaledVector(_freecamDir, -speed);
					if (keys.a) perspCamera.position.addScaledVector(_freecamRight, -speed);
					if (keys.d) perspCamera.position.addScaledVector(_freecamRight, speed);
				}
			} else {
				controls.update();
			}
			stats.begin();
			renderer.info.reset();
			postProcessing.render();
			if (triangleStats.style.display !== 'none') {
				const info = renderer.info;
				const tris = info.render.triangles.toLocaleString();
				const draws = info.render.calls.toLocaleString();
				const geoms = info.memory.geometries.toLocaleString();
				const texs = info.memory.textures.toLocaleString();
				const progs = (info.programs?.length ?? 0).toLocaleString();
				triangleStats.textContent =
					`TRIS ${tris}\nDRAW ${draws}\nGEOM ${geoms}\nTEX  ${texs}\nPROG ${progs}`;
			}
			stats.end();
		};
		animate();

		const updateCameraProjection = () => {
			const w = container.clientWidth;
			const h = container.clientHeight;
			if (w === 0 || h === 0) return;
			const pref = cameraPreferenceRef.current;
			if (pref === 'ortho') {
				const halfSize = currentHalfSizeRef.current;
				const a = w / h;
				orthoCamera.left = -halfSize * a;
				orthoCamera.right = halfSize * a;
				orthoCamera.top = halfSize;
				orthoCamera.bottom = -halfSize;
				orthoCamera.updateProjectionMatrix();
			} else {
				perspCamera.aspect = w / h;
				perspCamera.updateProjectionMatrix();
			}
			postProcessing.setSize(w, h);
		};
		updateCameraProjectionRef.current = updateCameraProjection;

		const ro = new ResizeObserver(updateCameraProjection);
		ro.observe(container);

		return () => {
			cancelled = true;
			cameraStateRef.current = {
				position: orthoCamera.position.clone(),
				target: controls.target.clone(),
				cursor: controls.cursor.clone(),
				zoom: orthoCamera.zoom,
			};
			setSceneResources(null);
			cancelAnimationFrame(rafId);
			ro.disconnect();
			controls.dispose();
			plc.dispose();
			renderer.domElement.removeEventListener('mousedown', onFreecamMouseDown);
			renderer.domElement.removeEventListener('mouseup', onFreecamMouseUp);
			renderer.domElement.removeEventListener('contextmenu', onFreecamContextMenu);
			window.removeEventListener('keydown', onFreecamKeyDown);
			window.removeEventListener('keyup', onFreecamKeyUp);
			postProcessingRef.current = null;
			updateCameraProjectionRef.current = null;
			orthoCameraRef.current = null;
			perspCameraRef.current = null;
			pointerLockControlsRef.current = null;
			// Clean up any warm meshes still in the scene (compileAsync may not have
			// finished yet). The warm geometry and materials are left undisposed so
			// the compiled WebGL programs stay resident until renderer.dispose().
			const pendingWarmMeshes = warmMeshesRef.current;
			for (const m of pendingWarmMeshes) scene.remove(m);
			warmMeshesRef.current = [];
			const terrainResources = terrainResourcesRef.current;
			if (terrainResources) {
				for (const m of terrainResources.meshes) scene.remove(m);
				for (const cb of terrainResources.animationFrameCallbacks) {
					resources.animationCallbacks.delete(cb);
				}
				disposeTerrainResources(terrainResources);
				terrainResourcesRef.current = null;
			} else {
				resources.movementHighlight.texture.dispose();
			}
			sceneResourcesRef.current = null;
			postProcessing.dispose();
			renderer.dispose();
			rendererRef.current = null;
			controlsRef.current = null;
			directionalLightRef.current = null;
			if (renderer.domElement.parentElement === container) {
				container.removeChild(renderer.domElement);
			}
			if (statsRef.current?.dom?.parentElement === container) {
				container.removeChild(statsRef.current.dom);
			}
			if (triangleStatsRef.current?.parentElement === container) {
				container.removeChild(triangleStatsRef.current);
			}
			statsRef.current = null;
			triangleStatsRef.current = null;
		};
	}, []);

	useEffect(() => {
		if (!sceneResources) return;

		applyVoxelTerrainBackground(sceneResources.scene, terrain);
	}, [sceneResources, terrain, terrainBackgroundColor]);

	useEffect(() => {
		if (!sceneResources) return;
		const container = containerRef.current;
		const controls = controlsRef.current;
		const dirLight = directionalLightRef.current;
		if (!container || !controls || !dirLight) return;
		if (!terrain || getVoxelCount(terrain.Voxels) === 0) return;

		const W = terrain.Width;
		const L = terrain.Length;
		const maxSurfaceHeight = getMaxVoxelSurfaceHeight(terrain);
		const terrainCenterY = (maxSurfaceHeight - 1) / 2;
		const halfSize = (W + L) / Math.SQRT2 / 2 * THREE_D_MAP_CAMERA.FRAMING_MULTIPLIER;
		currentHalfSizeRef.current = halfSize;

		const aspect = (container.clientWidth || 1) / (container.clientHeight || 1);
		// Always reframe the ortho camera (it's the canonical reference for halfSize).
		const orthoCamera = orthoCameraRef.current;
		if (orthoCamera) {
			orthoCamera.left = -halfSize * aspect;
			orthoCamera.right = halfSize * aspect;
			orthoCamera.top = halfSize;
			orthoCamera.bottom = -halfSize;
			orthoCamera.updateProjectionMatrix();
		}
		// Keep the perspective camera's aspect in sync.
		const perspCamera = perspCameraRef.current;
		if (perspCamera) {
			perspCamera.aspect = aspect;
			perspCamera.updateProjectionMatrix();
		}

		const shadowCamera = getShadowCameraBounds(W, L, maxSurfaceHeight);
		applyVoxelTerrainDirectionalLight(
			dirLight,
			terrain,
			maxSurfaceHeight,
			terrainCenterY
		);
		dirLight.shadow.camera.left = shadowCamera.left;
		dirLight.shadow.camera.right = shadowCamera.right;
		dirLight.shadow.camera.top = shadowCamera.top;
		dirLight.shadow.camera.bottom = shadowCamera.bottom;
		dirLight.shadow.camera.near = shadowCamera.near;
		dirLight.shadow.camera.far = shadowCamera.far;
		dirLight.shadow.camera.updateProjectionMatrix();
		sceneResources.requestShadowUpdate();

		controls.cursor.set(0, terrainCenterY, 0);
		controls.maxTargetRadius = getPanLimitRadius(W, L, maxSurfaceHeight);
		if (!hasFramedTerrainRef.current) {
			const previousCameraState = cameraStateRef.current;
			const camDist = halfSize * THREE_D_MAP_CAMERA.DISTANCE_MULTIPLIER;
			if (previousCameraState && orthoCamera) {
				orthoCamera.position.copy(previousCameraState.position);
				orthoCamera.zoom = THREE.MathUtils.clamp(
					previousCameraState.zoom,
					controls.minZoom,
					controls.maxZoom
				);
				controls.target.copy(previousCameraState.target);
				controls.cursor.copy(previousCameraState.cursor);
			} else {
				if (orthoCamera) orthoCamera.position.set(camDist, camDist, camDist);
				controls.target.set(0, terrainCenterY, 0);
			}
			if (orthoCamera) orthoCamera.updateProjectionMatrix();
			// Position perspective camera closer than ortho so the terrain fills the view.
			if (perspCamera && orthoCamera) {
				const orthoDir = new THREE.Vector3().subVectors(orthoCamera.position, controls.target).normalize();
				const perspDist = halfSize * THREE_D_MAP_CAMERA.PERSPECTIVE_DISTANCE_MULTIPLIER;
				perspCamera.position.copy(controls.target).addScaledVector(orthoDir, perspDist);
				perspCamera.lookAt(controls.target);
			}
			controls.update();
			hasFramedTerrainRef.current = true;
		}

	}, [
		sceneResources,
		terrainSignature,
		terrainLighting?.Color,
		terrainLighting?.Intensity,
		terrainLighting?.Rotation,
		terrainLighting?.Elevation,
	]);

	useEffect(() => {
		if (!sceneResources) return;
		const orthoCamera = orthoCameraRef.current;
		const perspCamera = perspCameraRef.current;
		const controls = controlsRef.current;
		const postProcessing = postProcessingRef.current;
		if (!orthoCamera || !perspCamera || !controls || !postProcessing) return;

		cameraPreferenceRef.current = cameraPreference;

		const perspDir = new THREE.Vector3().subVectors(orthoCamera.position, controls.target).normalize();
		const perspDist = currentHalfSizeRef.current * THREE_D_MAP_CAMERA.PERSPECTIVE_DISTANCE_MULTIPLIER;

		if (cameraPreference === 'freecam') {
			perspCamera.position.copy(controls.target).addScaledVector(perspDir, perspDist);
			perspCamera.lookAt(controls.target);
			controls.enabled = false;
			sceneResources.camera = perspCamera;
			postProcessing.setCamera(perspCamera);
		} else if (cameraPreference === 'perspective') {
			perspCamera.position.copy(controls.target).addScaledVector(perspDir, perspDist);
			perspCamera.lookAt(controls.target);
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(controls as any).object = perspCamera;
			controls.enabled = true;
			sceneResources.camera = perspCamera;
			postProcessing.setCamera(perspCamera);
			controls.update();
		} else {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(controls as any).object = orthoCamera;
			controls.enabled = true;
			sceneResources.camera = orthoCamera;
			postProcessing.setCamera(orthoCamera);
			controls.update();
		}

		updateCameraProjectionRef.current?.();
	}, [cameraPreference, sceneResources]);

	useEffect(() => {
		if (!sceneResources) return;
		const resources = sceneResources;

		if (!terrainGeometry) {
			const old = terrainResourcesRef.current;
			if (!old) return;

			for (const m of old.meshes) resources.scene.remove(m);
			for (const cb of old.animationFrameCallbacks) resources.animationCallbacks.delete(cb);
			disposeTerrainResources(old);
			terrainResourcesRef.current = null;
			resources.occlusionTargets.length = 0;
			resources.movementHighlight = createMovementHighlightTexture(1, 1, 1);
			resources.requestShadowUpdate();
			return;
		}

		const movementHighlight = createMovementHighlightTexture(
			terrainGeometry.width,
			terrainGeometry.height + 1,
			terrainGeometry.length
		);
		const voxelAo = createVoxelAoTexture(terrainGeometry.occupancy, {
			performanceMode,
		});

		const meshes: THREE.Mesh[] = [];
		const geometries: THREE.BufferGeometry[] = [];
		const materials: THREE.MeshStandardMaterial[] = [];
		const animationFrameCallbacks: ((timeMs: number) => void)[] = [];

		for (const [bucketKey, geometry] of terrainGeometry.buckets) {
			const factory =
				TERRAIN_MATERIAL_REGISTRY.get(bucketKey) ??
				TERRAIN_MATERIAL_REGISTRY.get('default')!;
			const result = factory({
				acceptsMovementHighlight: true,
				performanceMode,
				movementHighlight,
				voxelAo,
			});
			if (result.onAnimationFrame) {
				resources.animationCallbacks.add(result.onAnimationFrame);
				animationFrameCallbacks.push(result.onAnimationFrame);
			}
			const mesh = new THREE.Mesh(geometry, result.material);
			mesh.castShadow = result.castShadow;
			mesh.receiveShadow = result.receiveShadow;
			mesh.renderOrder = result.renderOrder ?? 0;
			meshes.push(mesh);
			geometries.push(geometry);
			materials.push(result.material);
		}

		const old = terrainResourcesRef.current;
		if (old) {
			for (const m of old.meshes) resources.scene.remove(m);
			for (const cb of old.animationFrameCallbacks) resources.animationCallbacks.delete(cb);
			disposeTerrainResources(old);
		} else {
			resources.movementHighlight.texture.dispose();
		}

		for (const mesh of meshes) resources.scene.add(mesh);
		resources.occlusionTargets.length = 0;
		for (const mesh of meshes) resources.occlusionTargets.push(mesh);
		resources.movementHighlight = movementHighlight;
		terrainResourcesRef.current = { meshes, geometries, materials, movementHighlight, voxelAo, animationFrameCallbacks };
		resources.requestShadowUpdate();
		// Terrain meshes are now in the scene -- signal the host that the map is ready.
		onReadyRef.current?.();
	}, [sceneResources, terrainGeometry]);

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
