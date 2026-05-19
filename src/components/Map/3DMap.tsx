// components/Map/3DMap.tsx
// Three.js voxel terrain renderer with orthographic isometric camera.
// Addon imports use three/examples/jsm/ -- see CLAUDE.md for why.
// MeshStandardMaterial not MeshLambertMaterial -- see CLAUDE.md for why.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { acceleratedRaycast } from 'three-mesh-bvh';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import Stats from 'three/examples/jsm/libs/stats.module.js';
import type { Character } from '../../domains/Character/Character';
import type { Entity } from '../../domains/Entity/Entity';
import { useQuestContext } from '../../domains/Context/ContextProvider';
import { useActionService } from '../../services/Actions/ActionServiceProvider';
import { CampaignActions } from '../../domains/Campaign/CampaignActions';
import { AppSettingActions } from '../../domains/AppSetting/AppSettingActions';
import {
	getMaxVoxelSurfaceHeight,
	getVoxelTerrainResolution,
} from '../../utils/VoxelTerrainUtils';
import { getVoxelCount } from '../../utils/VoxelDataUtils';
import {
	calculateVoxelMovementRange,
	calculateVoxelRemainingMovementRange,
} from '../../utils/VoxelMovementUtilities';
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
import {
	THREE_D_MAP_CAMERA,
	THREE_D_MAP_CONTROLS,
	THREE_D_MAP_LIGHTING,
	THREE_D_MAP_RENDERER,
	THREE_D_MAP_SHADOW,
	THREE_D_TERRAIN_MATERIAL,
} from './threeDMapConstants';
import {
	createTerrainSignature,
	useVoxelTerrainGeometryWorker,
} from './hooks/useVoxelTerrainGeometryWorker';

interface ThreeDMapProps {
	terrain?: VoxelTerrain | null;
	characters?: Character[];
	entities?: Entity[];
	xRayActors?: boolean;
}

interface ThreeDMapCameraState {
	position: THREE.Vector3;
	target: THREE.Vector3;
	cursor: THREE.Vector3;
	zoom: number;
}

interface TerrainRenderResources {
	mesh: THREE.Mesh;
	material: THREE.MeshStandardMaterial;
	movementHighlight: ReturnType<typeof createMovementHighlightTexture>;
}

function disposeTerrainResources(resources: TerrainRenderResources): void {
	resources.material.dispose();
	resources.movementHighlight.texture.dispose();
}

function getGeometryTriangleCount(geometry: THREE.BufferGeometry): number {
	if (geometry.index) return geometry.index.count / 3;

	const position = geometry.getAttribute("position");
	return position ? position.count / 3 : 0;
}

function hasVisibleMaterial(material: THREE.Material | THREE.Material[]): boolean {
	if (Array.isArray(material)) {
		return material.some((entry) => entry.visible);
	}

	return material.visible;
}

function isVisibleInHierarchy(object: THREE.Object3D): boolean {
	let current: THREE.Object3D | null = object;
	while (current) {
		if (!current.visible) return false;
		current = current.parent;
	}
	return true;
}

function countVisibleSceneTriangles(scene: THREE.Scene, camera: THREE.Camera): number {
	let triangles = 0;

	scene.traverse((object) => {
		if (!(object instanceof THREE.Mesh)) return;
		if (!isVisibleInHierarchy(object)) return;
		if (!object.layers.test(camera.layers)) return;
		if (!hasVisibleMaterial(object.material)) return;

		const instanceCount = object instanceof THREE.InstancedMesh ? object.count : 1;
		triangles += getGeometryTriangleCount(object.geometry) * instanceCount;
	});

	return triangles;
}

function formatTriangleCount(triangles: number): string {
	return Math.round(triangles).toLocaleString();
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

function createMovementHighlightTexture(width: number, heightLevels: number, length: number): {
	texture: THREE.Data3DTexture;
	data: Uint8Array;
	width: number;
	heightLevels: number;
	length: number;
} {
	// Layout: data[(tileZ * heightLevels * width + h * width + tileX) * 4]
	// Sampled in the shader with texture(sampler3D, vec3(s, t, r)) where
	// s = tileX/width, t = h/heightLevels, r = tileZ/length.
	const data = new Uint8Array(width * heightLevels * length * 4);
	const texture = new THREE.Data3DTexture(data, width, heightLevels, length);
	texture.format = THREE.RGBAFormat;
	texture.type = THREE.UnsignedByteType;
	texture.magFilter = THREE.NearestFilter;
	texture.minFilter = THREE.NearestFilter;
	texture.wrapS = THREE.ClampToEdgeWrapping;
	texture.wrapT = THREE.ClampToEdgeWrapping;
	texture.wrapR = THREE.ClampToEdgeWrapping;
	texture.generateMipmaps = false;
	texture.needsUpdate = true;

	return { texture, data, width, heightLevels, length };
}

function installMovementHighlightShader(
	material: THREE.MeshStandardMaterial,
	highlight: ReturnType<typeof createMovementHighlightTexture>,
	resolution: number
): void {
	const highlightSize = new THREE.Vector2(highlight.width, highlight.length);
	const heightLevels = highlight.heightLevels;

	material.onBeforeCompile = (shader) => {
		shader.uniforms.movementHighlightMap = { value: highlight.texture };
		shader.uniforms.movementHighlightSize = { value: highlightSize };
		shader.uniforms.movementHighlightHeightLevels = { value: heightLevels };
		shader.uniforms.movementHighlightResolution = { value: resolution };
		shader.vertexShader = shader.vertexShader.replace(
			"#include <common>",
			[
				"#include <common>",
				"uniform vec2 movementHighlightSize;",
				"uniform float movementHighlightHeightLevels;",
				"varying vec3 vMovementWorldPosition;",
				"varying vec3 vMovementWorldNormal;",
			].join("\n")
		);
		shader.vertexShader = shader.vertexShader.replace(
			"#include <begin_vertex>",
			[
				"#include <begin_vertex>",
				"vMovementWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;",
				"vMovementWorldNormal = normalize(mat3(modelMatrix) * normal);",
			].join("\n")
		);
		shader.fragmentShader = shader.fragmentShader.replace(
			"#include <common>",
			[
				"#include <common>",
				"uniform highp sampler3D movementHighlightMap;",
				"uniform vec2 movementHighlightSize;",
				"uniform float movementHighlightHeightLevels;",
				"uniform float movementHighlightResolution;",
				"varying vec3 vMovementWorldPosition;",
				"varying vec3 vMovementWorldNormal;",
			].join("\n")
		);
		shader.fragmentShader = shader.fragmentShader.replace(
			"#include <dithering_fragment>",
			[
				// Top faces get full strength; everything else (sides, bottoms) is dim.
				// Derived from the world-space normal so we don't pay a per-vertex attribute.
				"float movementHighlightStrength = vMovementWorldNormal.y > 0.5 ? 1.0 : 0.28;",
				"vec3 movementSamplePoint = vMovementWorldPosition - vMovementWorldNormal * 0.001;",
				"vec2 movementTileCoord = floor(movementSamplePoint.xz + movementHighlightSize * 0.5);",
				"float movementVoxelY = floor((movementSamplePoint.y + 0.5) * movementHighlightResolution - 0.0001);",
				"float movementTileHeight = floor((movementVoxelY + 1.0) / movementHighlightResolution);",
				"vec3 movementHighlightUvw = vec3(",
				"	(movementTileCoord.x + 0.5) / movementHighlightSize.x,",
				"	(movementTileHeight + 0.5) / movementHighlightHeightLevels,",
				"	(movementTileCoord.y + 0.5) / movementHighlightSize.y",
				");",
				"vec4 movementHighlight = texture(movementHighlightMap, movementHighlightUvw);",
				"if (movementHighlight.a > 0.0 && movementHighlightStrength > 0.0) {",
				"	vec3 baseColor = gl_FragColor.rgb;",
				"	float baseLuma = dot(baseColor, vec3(0.2126, 0.7152, 0.0722));",
				"	vec2 tileLocal = fract(vMovementWorldPosition.xz + movementHighlightSize * 0.5);",
				"	float edgeDistance = min(min(tileLocal.x, 1.0 - tileLocal.x), min(tileLocal.y, 1.0 - tileLocal.y));",
				"	float edgeBand = 1.0 - smoothstep(0.025, 0.11, edgeDistance);",
				"	float markAlpha = clamp(movementHighlight.a * (1.35 + edgeBand * 0.75) * movementHighlightStrength, 0.0, 0.92);",
				"	vec3 screened = 1.0 - (1.0 - baseColor) * (1.0 - movementHighlight.rgb * 0.85);",
				"	vec3 marked = mix(baseColor, screened, markAlpha);",
				"	marked = max(marked, movementHighlight.rgb * movementHighlight.a * (0.65 + 0.55 * movementHighlightStrength));",
				"	vec3 contrastEdge = mix(vec3(1.0), vec3(0.035), step(0.58, baseLuma));",
				"	vec3 edgeColor = mix(movementHighlight.rgb, contrastEdge, 0.45);",
				"	gl_FragColor.rgb = mix(marked, edgeColor, edgeBand * movementHighlight.a * 0.7 * movementHighlightStrength);",
				"}",
				"#include <dithering_fragment>",
			].join("\n")
		);
	};
	material.needsUpdate = true;
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
}: ThreeDMapProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const cameraStateRef = useRef<ThreeDMapCameraState | null>(null);
	const sceneResourcesRef = useRef<ThreeDSceneResources | null>(null);
	const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const statsRef = useRef<any>(null);
	const triangleStatsRef = useRef<HTMLDivElement | null>(null);
	const controlsRef = useRef<OrbitControls | null>(null);
	const directionalLightRef = useRef<THREE.DirectionalLight | null>(null);
	const terrainResourcesRef = useRef<TerrainRenderResources | null>(null);
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
	const terrainResolution = terrain ? getVoxelTerrainResolution(terrain) : 1;
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
		(tile: { x: number; y: number }) => {
			if (!actionService) return;
			const now = Date.now();
			if (now - lastPingTimeRef.current < PING_DURATION_MS) return;

			actionService.execute("ping:create", {
				x: tile.x,
				y: tile.y,
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
		renderer.setPixelRatio(Math.min(window.devicePixelRatio, THREE_D_MAP_RENDERER.MAX_PIXEL_RATIO));
		renderer.setSize(container.clientWidth || 1, container.clientHeight || 1);
		renderer.outputColorSpace = THREE.SRGBColorSpace;
		renderer.shadowMap.enabled = true;
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
		triangleStats.style.width = '80px';
		triangleStats.style.boxSizing = 'border-box';
		triangleStats.style.padding = '2px 3px';
		triangleStats.style.background = 'rgba(0, 0, 0, 0.8)';
		triangleStats.style.color = '#0ff';
		triangleStats.style.font = 'bold 9px Helvetica, Arial, sans-serif';
		triangleStats.style.lineHeight = '11px';
		triangleStats.style.pointerEvents = 'none';
		triangleStats.style.display = 'none';
		triangleStats.textContent = 'TRIS 0';
		container.appendChild(triangleStats);
		triangleStatsRef.current = triangleStats;

		const scene = new THREE.Scene();
		scene.background = null;

		const aspect = (container.clientWidth || 1) / (container.clientHeight || 1);
		const initialHalfSize = currentHalfSizeRef.current;
		const camera = new THREE.OrthographicCamera(
			-initialHalfSize * aspect,
			initialHalfSize * aspect,
			initialHalfSize,
			-initialHalfSize,
			THREE_D_MAP_RENDERER.CAMERA_NEAR,
			THREE_D_MAP_RENDERER.CAMERA_FAR
		);
		const camDist = initialHalfSize * THREE_D_MAP_CAMERA.DISTANCE_MULTIPLIER;
		camera.position.set(camDist, camDist, camDist);

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
		dirLight.shadow.mapSize.set(THREE_D_MAP_SHADOW.MAP_SIZE, THREE_D_MAP_SHADOW.MAP_SIZE);
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

		const movementHighlight = createMovementHighlightTexture(1, 1, 1);
		const resources: ThreeDSceneResources = {
			scene,
			camera,
			domElement: renderer.domElement,
			occlusionTargets: [],
			movementHighlight,
			animationCallbacks: new Set(),
			actorPickTargets: [],
			dragState: { active: false },
		};
		sceneResourcesRef.current = resources;
		setSceneResources(resources);

		let rafId = 0;
		const animate = () => {
			rafId = requestAnimationFrame(animate);
			const now = performance.now();
			for (const callback of resources.animationCallbacks) {
				callback(now);
			}
			controls.update();
			stats.begin();
			renderer.render(scene, camera);
			if (triangleStats.style.display !== 'none') {
				triangleStats.textContent = `TRIS ${formatTriangleCount(
					countVisibleSceneTriangles(scene, camera)
				)}`;
			}
			stats.end();
		};
		animate();

		const updateCameraProjection = () => {
			const w = container.clientWidth;
			const h = container.clientHeight;
			if (w === 0 || h === 0) return;
			const halfSize = currentHalfSizeRef.current;
			const a = w / h;
			camera.left = -halfSize * a;
			camera.right = halfSize * a;
			camera.top = halfSize;
			camera.bottom = -halfSize;
			camera.updateProjectionMatrix();
			renderer.setSize(w, h);
		};

		const ro = new ResizeObserver(updateCameraProjection);
		ro.observe(container);

		return () => {
			cameraStateRef.current = {
				position: camera.position.clone(),
				target: controls.target.clone(),
				cursor: controls.cursor.clone(),
				zoom: camera.zoom,
			};
			setSceneResources(null);
			cancelAnimationFrame(rafId);
			ro.disconnect();
			controls.dispose();
			const terrainResources = terrainResourcesRef.current;
			if (terrainResources) {
				scene.remove(terrainResources.mesh);
				disposeTerrainResources(terrainResources);
				terrainResourcesRef.current = null;
			} else {
				resources.movementHighlight.texture.dispose();
			}
			sceneResourcesRef.current = null;
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
		const resources = sceneResourcesRef.current;
		const container = containerRef.current;
		const controls = controlsRef.current;
		const dirLight = directionalLightRef.current;
		if (!resources || !container || !controls || !dirLight) return;
		if (!terrain || getVoxelCount(terrain.Voxels) === 0) return;

		const W = terrain.Width;
		const L = terrain.Length;
		const maxSurfaceHeight = getMaxVoxelSurfaceHeight(terrain);
		const terrainCenterY = (maxSurfaceHeight - 1) / 2;
		const halfSize = (W + L) / Math.SQRT2 / 2 * THREE_D_MAP_CAMERA.FRAMING_MULTIPLIER;
		currentHalfSizeRef.current = halfSize;

		const aspect = (container.clientWidth || 1) / (container.clientHeight || 1);
		const camera = resources.camera as THREE.OrthographicCamera;
		camera.left = -halfSize * aspect;
		camera.right = halfSize * aspect;
		camera.top = halfSize;
		camera.bottom = -halfSize;
		camera.updateProjectionMatrix();

		const terrainMaxExtent = Math.max(W, L, maxSurfaceHeight);
		const shadowCamera = getShadowCameraBounds(W, L, maxSurfaceHeight);
		dirLight.position.set(
			terrainMaxExtent * THREE_D_MAP_LIGHTING.DIRECTIONAL_POSITION_X_SCALE,
			terrainMaxExtent * THREE_D_MAP_LIGHTING.DIRECTIONAL_POSITION_Y_SCALE + maxSurfaceHeight,
			terrainMaxExtent * THREE_D_MAP_LIGHTING.DIRECTIONAL_POSITION_Z_SCALE
		);
		dirLight.target.position.set(0, terrainCenterY, 0);
		dirLight.shadow.camera.left = shadowCamera.left;
		dirLight.shadow.camera.right = shadowCamera.right;
		dirLight.shadow.camera.top = shadowCamera.top;
		dirLight.shadow.camera.bottom = shadowCamera.bottom;
		dirLight.shadow.camera.near = shadowCamera.near;
		dirLight.shadow.camera.far = shadowCamera.far;
		dirLight.shadow.camera.updateProjectionMatrix();

		controls.cursor.set(0, terrainCenterY, 0);
		controls.maxTargetRadius = getPanLimitRadius(W, L, maxSurfaceHeight);
		if (!hasFramedTerrainRef.current) {
			const previousCameraState = cameraStateRef.current;
			if (previousCameraState) {
				camera.position.copy(previousCameraState.position);
				camera.zoom = THREE.MathUtils.clamp(
					previousCameraState.zoom,
					controls.minZoom,
					controls.maxZoom
				);
				controls.target.copy(previousCameraState.target);
				controls.cursor.copy(previousCameraState.cursor);
			} else {
				const camDist = halfSize * THREE_D_MAP_CAMERA.DISTANCE_MULTIPLIER;
				camera.position.set(camDist, camDist, camDist);
				controls.target.set(0, terrainCenterY, 0);
			}
			camera.updateProjectionMatrix();
			controls.update();
			hasFramedTerrainRef.current = true;
		}

	}, [terrainSignature]);

	useEffect(() => {
		const resources = sceneResourcesRef.current;
		if (!resources) return;

		if (!terrainGeometry) {
			const old = terrainResourcesRef.current;
			if (!old) return;

			resources.scene.remove(old.mesh);
			disposeTerrainResources(old);
			terrainResourcesRef.current = null;
			resources.occlusionTargets.length = 0;
			resources.movementHighlight = createMovementHighlightTexture(1, 1, 1);
			return;
		}

		const movementHighlight = createMovementHighlightTexture(
			terrainGeometry.width,
			terrainGeometry.height + 1,
			terrainGeometry.length
		);
		const material = new THREE.MeshStandardMaterial({
			roughness: THREE_D_TERRAIN_MATERIAL.ROUGHNESS,
			metalness: THREE_D_TERRAIN_MATERIAL.METALNESS,
			vertexColors: true,
		});
		installMovementHighlightShader(
			material,
			movementHighlight,
			terrainResolution
		);
		const mesh = new THREE.Mesh(terrainGeometry.geometry, material);
		mesh.raycast = acceleratedRaycast;
		mesh.castShadow = true;
		mesh.receiveShadow = true;

		const old = terrainResourcesRef.current;
		if (old) {
			resources.scene.remove(old.mesh);
			disposeTerrainResources(old);
		} else {
			resources.movementHighlight.texture.dispose();
		}

		resources.scene.add(mesh);
		resources.occlusionTargets.length = 0;
		resources.occlusionTargets.push(mesh);
		resources.movementHighlight = movementHighlight;
		terrainResourcesRef.current = {
			mesh,
			material,
			movementHighlight,
		};
	}, [terrainResolution, terrainGeometry]);

	return (
		<div className="relative w-full h-full">
			<div ref={containerRef} className="w-full h-full" />
			{sceneResources && terrain && getVoxelCount(terrain.Voxels) > 0 && (
				<>
					<ThreeDActorLayer
						resources={sceneResources}
						characters={characters}
						entities={entities}
						cutoutImageIds={cutoutImageIds}
						selectedActor={selectedActor}
						terrain={terrain}
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
						activePings={activePings}
						onPingTile={handlePingTile}
					/>
				</>
			)}
		</div>
	);
}
