import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { PING_DURATION_MS } from "../../../domains/Ping/Ping";
import type { VoxelTerrain } from "../../../domains/VoxelTerrain/VoxelTerrain";
import { getVoxelSurfaceHeight } from "../../../utils/VoxelTerrainUtils";
import type { ActivePing } from "../hooks/useActivePings";
import type { ThreeDSceneResources } from "../Actors3D/actorTokenTypes";
import { terrainHeightToWorldY } from "../Actors3D/actorTokenPlacement";
import {
	getHitWorldNormal,
	intersectFirstTerrainHit,
	worldPointToVoxelTile,
} from "../Movement3D/movement3DHelpers";
import {
	THREE_D_PING_INPUT,
	THREE_D_PING_MARKER,
} from "../threeDMapConstants";

interface ThreeDPingLayerProps {
	resources: ThreeDSceneResources;
	terrain: VoxelTerrain;
	activePings: ActivePing[];
	onPingTile: (tile: { x: number; y: number }) => void;
}

interface PingVisual {
	group: THREE.Group;
	tileGroup: THREE.Group;
	fillMaterial: THREE.MeshBasicMaterial;
	outlineMaterial: THREE.MeshBasicMaterial;
	arrow: THREE.Sprite;
	arrowMaterial: THREE.SpriteMaterial;
	baseArrowY: number;
	timestamp: number;
}

function createPingSignature(activePings: ActivePing[]): string {
	return activePings
		.map((ping) => `${ping.id}:${ping.x},${ping.y},${ping.timestamp}`)
		.sort()
		.join("|");
}

function getPingWorldPosition(terrain: VoxelTerrain, x: number, y: number): THREE.Vector3 | null {
	if (x < 0 || x >= terrain.Width || y < 0 || y >= terrain.Length) return null;

	const offsetX = (terrain.Width - 1) / 2;
	const offsetZ = (terrain.Length - 1) / 2;
	const surfaceHeight = getVoxelSurfaceHeight(terrain, x, y);

	return new THREE.Vector3(
		x - offsetX,
		terrainHeightToWorldY(surfaceHeight) + THREE_D_PING_MARKER.TILE_Y_OFFSET,
		y - offsetZ
	);
}

function createSquareRingGeometry(): THREE.ShapeGeometry {
	const half = 0.5;
	const inner = half - THREE_D_PING_MARKER.OUTLINE_WIDTH;
	const shape = new THREE.Shape([
		new THREE.Vector2(-half, -half),
		new THREE.Vector2(half, -half),
		new THREE.Vector2(half, half),
		new THREE.Vector2(-half, half),
	]);
	const hole = new THREE.Path([
		new THREE.Vector2(-inner, -inner),
		new THREE.Vector2(-inner, inner),
		new THREE.Vector2(inner, inner),
		new THREE.Vector2(inner, -inner),
	]);
	shape.holes.push(hole);

	const geometry = new THREE.ShapeGeometry(shape);
	geometry.rotateX(-Math.PI / 2);
	return geometry;
}

function createArrowTexture(): THREE.CanvasTexture {
	const canvas = document.createElement("canvas");
	canvas.width = THREE_D_PING_MARKER.ARROW_TEXTURE_SIZE;
	canvas.height = THREE_D_PING_MARKER.ARROW_TEXTURE_SIZE;
	const ctx = canvas.getContext("2d");
	if (!ctx) {
		throw new Error("Unable to create ping arrow canvas");
	}

	const center = THREE_D_PING_MARKER.ARROW_TEXTURE_SIZE / 2;
	ctx.font = `${THREE_D_PING_MARKER.ARROW_FONT_WEIGHT} ${THREE_D_PING_MARKER.ARROW_FONT_SIZE}px ${THREE_D_PING_MARKER.ARROW_FONT_FAMILY}`;
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	ctx.lineJoin = "round";
	ctx.strokeStyle = THREE_D_PING_MARKER.ARROW_STROKE;
	ctx.lineWidth = THREE_D_PING_MARKER.ARROW_LINE_WIDTH;
	ctx.fillStyle = THREE_D_PING_MARKER.ARROW_FILL;
	ctx.strokeText(
		THREE_D_PING_MARKER.ARROW_TEXT,
		center,
		center + THREE_D_PING_MARKER.ARROW_TEXT_Y_OFFSET
	);
	ctx.fillText(
		THREE_D_PING_MARKER.ARROW_TEXT,
		center,
		center + THREE_D_PING_MARKER.ARROW_TEXT_Y_OFFSET
	);

	const texture = new THREE.CanvasTexture(canvas);
	texture.colorSpace = THREE.SRGBColorSpace;
	texture.needsUpdate = true;
	return texture;
}

function createPingVisual(
	ping: ActivePing,
	terrain: VoxelTerrain,
	arrowTexture: THREE.Texture
): PingVisual | null {
	const position = getPingWorldPosition(terrain, ping.x, ping.y);
	if (!position) return null;

	const group = new THREE.Group();
	group.position.copy(position);
	group.renderOrder = THREE_D_PING_MARKER.RENDER_ORDER;

	const fillGeometry = new THREE.PlaneGeometry(1, 1);
	fillGeometry.rotateX(-Math.PI / 2);
	const fillMaterial = new THREE.MeshBasicMaterial({
		color: THREE_D_PING_MARKER.COLOR,
		transparent: true,
		opacity: THREE_D_PING_MARKER.FILL_OPACITY,
		depthTest: true,
		depthWrite: false,
		side: THREE.DoubleSide,
	});
	const fill = new THREE.Mesh(fillGeometry, fillMaterial);
	fill.renderOrder = THREE_D_PING_MARKER.RENDER_ORDER;

	const outlineMaterial = new THREE.MeshBasicMaterial({
		color: THREE_D_PING_MARKER.COLOR,
		transparent: true,
		opacity: THREE_D_PING_MARKER.OUTLINE_OPACITY,
		depthTest: true,
		depthWrite: false,
		side: THREE.DoubleSide,
	});
	const outline = new THREE.Mesh(createSquareRingGeometry(), outlineMaterial);
	outline.renderOrder = THREE_D_PING_MARKER.RENDER_ORDER + 0.1;

	const tileGroup = new THREE.Group();
	tileGroup.add(fill, outline);
	group.add(tileGroup);

	const arrowMaterial = new THREE.SpriteMaterial({
		map: arrowTexture,
		transparent: true,
		opacity: 1,
		depthTest: true,
		depthWrite: false,
	});
	const arrow = new THREE.Sprite(arrowMaterial);
	arrow.scale.setScalar(THREE_D_PING_MARKER.ARROW_WORLD_SIZE);
	arrow.position.y = THREE_D_PING_MARKER.ARROW_BASE_Y_OFFSET;
	arrow.renderOrder = THREE_D_PING_MARKER.RENDER_ORDER + 1;
	group.add(arrow);

	return {
		group,
		tileGroup,
		fillMaterial,
		outlineMaterial,
		arrow,
		arrowMaterial,
		baseArrowY: THREE_D_PING_MARKER.ARROW_BASE_Y_OFFSET,
		timestamp: ping.timestamp,
	};
}

function disposePingVisual(visual: PingVisual): void {
	visual.group.traverse((child) => {
		if (!(child instanceof THREE.Mesh)) return;
		child.geometry.dispose();
		if (Array.isArray(child.material)) {
			child.material.forEach((material) => material.dispose());
		} else {
			child.material.dispose();
		}
	});
	visual.arrowMaterial.dispose();
}

function getPingTileFromPointer(
	event: PointerEvent,
	resources: ThreeDSceneResources,
	terrain: VoxelTerrain,
	raycaster: THREE.Raycaster,
	pointer: THREE.Vector2
): { x: number; y: number } | null {
	const rect = resources.domElement.getBoundingClientRect();
	pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
	pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
	raycaster.setFromCamera(pointer, resources.camera);

	const terrainHit = intersectFirstTerrainHit(raycaster, resources.occlusionTargets);
	if (!terrainHit) return null;

	const worldNormal = getHitWorldNormal(terrainHit);
	return worldPointToVoxelTile(terrain, terrainHit.point, worldNormal);
}

function isPingGesture(event: PointerEvent): boolean {
	return event.button === 1 || (event.button === 0 && event.altKey);
}

export function ThreeDPingLayer({
	resources,
	terrain,
	activePings,
	onPingTile,
}: ThreeDPingLayerProps) {
	const pingSignature = useMemo(
		() => createPingSignature(activePings),
		[activePings]
	);
	const pingEntries = useMemo(
		() => activePings.slice(),
		// Keep visuals alive across animation ticks that don't change the set.
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[pingSignature]
	);
	const onPingTileRef = useRef(onPingTile);

	useEffect(() => {
		onPingTileRef.current = onPingTile;
	}, [onPingTile]);

	useEffect(() => {
		if (pingEntries.length === 0) return;

		const group = new THREE.Group();
		const arrowTexture = createArrowTexture();
		const visuals: PingVisual[] = [];
		resources.scene.add(group);

		for (const ping of pingEntries) {
			const visual = createPingVisual(ping, terrain, arrowTexture);
			if (!visual) continue;
			visuals.push(visual);
			group.add(visual.group);
		}

		const tick = () => {
			const now = Date.now();
			for (const visual of visuals) {
				const age = Math.max(0, Math.min(PING_DURATION_MS, now - visual.timestamp));
				const progress = age / PING_DURATION_MS;
				const fade =
					progress < THREE_D_PING_MARKER.FADE_HOLD_PROGRESS
						? 1
						: Math.max(
							0,
							1 - (progress - THREE_D_PING_MARKER.FADE_HOLD_PROGRESS) /
								(1 - THREE_D_PING_MARKER.FADE_HOLD_PROGRESS)
						  );
				const pulsePhase =
					(age % THREE_D_PING_MARKER.PULSE_PERIOD_MS) /
					THREE_D_PING_MARKER.PULSE_PERIOD_MS;
				const pulse =
					1 +
					THREE_D_PING_MARKER.PULSE_SCALE_MULTIPLIER *
						(0.5 - 0.5 * Math.cos(pulsePhase * Math.PI * 2));
				const bouncePhase =
					(age % THREE_D_PING_MARKER.ARROW_BOUNCE_PERIOD_MS) /
					THREE_D_PING_MARKER.ARROW_BOUNCE_PERIOD_MS;
				const bounce =
					THREE_D_PING_MARKER.ARROW_BOUNCE_HEIGHT *
					Math.abs(Math.sin(bouncePhase * Math.PI));

				visual.tileGroup.scale.set(pulse, 1, pulse);
				visual.fillMaterial.opacity = THREE_D_PING_MARKER.FILL_OPACITY * fade;
				visual.outlineMaterial.opacity = THREE_D_PING_MARKER.OUTLINE_OPACITY * fade;
				visual.arrowMaterial.opacity = fade;
				visual.arrow.position.y = visual.baseArrowY + bounce;
			}
		};
		tick();
		resources.animationCallbacks.add(tick);

		return () => {
			resources.animationCallbacks.delete(tick);
			resources.scene.remove(group);
			group.clear();
			for (const visual of visuals) {
				disposePingVisual(visual);
			}
			arrowTexture.dispose();
		};
	}, [resources, terrain, pingEntries, pingSignature]);

	useEffect(() => {
		const raycaster = new THREE.Raycaster();
		const pointer = new THREE.Vector2();
		let pendingPing: {
			pointerId: number;
			startX: number;
			startY: number;
		} | null = null;

		const handlePointerDown = (event: PointerEvent) => {
			if (!isPingGesture(event)) return;
			if (resources.dragState.active) return;

			event.preventDefault();
			event.stopPropagation();
			event.stopImmediatePropagation();
			pendingPing = {
				pointerId: event.pointerId,
				startX: event.clientX,
				startY: event.clientY,
			};
		};

		const handlePointerUp = (event: PointerEvent) => {
			const pending = pendingPing;
			if (!pending || pending.pointerId !== event.pointerId) return;
			pendingPing = null;

			event.preventDefault();
			event.stopPropagation();
			event.stopImmediatePropagation();

			const dx = event.clientX - pending.startX;
			const dy = event.clientY - pending.startY;
			if (Math.hypot(dx, dy) > THREE_D_PING_INPUT.CLICK_DRAG_THRESHOLD_PX) return;

			const tile = getPingTileFromPointer(
				event,
				resources,
				terrain,
				raycaster,
				pointer
			);
			if (!tile) return;
			onPingTileRef.current(tile);
		};

		const handlePointerCancel = (event: PointerEvent) => {
			if (pendingPing?.pointerId === event.pointerId) {
				pendingPing = null;
			}
		};

		const handleAuxClick = (event: MouseEvent) => {
			if (event.button !== 1) return;
			event.preventDefault();
			event.stopPropagation();
		};

		resources.domElement.addEventListener("pointerdown", handlePointerDown, true);
		window.addEventListener("pointerup", handlePointerUp, true);
		window.addEventListener("pointercancel", handlePointerCancel, true);
		resources.domElement.addEventListener("auxclick", handleAuxClick, true);

		return () => {
			resources.domElement.removeEventListener("pointerdown", handlePointerDown, true);
			window.removeEventListener("pointerup", handlePointerUp, true);
			window.removeEventListener("pointercancel", handlePointerCancel, true);
			resources.domElement.removeEventListener("auxclick", handleAuxClick, true);
		};
	}, [resources, terrain]);

	return null;
}
