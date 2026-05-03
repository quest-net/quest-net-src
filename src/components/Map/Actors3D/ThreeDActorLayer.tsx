import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { Position } from "../../../domains/Actor/Actor";
import type { Character } from "../../../domains/Character/Character";
import type { Entity } from "../../../domains/Entity/Entity";
import type { VoxelTerrain } from "../../../domains/VoxelTerrain/VoxelTerrain";
import {
	getMaxVoxelSurfaceHeight,
	getVoxelRulesSurfaceHeight,
	getVoxelSurfaceHeight,
} from "../../../utils/VoxelTerrainUtils";
import type { SelectedActor } from "../MapStateProvider";
import type { ActorTokenDescriptor, ThreeDSceneResources } from "./actorTokenTypes";
import {
	ACTOR_TOKEN_BASE,
	ACTOR_TOKEN_COLORS,
	ACTOR_TOKEN_DRAG,
	ACTOR_TOKEN_HALO,
	ACTOR_TOKEN_HEIGHT_DRAG,
	ACTOR_TOKEN_MOVEMENT_ANIMATION,
	ACTOR_TOKEN_OCCLUSION,
	ACTOR_TOKEN_PICK,
	ACTOR_TOKEN_PLACEMENT,
	ACTOR_TOKEN_RENDER_ORDER,
	ACTOR_TOKEN_SHADOW,
} from "./actorTokenConstants";
import { buildActorTokenDescriptors } from "./actorTokenDescriptors";
import {
	createActorTokenTexture,
	createSelectionOutlineTexture,
	getActorTokenWorldSize,
} from "./actorTokenTexture";
import {
	getActorBaseHeight,
	getActorGroundPosition,
	getStandeeBottomOffset,
	isActorAirborne,
} from "./actorTokenPlacement";

interface ThreeDActorLayerProps {
	resources: ThreeDSceneResources;
	characters: Character[];
	entities: Entity[];
	cutoutImageIds: ReadonlySet<string>;
	selectedActor: SelectedActor | null;
	actorLayerSignature: string;
	terrain: VoxelTerrain;
	isDM: boolean;
	imageService?: {
		getImage(imageId: string): Promise<Blob | null>;
	} | null;
	onActorClick: (actor: SelectedActor) => void;
	onActorSelect: (actor: SelectedActor) => void;
	/**
	 * Returns true when the user is allowed to height-drag this actor.
	 * Non-controllable actors still toggle selection on tap.
	 */
	canControlActor?: (actor: SelectedActor) => boolean;
	/**
	 * Called when a height drag commits a new h for the actor's current tile.
	 */
	onActorDragEnd?: (actor: SelectedActor, position: Position) => void;
}

interface ManagedResource {
	dispose(): void;
}

interface ColorHandle {
	material: THREE.MeshStandardMaterial | THREE.MeshBasicMaterial;
	defaultHex: number;
}

interface OpacityHandle {
	material: THREE.MeshBasicMaterial;
	defaultOpacity: number;
	selectedOpacity: number;
}

interface SelectionHandles {
	// Cutout actors render frameless and have no overlay; selection is
	// signalled purely via base/halo color flips.
	overlay?: THREE.Mesh;
	colors: ColorHandle[];
	haloOpacities: OpacityHandle[];
}

interface ActorMoveAnimation {
	group: THREE.Group;
	from: THREE.Vector3;
	to: THREE.Vector3;
	startedAt: number;
	durationMs: number;
}

interface ActorVisualHandles {
	group: THREE.Group;
	shadow: THREE.Mesh;
	supportGroup: THREE.Group;
	standee: THREE.Mesh;
	selectionOverlay?: THREE.Mesh;
	pickMesh: THREE.Mesh;
	supportMode: "grounded" | "airborne";
	actor: ActorTokenDescriptor;
}

interface ActorDragState {
	pointerId: number;
	actor: SelectedActor;
	actorKey: string;
	descriptor: ActorTokenDescriptor;
	// Pointerdown screen position. Used to detect when the gesture
	// crosses the drag-vs-click threshold.
	startClientX: number;
	startClientY: number;
	// Original logical position at drag start. Restored on cancel and
	// used as the stable baseline for height dragging.
	startPosition: Position;
	// Current candidate position the visual is animating toward. Only h
	// changes during actor drag; x/y stay at the start position.
	candidatePosition: Position;
	// True once movement has crossed START_THRESHOLD_PX. Below it, a
	// pointerup is treated as a click that toggles selection.
	hasDragged: boolean;
	// True only for the currently-selected, controllable flying actor.
	// Other actor drags are treated as clicks and never change x/y/h.
	canDragHeight: boolean;
	pixelsPerHeight: number;
	projectedUpX: number;
	projectedUpY: number;
}

function getActorKey(kind: "character" | "entity", id: string): string {
	return `${kind}:${id}`;
}

function easeInOutCubic(t: number): number {
	return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function getMovementAnimationDuration(from: THREE.Vector3, to: THREE.Vector3): number {
	const distance = from.distanceTo(to);
	return THREE.MathUtils.clamp(
		distance * ACTOR_TOKEN_MOVEMENT_ANIMATION.MS_PER_WORLD_UNIT,
		ACTOR_TOKEN_MOVEMENT_ANIMATION.MIN_DURATION_MS,
		ACTOR_TOKEN_MOVEMENT_ANIMATION.MAX_DURATION_MS
	);
}

function clampHeight(height: number, minHeight: number, maxHeight: number): number {
	return Math.max(minHeight, Math.min(maxHeight, height));
}

function getProjectedHeightDragMetrics(
	resources: ThreeDSceneResources,
	worldPosition: THREE.Vector3
): { pixelsPerHeight: number; projectedUpX: number; projectedUpY: number } {
	const rect = resources.domElement.getBoundingClientRect();
	const start = worldPosition.clone().project(resources.camera);
	const end = worldPosition
		.clone()
		.add(new THREE.Vector3(0, 1, 0))
		.project(resources.camera);
	const projectedUpX = ((end.x - start.x) * rect.width) / 2;
	const projectedUpY = (-(end.y - start.y) * rect.height) / 2;
	const pixelsPerHeight = Math.hypot(projectedUpX, projectedUpY);

	if (!Number.isFinite(pixelsPerHeight) || pixelsPerHeight <= 0) {
		return {
			pixelsPerHeight: ACTOR_TOKEN_HEIGHT_DRAG.FALLBACK_PIXELS_PER_HEIGHT,
			projectedUpX: 0,
			projectedUpY: -1,
		};
	}

	return { pixelsPerHeight, projectedUpX, projectedUpY };
}

function createDescriptorMap(
	characters: Character[],
	entities: Entity[],
	cutoutImageIds: ReadonlySet<string>
): Map<string, ActorTokenDescriptor> {
	const descriptors = buildActorTokenDescriptors(
		characters,
		entities,
		cutoutImageIds
	);
	const map = new Map<string, ActorTokenDescriptor>();
	for (const descriptor of descriptors) {
		map.set(getActorKey(descriptor.kind, descriptor.id), descriptor);
	}
	return map;
}

function getActorSupportMode(
	actor: ActorTokenDescriptor,
	terrain: VoxelTerrain
): "grounded" | "airborne" {
	return isActorAirborne(actor, terrain) ? "airborne" : "grounded";
}

function applySelection(handles: SelectionHandles, selected: boolean) {
	if (handles.overlay) {
		handles.overlay.visible = selected;
	}
	for (const color of handles.colors) {
		color.material.color.setHex(selected ? ACTOR_TOKEN_COLORS.SELECTED_RING : color.defaultHex);
	}
	for (const halo of handles.haloOpacities) {
		halo.material.opacity = selected ? halo.selectedOpacity : halo.defaultOpacity;
	}
}

function applySelectionToAll(
	handlesByKey: Map<string, SelectionHandles>,
	selectedActor: SelectedActor | null
) {
	const selectedKey = selectedActor
		? getActorKey(selectedActor.kind, selectedActor.id)
		: null;
	for (const [key, handles] of handlesByKey) {
		applySelection(handles, key === selectedKey);
	}
}

function getMeshResources(mesh: THREE.Mesh): ManagedResource[] {
	const resources: ManagedResource[] = [mesh.geometry];
	if (Array.isArray(mesh.material)) {
		resources.push(...mesh.material);
	} else {
		resources.push(mesh.material);
	}
	return resources;
}

function calculateShadowParams(heightDelta: number): {
	scale: number;
	opacity: number;
} {
	const delta = Math.max(0, heightDelta);
	const scale = Math.max(
		ACTOR_TOKEN_SHADOW.GROUNDED_MIN_SCALE,
		1 / (1 + ACTOR_TOKEN_SHADOW.GROUNDED_FALLOFF * delta)
	);
	const opacity = Math.max(
		ACTOR_TOKEN_SHADOW.MIN_OPACITY,
		ACTOR_TOKEN_SHADOW.BASE_OPACITY * scale
	);
	return { scale, opacity };
}

function calculateAirborneShadowParams(heightDelta: number): {
	scale: number;
	opacity: number;
} {
	const delta = Math.max(0, heightDelta);
	const scale = Math.max(
		ACTOR_TOKEN_SHADOW.AIRBORNE_MIN_SCALE,
		1 / (1 + ACTOR_TOKEN_SHADOW.AIRBORNE_FALLOFF * delta)
	);
	const opacity = Math.max(
		ACTOR_TOKEN_SHADOW.AIRBORNE_MIN_OPACITY,
		ACTOR_TOKEN_SHADOW.AIRBORNE_BASE_OPACITY * scale
	);
	return { scale, opacity };
}

function createShadowTexture(): THREE.Texture {
	const canvas = document.createElement("canvas");
	canvas.width = ACTOR_TOKEN_SHADOW.TEXTURE_SIZE;
	canvas.height = ACTOR_TOKEN_SHADOW.TEXTURE_SIZE;

	const ctx = canvas.getContext("2d");
	if (!ctx) {
		throw new Error("Unable to create actor shadow canvas");
	}

	const center = ACTOR_TOKEN_SHADOW.TEXTURE_SIZE / 2;
	const gradient = ctx.createRadialGradient(
		center,
		center,
		ACTOR_TOKEN_SHADOW.GRADIENT_INNER_RADIUS,
		center,
		center,
		ACTOR_TOKEN_SHADOW.GRADIENT_OUTER_RADIUS
	);
	gradient.addColorStop(0, ACTOR_TOKEN_SHADOW.GRADIENT_INNER_COLOR);
	gradient.addColorStop(
		ACTOR_TOKEN_SHADOW.GRADIENT_MID_STOP,
		ACTOR_TOKEN_SHADOW.GRADIENT_MID_COLOR
	);
	gradient.addColorStop(1, ACTOR_TOKEN_SHADOW.GRADIENT_OUTER_COLOR);
	ctx.fillStyle = gradient;
	ctx.fillRect(0, 0, ACTOR_TOKEN_SHADOW.TEXTURE_SIZE, ACTOR_TOKEN_SHADOW.TEXTURE_SIZE);

	const texture = new THREE.CanvasTexture(canvas);
	texture.colorSpace = THREE.SRGBColorSpace;
	texture.needsUpdate = true;
	return texture;
}

function faceCameraAroundY(
	object: THREE.Object3D,
	camera: THREE.Camera,
	origin: THREE.Object3D
) {
	const cameraPosition = new THREE.Vector3();
	const originPosition = new THREE.Vector3();
	camera.getWorldPosition(cameraPosition);
	origin.getWorldPosition(originPosition);
	object.rotation.y = Math.atan2(
		cameraPosition.x - originPosition.x,
		cameraPosition.z - originPosition.z
	);
}

function createStandeeMesh(
	texture: THREE.Texture,
	actor: ActorTokenDescriptor,
	resources: ThreeDSceneResources,
	actorGroup: THREE.Group,
	bottomOffset: number
): THREE.Mesh {
	const { width, height } = getActorTokenWorldSize(actor.size, actor.cutout);
	const geometry = new THREE.PlaneGeometry(width, height);
	const material = new THREE.MeshBasicMaterial({
		map: texture,
		transparent: true,
		depthTest: true,
		depthWrite: false,
		side: THREE.DoubleSide,
	});
	const mesh = new THREE.Mesh(geometry, material);
	mesh.position.y = bottomOffset + height / 2;
	mesh.renderOrder = ACTOR_TOKEN_RENDER_ORDER.NORMAL;
	mesh.userData = {
		actorId: actor.id,
		kind: actor.kind,
		moveSpeed: actor.moveSpeed,
	};
	mesh.onBeforeRender = () => faceCameraAroundY(mesh, resources.camera, actorGroup);
	return mesh;
}

function createSelectionOverlayMesh(
	texture: THREE.Texture,
	actor: ActorTokenDescriptor,
	resources: ThreeDSceneResources,
	actorGroup: THREE.Group,
	bottomOffset: number
): THREE.Mesh {
	const { width, height } = getActorTokenWorldSize(actor.size, actor.cutout);
	const geometry = new THREE.PlaneGeometry(width, height);
	const material = new THREE.MeshBasicMaterial({
		map: texture,
		transparent: true,
		depthTest: true,
		depthWrite: false,
		side: THREE.DoubleSide,
	});
	const mesh = new THREE.Mesh(geometry, material);
	mesh.position.y = bottomOffset + height / 2;
	mesh.renderOrder = ACTOR_TOKEN_RENDER_ORDER.SELECTION;
	mesh.visible = false;
	mesh.onBeforeRender = () => faceCameraAroundY(mesh, resources.camera, actorGroup);
	return mesh;
}

function createPickMesh(
	actor: ActorTokenDescriptor,
	resources: ThreeDSceneResources,
	actorGroup: THREE.Group,
	bottomOffset: number
): THREE.Mesh {
	const { width, height } = getActorTokenWorldSize(actor.size, actor.cutout);
	const geometry = new THREE.PlaneGeometry(
		width * ACTOR_TOKEN_PICK.SCALE_MULTIPLIER,
		height * ACTOR_TOKEN_PICK.SCALE_MULTIPLIER
	);
	const material = new THREE.MeshBasicMaterial({
		transparent: true,
		opacity: 0,
		depthTest: false,
		depthWrite: false,
		side: THREE.DoubleSide,
	});
	const mesh = new THREE.Mesh(geometry, material);
	mesh.position.y = bottomOffset + height / 2;
	mesh.renderOrder = ACTOR_TOKEN_RENDER_ORDER.PICK;
	mesh.userData = {
		actorId: actor.id,
		kind: actor.kind,
		moveSpeed: actor.moveSpeed,
	};
	mesh.onBeforeRender = () => faceCameraAroundY(mesh, resources.camera, actorGroup);
	return mesh;
}

interface BaseMeshResult {
	group: THREE.Group;
	baseMaterial: THREE.MeshStandardMaterial;
	accentMaterial: THREE.MeshBasicMaterial;
	accentDefaultHex: number;
}

function createBaseMesh(actor: ActorTokenDescriptor): BaseMeshResult {
	const group = new THREE.Group();
	const { width } = getActorTokenWorldSize(actor.size);
	const radius = width * ACTOR_TOKEN_BASE.RADIUS_SCALE;
	const accentColor = actor.kind === "character"
		? ACTOR_TOKEN_COLORS.CHARACTER_BASE
		: ACTOR_TOKEN_COLORS.ENTITY_BASE;
	const geometry = new THREE.CylinderGeometry(
		radius,
		radius,
		ACTOR_TOKEN_BASE.HEIGHT,
		ACTOR_TOKEN_BASE.RADIAL_SEGMENTS
	);
	const baseMaterial = new THREE.MeshStandardMaterial({
		color: ACTOR_TOKEN_COLORS.BASE,
		roughness: ACTOR_TOKEN_BASE.ROUGHNESS,
		metalness: ACTOR_TOKEN_BASE.METALNESS,
	});
	const base = new THREE.Mesh(geometry, baseMaterial);
	base.position.y = ACTOR_TOKEN_BASE.HEIGHT / 2;
	base.castShadow = true;
	base.receiveShadow = true;
	group.add(base);

	const accentGeometry = new THREE.TorusGeometry(
		radius * ACTOR_TOKEN_BASE.ACCENT_RADIUS_SCALE,
		ACTOR_TOKEN_BASE.ACCENT_TUBE_RADIUS,
		ACTOR_TOKEN_BASE.ACCENT_TUBE_SEGMENTS,
		ACTOR_TOKEN_BASE.ACCENT_RADIAL_SEGMENTS
	);
	const accentMaterial = new THREE.MeshBasicMaterial({ color: accentColor });
	const accent = new THREE.Mesh(accentGeometry, accentMaterial);
	accent.rotation.x = Math.PI / 2;
	accent.position.y = ACTOR_TOKEN_BASE.HEIGHT + ACTOR_TOKEN_BASE.ACCENT_Y_OFFSET;
	group.add(accent);

	return { group, baseMaterial, accentMaterial, accentDefaultHex: accentColor };
}

interface HaloMeshResult {
	group: THREE.Group;
	outerMaterial: THREE.MeshBasicMaterial;
	innerMaterial: THREE.MeshBasicMaterial;
	defaultHex: number;
}

function createHaloMesh(actor: ActorTokenDescriptor): HaloMeshResult {
	const group = new THREE.Group();
	const { width } = getActorTokenWorldSize(actor.size);
	const radius = width * ACTOR_TOKEN_HALO.RADIUS_SCALE;
	const color = actor.kind === "character"
		? ACTOR_TOKEN_COLORS.CHARACTER_BASE
		: ACTOR_TOKEN_COLORS.ENTITY_BASE;

	const haloGeometry = new THREE.TorusGeometry(
		radius,
		ACTOR_TOKEN_HALO.OUTER_TUBE_RADIUS,
		ACTOR_TOKEN_HALO.TUBE_SEGMENTS,
		ACTOR_TOKEN_HALO.OUTER_RADIAL_SEGMENTS
	);
	const outerMaterial = new THREE.MeshBasicMaterial({
		color,
		transparent: true,
		opacity: ACTOR_TOKEN_HALO.OUTER_DEFAULT_OPACITY,
		depthWrite: true,
	});
	const halo = new THREE.Mesh(haloGeometry, outerMaterial);
	halo.rotation.x = Math.PI / 2;
	halo.position.y = ACTOR_TOKEN_PLACEMENT.AIRBORNE_HALO_HEIGHT;
	group.add(halo);

	const innerGeometry = new THREE.TorusGeometry(
		radius * ACTOR_TOKEN_HALO.INNER_RADIUS_SCALE,
		ACTOR_TOKEN_HALO.INNER_TUBE_RADIUS,
		ACTOR_TOKEN_HALO.TUBE_SEGMENTS,
		ACTOR_TOKEN_HALO.INNER_RADIAL_SEGMENTS
	);
	const innerMaterial = new THREE.MeshBasicMaterial({
		color,
		transparent: true,
		opacity: ACTOR_TOKEN_HALO.INNER_DEFAULT_OPACITY,
		depthWrite: true,
	});
	const innerHalo = new THREE.Mesh(innerGeometry, innerMaterial);
	innerHalo.rotation.x = Math.PI / 2;
	innerHalo.position.y =
		ACTOR_TOKEN_PLACEMENT.AIRBORNE_HALO_HEIGHT + ACTOR_TOKEN_HALO.INNER_Y_OFFSET;
	group.add(innerHalo);

	return { group, outerMaterial, innerMaterial, defaultHex: color };
}

function createShadowMesh(
	actor: ActorTokenDescriptor,
	terrain: VoxelTerrain,
	texture: THREE.Texture
): THREE.Mesh {
	const { width } = getActorTokenWorldSize(actor.size);
	const surfaceHeight = getVoxelSurfaceHeight(
		terrain,
		actor.position.x,
		actor.position.y
	);
	const baseHeight = getActorBaseHeight(actor, terrain);
	const heightDelta = baseHeight - surfaceHeight;
	const airborne = heightDelta > ACTOR_TOKEN_PLACEMENT.AIRBORNE_THRESHOLD;
	const { scale, opacity } = airborne
		? calculateAirborneShadowParams(heightDelta)
		: calculateShadowParams(heightDelta);
	const zScale = airborne
		? ACTOR_TOKEN_SHADOW.AIRBORNE_Z_SCALE
		: ACTOR_TOKEN_SHADOW.GROUNDED_Z_SCALE;
	const geometry = new THREE.PlaneGeometry(
		width * ACTOR_TOKEN_SHADOW.WIDTH_SCALE * scale,
		width * zScale * scale
	);
	const material = new THREE.MeshBasicMaterial({
		map: texture,
		transparent: true,
		opacity,
		depthWrite: false,
	});
	const mesh = new THREE.Mesh(geometry, material);
	mesh.rotation.x = -Math.PI / 2;
	mesh.position.y = surfaceHeight - baseHeight + ACTOR_TOKEN_SHADOW.Y_OFFSET;
	mesh.renderOrder = ACTOR_TOKEN_RENDER_ORDER.SHADOW;
	return mesh;
}

function disposeObjectMeshes(object: THREE.Object3D): void {
	object.traverse((child) => {
		if (!(child instanceof THREE.Mesh)) return;
		child.geometry.dispose();
		if (Array.isArray(child.material)) {
			child.material.forEach((material) => material.dispose());
		} else {
			child.material.dispose();
		}
	});
}

function createSupportGroup(
	actor: ActorTokenDescriptor,
	airborne: boolean
): {
	group: THREE.Group;
	colors: ColorHandle[];
	haloOpacities: OpacityHandle[];
} {
	const colors: ColorHandle[] = [];
	const haloOpacities: OpacityHandle[] = [];

	if (airborne) {
		const halo = createHaloMesh(actor);
		colors.push(
			{ material: halo.outerMaterial, defaultHex: halo.defaultHex },
			{ material: halo.innerMaterial, defaultHex: halo.defaultHex }
		);
		haloOpacities.push(
			{
				material: halo.outerMaterial,
				defaultOpacity: ACTOR_TOKEN_HALO.OUTER_DEFAULT_OPACITY,
				selectedOpacity: ACTOR_TOKEN_HALO.OUTER_SELECTED_OPACITY,
			},
			{
				material: halo.innerMaterial,
				defaultOpacity: ACTOR_TOKEN_HALO.INNER_DEFAULT_OPACITY,
				selectedOpacity: ACTOR_TOKEN_HALO.INNER_SELECTED_OPACITY,
			}
		);
		return { group: halo.group, colors, haloOpacities };
	}

	const base = createBaseMesh(actor);
	colors.push(
		{ material: base.baseMaterial, defaultHex: ACTOR_TOKEN_COLORS.BASE },
		{ material: base.accentMaterial, defaultHex: base.accentDefaultHex }
	);
	return { group: base.group, colors, haloOpacities };
}

function setPlaneBottomOffset(mesh: THREE.Mesh | undefined, actor: ActorTokenDescriptor, bottomOffset: number): void {
	if (!mesh) return;
	const { height } = getActorTokenWorldSize(actor.size, actor.cutout);
	mesh.position.y = bottomOffset + height / 2;
}

function refreshSupportVisual(
	visual: ActorVisualHandles,
	actor: ActorTokenDescriptor,
	terrain: VoxelTerrain,
	shadowTexture: THREE.Texture,
	selected: boolean
): SelectionHandles | null {
	const supportMode = getActorSupportMode(actor, terrain);
	const airborne = supportMode === "airborne";

	visual.group.remove(visual.shadow);
	disposeObjectMeshes(visual.shadow);
	visual.shadow = createShadowMesh(actor, terrain, shadowTexture);
	visual.group.add(visual.shadow);

	let nextHandles: SelectionHandles | null = null;
	if (visual.supportMode !== supportMode) {
		visual.group.remove(visual.supportGroup);
		disposeObjectMeshes(visual.supportGroup);
		const support = createSupportGroup(actor, airborne);
		visual.supportGroup = support.group;
		visual.supportMode = supportMode;
		visual.group.add(visual.supportGroup);
		nextHandles = {
			overlay: visual.selectionOverlay,
			colors: support.colors,
			haloOpacities: support.haloOpacities,
		};
	}

	const bottomOffset = getStandeeBottomOffset(actor, airborne);
	setPlaneBottomOffset(visual.standee, actor, bottomOffset);
	setPlaneBottomOffset(visual.selectionOverlay, actor, bottomOffset);
	setPlaneBottomOffset(visual.pickMesh, actor, bottomOffset);
	visual.actor = actor;

	if (nextHandles) applySelection(nextHandles, selected);
	return nextHandles;
}

function getActorHeightRange(actor: ActorTokenDescriptor, terrain: VoxelTerrain): {
	min: number;
	max: number;
} {
	const min = getVoxelRulesSurfaceHeight(
		terrain,
		actor.position.x,
		actor.position.y
	);
	const max = Math.ceil(Math.max(terrain.Height, getMaxVoxelSurfaceHeight(terrain)));
	return { min, max: Math.max(min, max) };
}

function createFlightGuide(
	actor: ActorTokenDescriptor,
	terrain: VoxelTerrain,
	targetPosition: THREE.Vector3
): THREE.Line {
	const offsetX = (terrain.Width - 1) / 2;
	const offsetZ = (terrain.Length - 1) / 2;
	const surfaceHeight = getVoxelSurfaceHeight(
		terrain,
		actor.position.x,
		actor.position.y
	);
	const x = actor.position.x - offsetX;
	const z = actor.position.y - offsetZ;
	const y0 =
		surfaceHeight +
		ACTOR_TOKEN_PLACEMENT.TERRAIN_WORLD_Y_OFFSET +
		ACTOR_TOKEN_HEIGHT_DRAG.GUIDE_Y_OFFSET;
	const y1 = targetPosition.y;
	const geometry = new THREE.BufferGeometry().setFromPoints([
		new THREE.Vector3(x, y0, z),
		new THREE.Vector3(x, y1, z),
	]);
	const material = new THREE.LineBasicMaterial({
		color: ACTOR_TOKEN_HEIGHT_DRAG.GUIDE_COLOR,
		transparent: true,
		opacity: ACTOR_TOKEN_HEIGHT_DRAG.GUIDE_OPACITY,
		depthTest: true,
	});
	const line = new THREE.Line(geometry, material);
	line.renderOrder = ACTOR_TOKEN_HEIGHT_DRAG.GUIDE_RENDER_ORDER;
	return line;
}

function disposeLine(line: THREE.Line): void {
	line.geometry.dispose();
	if (Array.isArray(line.material)) {
		line.material.forEach((material) => material.dispose());
	} else {
		line.material.dispose();
	}
}

export function ThreeDActorLayer({
	resources,
	characters,
	entities,
	cutoutImageIds,
	selectedActor,
	actorLayerSignature,
	terrain,
	isDM,
	imageService,
	onActorClick,
	onActorSelect,
	canControlActor,
	onActorDragEnd,
}: ThreeDActorLayerProps) {
	// Stash callable/external dependencies in refs so a fresh ImageService
	// (e.g., after CampaignView reconnects) or a new onActorClick callback
	// reference does NOT trigger a teardown + async texture re-load of every
	// actor token. The build effect reads these via refs at construction time
	// and on each pointer event.
	const imageServiceRef = useRef(imageService);
	const onActorClickRef = useRef(onActorClick);
	const onActorSelectRef = useRef(onActorSelect);
	const canControlActorRef = useRef(canControlActor);
	const onActorDragEndRef = useRef(onActorDragEnd);
	const selectedActorRef = useRef(selectedActor);
	const terrainRef = useRef(terrain);
	const selectionHandlesRef = useRef<Map<string, SelectionHandles>>(new Map());
	const actorGroupsRef = useRef<Map<string, THREE.Group>>(new Map());
	const targetPositionsRef = useRef<Map<string, THREE.Vector3>>(new Map());
	const moveAnimationsRef = useRef<Map<string, ActorMoveAnimation>>(new Map());
	const moveAnimationRafRef = useRef(0);
	const previousVisualPositionsRef = useRef<Map<string, THREE.Vector3>>(new Map());
	const visualHandlesRef = useRef<Map<string, ActorVisualHandles>>(new Map());
	const shadowTextureRef = useRef<THREE.Texture | null>(null);
	const dragStateRef = useRef<ActorDragState | null>(null);
	const flightGuideRef = useRef<THREE.Line | null>(null);
	const descriptorsByKeyRef = useRef<Map<string, ActorTokenDescriptor>>(
		createDescriptorMap(characters, entities, cutoutImageIds)
	);

	descriptorsByKeyRef.current = createDescriptorMap(
		characters,
		entities,
		cutoutImageIds
	);

	useEffect(() => {
		imageServiceRef.current = imageService;
	}, [imageService]);

	useEffect(() => {
		onActorClickRef.current = onActorClick;
	}, [onActorClick]);

	useEffect(() => {
		onActorSelectRef.current = onActorSelect;
	}, [onActorSelect]);

	useEffect(() => {
		canControlActorRef.current = canControlActor;
	}, [canControlActor]);

	useEffect(() => {
		onActorDragEndRef.current = onActorDragEnd;
	}, [onActorDragEnd]);

	useEffect(() => {
		selectedActorRef.current = selectedActor;
	}, [selectedActor]);

	useEffect(() => {
		terrainRef.current = terrain;
	}, [terrain]);

	const tickMoveAnimations = (now: number) => {
		moveAnimationRafRef.current = 0;
		for (const [key, animation] of Array.from(moveAnimationsRef.current)) {
			const rawT = (now - animation.startedAt) / animation.durationMs;
			const t = Math.min(1, Math.max(0, rawT));
			animation.group.position.lerpVectors(
				animation.from,
				animation.to,
				easeInOutCubic(t)
			);

			if (t >= 1) {
				animation.group.position.copy(animation.to);
				moveAnimationsRef.current.delete(key);
			}
		}

		if (moveAnimationsRef.current.size > 0) {
			moveAnimationRafRef.current = requestAnimationFrame(tickMoveAnimations);
		}
	};

	const scheduleMoveAnimationTick = () => {
		if (moveAnimationRafRef.current !== 0) return;
		moveAnimationRafRef.current = requestAnimationFrame(tickMoveAnimations);
	};

	const animateActorToPosition = (
		actorKey: string,
		actor: ActorTokenDescriptor,
		position: Position,
		durationMs?: number
	) => {
		const actorGroup = actorGroupsRef.current.get(actorKey);
		if (!actorGroup) return;

		const targetActor: ActorTokenDescriptor = {
			...actor,
			position,
		};
		const targetPosition = getActorGroundPosition(targetActor, terrainRef.current);
		targetPositionsRef.current.set(actorKey, targetPosition.clone());
		moveAnimationsRef.current.set(actorKey, {
			group: actorGroup,
			from: actorGroup.position.clone(),
			to: targetPosition,
			startedAt: performance.now(),
			durationMs:
				durationMs ?? getMovementAnimationDuration(actorGroup.position, targetPosition),
		});
		scheduleMoveAnimationTick();
	};

	const clearFlightGuide = () => {
		const guide = flightGuideRef.current;
		if (!guide) return;
		resources.scene.remove(guide);
		disposeLine(guide);
		flightGuideRef.current = null;
	};

	const updateFlightGuide = (
		actor: ActorTokenDescriptor,
		position: Position
	) => {
		clearFlightGuide();
		const targetActor: ActorTokenDescriptor = {
			...actor,
			position,
		};
		const currentTerrain = terrainRef.current;
		const targetPosition = getActorGroundPosition(targetActor, currentTerrain);
		const guide = createFlightGuide(targetActor, currentTerrain, targetPosition);
		resources.scene.add(guide);
		flightGuideRef.current = guide;
	};

	useEffect(() => {
		let disposed = false;
		const group = new THREE.Group();
		const textures: THREE.Texture[] = [];
		const managedResources: ManagedResource[] = [];
		// Pick meshes are also published into resources.actorPickTargets so
		// the movement layer can probe "is the cursor over an actor?" and
		// suppress the tile hover behind the actor. The two arrays stay in
		// sync (this effect owns both lifecycles).
		const pickTargets: THREE.Object3D[] = [];
		const sharedPickTargets = resources.actorPickTargets;
		sharedPickTargets.length = 0;
		const raycaster = new THREE.Raycaster();
		const shadowTexture = createShadowTexture();
		const selectionTexture = createSelectionOutlineTexture();
		textures.push(shadowTexture, selectionTexture);
		shadowTextureRef.current = shadowTexture;
		const handlesByKey = selectionHandlesRef.current;
		const actorGroupsByKey = actorGroupsRef.current;
		const targetPositionsByKey = targetPositionsRef.current;
		const visualHandlesByKey = visualHandlesRef.current;
		handlesByKey.clear();
		actorGroupsByKey.clear();
		targetPositionsByKey.clear();
		visualHandlesByKey.clear();
		moveAnimationsRef.current.clear();

		resources.scene.add(group);

		const descriptors = Array.from(descriptorsByKeyRef.current.values());

		const addActorToken = async (actor: ActorTokenDescriptor) => {
			const texture = await createActorTokenTexture(actor, {
				isDM,
				imageService: imageServiceRef.current,
			});
			if (disposed) {
				texture.dispose();
				return;
			}

			textures.push(texture);
			const actorGroup = new THREE.Group();
			const key = getActorKey(actor.kind, actor.id);
			const latestActor = descriptorsByKeyRef.current.get(key) ?? actor;
			const currentTerrain = terrainRef.current;
			const targetPosition = getActorGroundPosition(latestActor, currentTerrain);
			const previousVisualPosition = previousVisualPositionsRef.current.get(key);
			previousVisualPositionsRef.current.delete(key);
			actorGroup.position.copy(previousVisualPosition ?? targetPosition);
			actorGroup.userData = {
				actorId: actor.id,
				kind: actor.kind,
				moveSpeed: actor.moveSpeed,
			};

			const supportMode = getActorSupportMode(actor, currentTerrain);
			const airborne = supportMode === "airborne";
			const shadow = createShadowMesh(actor, currentTerrain, shadowTexture);
			const standeeBottomOffset = getStandeeBottomOffset(actor, airborne);
			const support = createSupportGroup(actor, airborne);

			const standee = createStandeeMesh(
				texture,
				actor,
				resources,
				actorGroup,
				standeeBottomOffset
			);
			// Cutout actors render frameless -- a square selection frame around a
			// transparent figure would defeat the purpose. Selection still flips
			// the base/halo color for a visible signal.
			const selectionOverlay = actor.cutout
				? null
				: createSelectionOverlayMesh(
						selectionTexture,
						actor,
						resources,
						actorGroup,
						standeeBottomOffset
				  );
			const pickMesh = createPickMesh(
				actor,
				resources,
				actorGroup,
				standeeBottomOffset
			);

			// Note: when present, selectionOverlay.material.map is the SHARED
			// selectionTexture; disposing the material does not dispose its
			// texture, so the shared texture is safely disposed once via the
			// `textures` array.
			managedResources.push(
				...getMeshResources(shadow),
				...support.group.children.flatMap((child) => {
					return child instanceof THREE.Mesh ? getMeshResources(child) : [];
				}),
				...getMeshResources(standee),
				...(selectionOverlay ? getMeshResources(selectionOverlay) : []),
				...getMeshResources(pickMesh)
			);
			pickTargets.push(pickMesh);
			sharedPickTargets.push(pickMesh);

			actorGroup.add(shadow, support.group, standee, pickMesh);
			if (selectionOverlay) {
				actorGroup.add(selectionOverlay);
			}
			group.add(actorGroup);

			const handles: SelectionHandles = {
				overlay: selectionOverlay ?? undefined,
				colors: support.colors,
				haloOpacities: support.haloOpacities,
			};
			handlesByKey.set(key, handles);
			actorGroupsByKey.set(key, actorGroup);
			targetPositionsByKey.set(key, targetPosition.clone());
			visualHandlesByKey.set(key, {
				group: actorGroup,
				shadow,
				supportGroup: support.group,
				standee,
				selectionOverlay: selectionOverlay ?? undefined,
				pickMesh,
				supportMode,
				actor,
			});

			if (
				previousVisualPosition &&
				previousVisualPosition.distanceToSquared(targetPosition) >
					ACTOR_TOKEN_MOVEMENT_ANIMATION.POSITION_EPSILON
			) {
				moveAnimationsRef.current.set(key, {
					group: actorGroup,
					from: previousVisualPosition.clone(),
					to: targetPosition,
					startedAt: performance.now(),
					durationMs: getMovementAnimationDuration(
						previousVisualPosition,
						targetPosition
					),
				});
				scheduleMoveAnimationTick();
			}

			// Apply current selection state to the freshly-built token. The
			// separate selection effect below handles subsequent toggles.
			const currentSelected = selectedActorRef.current;
			const isSelected =
				!!currentSelected &&
				getActorKey(currentSelected.kind, currentSelected.id) === key;
			applySelection(handles, isSelected);
		};

		for (const actor of descriptors) {
			void addActorToken(actor);
		}

		// ---------- Actor height drag ----------
		// Terrain clicks own x/z movement. Dragging an actor is only a
		// vertical flight control for the selected, controllable flier.
		// A press/release below the drag threshold remains a selection click.

		const dragRayPointer = new THREE.Vector2();
		const tmpWorldPos = new THREE.Vector3();

		const findActorUnderPointer = (
			event: PointerEvent
		): { actor: ActorTokenDescriptor; key: string } | null => {
			const rect = resources.domElement.getBoundingClientRect();
			dragRayPointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
			dragRayPointer.y =
				-((event.clientY - rect.top) / rect.height) * 2 + 1;
			raycaster.setFromCamera(dragRayPointer, resources.camera);

			// Precise pick first: raycast against the (1.25x) pick meshes.
			// Eat hits that are clearly behind terrain.
			const actorHits = raycaster.intersectObjects(pickTargets, true);
			const occlusionHit = raycaster.intersectObjects(
				resources.occlusionTargets,
				true
			)[0];
			for (const hit of actorHits) {
				if (
					occlusionHit &&
					occlusionHit.distance <
						hit.distance - ACTOR_TOKEN_OCCLUSION.EPSILON
				) {
					continue;
				}
				const { actorId, kind } = hit.object.userData ?? {};
				if (!actorId || !kind) continue;
				const key = getActorKey(kind, actorId);
				const actor = descriptorsByKeyRef.current.get(key);
				if (actor) return { actor, key };
			}

			// Generous fallback: project each actor's pick mesh to screen
			// space and pick the nearest within the proximity radius. This
			// handles small billboards (zoomed out) and fliers floating
			// well above terrain. Occlusion is implicit -- if the cursor
			// were exactly on the token the raycast would already have
			// won, so the proximity branch is for "near, not on" cases.
			let best: {
				key: string;
				actor: ActorTokenDescriptor;
				distance: number;
			} | null = null;
			for (const pickMesh of pickTargets) {
				const { actorId, kind } = pickMesh.userData ?? {};
				if (!actorId || !kind) continue;
				const key = getActorKey(kind, actorId);
				const actor = descriptorsByKeyRef.current.get(key);
				if (!actor) continue;
				pickMesh.getWorldPosition(tmpWorldPos);
				const ndc = tmpWorldPos.clone().project(resources.camera);
				const sx = ((ndc.x + 1) / 2) * rect.width + rect.left;
				const sy = ((1 - ndc.y) / 2) * rect.height + rect.top;
				const dist = Math.hypot(event.clientX - sx, event.clientY - sy);
				if (
					dist <= ACTOR_TOKEN_DRAG.PROXIMITY_RADIUS_PX &&
					(!best || dist < best.distance)
				) {
					best = { key, actor, distance: dist };
				}
			}
			return best;
		};

		const applyCandidatePosition = (drag: ActorDragState) => {
			const visual = visualHandlesRef.current.get(drag.actorKey);
			const shadowTexture = shadowTextureRef.current;
			const visualActor: ActorTokenDescriptor = {
				...drag.descriptor,
				position: drag.candidatePosition,
			};
			const selectedKey = selectedActorRef.current
				? getActorKey(
						selectedActorRef.current.kind,
						selectedActorRef.current.id
				  )
				: null;
			const currentTerrain = terrainRef.current;
			if (visual && shadowTexture) {
				const nextHandles = refreshSupportVisual(
					visual,
					visualActor,
					currentTerrain,
					shadowTexture,
					drag.actorKey === selectedKey
				);
				if (nextHandles) {
					selectionHandlesRef.current.set(drag.actorKey, nextHandles);
				}
				// Hide the static shadow during drag -- the support visual's
				// own shadow is recomputed at the candidate position each
				// pointermove.
				visual.shadow.visible = false;
			}
			if (drag.descriptor.canFly) {
				updateFlightGuide(visualActor, drag.candidatePosition);
			}
			animateActorToPosition(
				drag.actorKey,
				drag.descriptor,
				drag.candidatePosition,
				ACTOR_TOKEN_DRAG.FOLLOW_ANIMATION_DURATION_MS
			);
		};

		const beginDragIfPastThreshold = (
			drag: ActorDragState,
			event: PointerEvent
		) => {
			if (drag.hasDragged) return;
			if (!drag.canDragHeight) return;
			const dx = event.clientX - drag.startClientX;
			const dy = event.clientY - drag.startClientY;
			if (Math.hypot(dx, dy) < ACTOR_TOKEN_HEIGHT_DRAG.START_THRESHOLD_PX) {
				return;
			}
			drag.hasDragged = true;
			selectedActorRef.current = drag.actor;
			onActorSelectRef.current(drag.actor);
			applySelectionToAll(selectionHandlesRef.current, drag.actor);
			resources.dragState.active = true;
		};

		const handlePointerMove = (event: PointerEvent) => {
			const drag = dragStateRef.current;
			if (!drag || event.pointerId !== drag.pointerId) return;

			beginDragIfPastThreshold(drag, event);
			if (!drag.hasDragged || !drag.canDragHeight) return;

			const pointerDx = event.clientX - drag.startClientX;
			const pointerDy = event.clientY - drag.startClientY;
			const projectedDelta =
				(pointerDx * drag.projectedUpX + pointerDy * drag.projectedUpY) /
				(drag.pixelsPerHeight * drag.pixelsPerHeight);
			const heightRange = getActorHeightRange(drag.descriptor, terrainRef.current);
			const nextH = clampHeight(
				Math.round(drag.startPosition.h + projectedDelta),
				heightRange.min,
				heightRange.max
			);

			if (nextH === drag.candidatePosition.h) return;

			drag.candidatePosition = {
				...drag.startPosition,
				h: nextH,
			};
			applyCandidatePosition(drag);
			event.preventDefault();
			event.stopImmediatePropagation();
		};

		const restoreVisualOnCancel = (drag: ActorDragState) => {
			const visual = visualHandlesRef.current.get(drag.actorKey);
			const shadowTexture = shadowTextureRef.current;
			const selectedKey = selectedActorRef.current
				? getActorKey(
						selectedActorRef.current.kind,
						selectedActorRef.current.id
				  )
				: null;
			const currentTerrain = terrainRef.current;
			if (visual && shadowTexture) {
				const restoredActor: ActorTokenDescriptor = {
					...drag.descriptor,
					position: drag.startPosition,
				};
				const nextHandles = refreshSupportVisual(
					visual,
					restoredActor,
					currentTerrain,
					shadowTexture,
					drag.actorKey === selectedKey
				);
				if (nextHandles) {
					selectionHandlesRef.current.set(drag.actorKey, nextHandles);
				}
				visual.shadow.visible = true;
			}
			animateActorToPosition(
				drag.actorKey,
				drag.descriptor,
				drag.startPosition,
				ACTOR_TOKEN_DRAG.CANCEL_ANIMATION_DURATION_MS
			);
		};

		const finishActorDrag = (event: PointerEvent) => {
			const drag = dragStateRef.current;
			if (!drag || event.pointerId !== drag.pointerId) return;

			dragStateRef.current = null;
			clearFlightGuide();
			resources.dragState.active = false;

			if (!drag.hasDragged) {
				// Click without crossing the drag threshold -> toggle selection.
				const visual = visualHandlesRef.current.get(drag.actorKey);
				if (visual) visual.shadow.visible = true;
				onActorClickRef.current(drag.actor);
				return;
			}

			if (!drag.canDragHeight) {
				restoreVisualOnCancel(drag);
				return;
			}

			const startSamePosition =
				drag.candidatePosition.x === drag.startPosition.x &&
				drag.candidatePosition.y === drag.startPosition.y &&
				drag.candidatePosition.h === drag.startPosition.h;

			if (startSamePosition) {
				// Drag dragged-then-returned to origin -- treat as no-op.
				restoreVisualOnCancel(drag);
				return;
			}

			event.preventDefault();
			event.stopPropagation();
			event.stopImmediatePropagation();

			// Commit visually first (so there's no flicker before the
			// post-action descriptor refresh re-applies the same target).
			const visual = visualHandlesRef.current.get(drag.actorKey);
			if (visual) visual.shadow.visible = true;
			onActorDragEndRef.current?.(drag.actor, drag.candidatePosition);
		};

		const cancelActorDrag = (event: PointerEvent) => {
			const drag = dragStateRef.current;
			if (!drag || event.pointerId !== drag.pointerId) return;
			dragStateRef.current = null;
			clearFlightGuide();
			resources.dragState.active = false;
			restoreVisualOnCancel(drag);
		};

		const handlePointerDown = (event: PointerEvent) => {
			if (event.button !== 0) return;
			if (event.altKey) return;
			const found = findActorUnderPointer(event);
			if (!found) return;

			const { actor: descriptor, key: actorKey } = found;
			const actor: SelectedActor = {
				id: descriptor.id,
				kind: descriptor.kind,
				moveSpeed:
					descriptor.moveSpeed ?? ACTOR_TOKEN_PICK.FALLBACK_MOVE_SPEED,
			};
			const canDragHeight =
				descriptor.canFly &&
				(canControlActorRef.current?.(actor) ?? false);
			const startWorldPosition = getActorGroundPosition(descriptor, terrainRef.current);
			const heightMetrics = getProjectedHeightDragMetrics(
				resources,
				startWorldPosition
			);

			event.preventDefault();
			event.stopPropagation();
			event.stopImmediatePropagation();

			dragStateRef.current = {
				pointerId: event.pointerId,
				actor,
				actorKey,
				descriptor,
				startClientX: event.clientX,
				startClientY: event.clientY,
				startPosition: { ...descriptor.position },
				candidatePosition: { ...descriptor.position },
				hasDragged: false,
				canDragHeight,
				...heightMetrics,
			};
		};

		resources.domElement.addEventListener("pointerdown", handlePointerDown, true);
		window.addEventListener("pointermove", handlePointerMove, true);
		window.addEventListener("pointerup", finishActorDrag, true);
		window.addEventListener("pointercancel", cancelActorDrag, true);
		return () => {
			disposed = true;
			resources.domElement.removeEventListener("pointerdown", handlePointerDown, true);
			window.removeEventListener("pointermove", handlePointerMove, true);
			window.removeEventListener("pointerup", finishActorDrag, true);
			window.removeEventListener("pointercancel", cancelActorDrag, true);
			const drag = dragStateRef.current;
			if (drag) {
				const visual = visualHandlesRef.current.get(drag.actorKey);
				if (visual) {
					visual.shadow.visible = true;
				}
			}
			dragStateRef.current = null;
			resources.dragState.active = false;
			clearFlightGuide();
			const previousVisualPositions = previousVisualPositionsRef.current;
			previousVisualPositions.clear();
			for (const [key, actorGroup] of actorGroupsByKey) {
				previousVisualPositions.set(key, actorGroup.position.clone());
			}
			resources.scene.remove(group);
			disposeObjectMeshes(group);
			group.clear();
			handlesByKey.clear();
			actorGroupsByKey.clear();
			targetPositionsByKey.clear();
			visualHandlesByKey.clear();
			shadowTextureRef.current = null;
			sharedPickTargets.length = 0;
			moveAnimationsRef.current.clear();
			for (const resource of managedResources) {
				resource.dispose();
			}
			for (const texture of textures) {
				texture.dispose();
			}
		};
		// Intentionally NOT including imageService, onActorClick, or
		// selectedActor: those flow through refs so a reconnect or selection
		// change doesn't tear down every token and re-fetch its texture.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [resources, actorLayerSignature, isDM]);

	useEffect(() => {
		const now = performance.now();
		const liveKeys = new Set(descriptorsByKeyRef.current.keys());
		const selectedKey = selectedActorRef.current
			? getActorKey(selectedActorRef.current.kind, selectedActorRef.current.id)
			: null;
		const shadowTexture = shadowTextureRef.current;

		for (const [key, actor] of descriptorsByKeyRef.current) {
			const actorGroup = actorGroupsRef.current.get(key);
			if (!actorGroup) continue;
			const visual = visualHandlesRef.current.get(key);

			if (visual && shadowTexture) {
				const nextHandles = refreshSupportVisual(
					visual,
					actor,
					terrain,
					shadowTexture,
					key === selectedKey
				);
				if (nextHandles) {
					selectionHandlesRef.current.set(key, nextHandles);
				}
			}

			const nextTarget = getActorGroundPosition(actor, terrain);
			const currentTarget = targetPositionsRef.current.get(key);
			if (
				currentTarget &&
				currentTarget.distanceToSquared(nextTarget) <=
					ACTOR_TOKEN_MOVEMENT_ANIMATION.POSITION_EPSILON
			) {
				continue;
			}

			targetPositionsRef.current.set(key, nextTarget.clone());
			moveAnimationsRef.current.set(key, {
				group: actorGroup,
				from: actorGroup.position.clone(),
				to: nextTarget,
				startedAt: now,
				durationMs: getMovementAnimationDuration(actorGroup.position, nextTarget),
			});
			scheduleMoveAnimationTick();
		}

		for (const key of Array.from(targetPositionsRef.current.keys())) {
			if (liveKeys.has(key)) continue;
			targetPositionsRef.current.delete(key);
			moveAnimationsRef.current.delete(key);
		}
	}, [characters, entities, cutoutImageIds, terrain]);

	useEffect(() => {
		return () => {
			if (moveAnimationRafRef.current !== 0) {
				cancelAnimationFrame(moveAnimationRafRef.current);
				moveAnimationRafRef.current = 0;
			}
		};
	}, []);

	useEffect(() => {
		applySelectionToAll(selectionHandlesRef.current, selectedActor);
	}, [selectedActor]);

	return null;
}
