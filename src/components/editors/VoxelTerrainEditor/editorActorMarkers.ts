// Actor markers in the editor: small purple dots overlaid above the canvas
// showing where party members currently stand on the terrain.
//
// The DOM nodes are created imperatively (one per actor) and projected every
// frame from world space into canvas-relative pixel coordinates. We avoid React
// re-renders here because the projection runs every rAF tick.

import * as THREE from "three";
import { terrainHeightToWorldY } from "../../Map/Actors3D/actorTokenPlacement";
import type { VoxelTerrain } from "../../../domains/VoxelTerrain/VoxelTerrain";

const ACTOR_OVERLAY_FLOAT_Y = 0.2;

export interface ActorOverlayInfo {
	id: string;
	name: string;
	position: { x: number; y: number; h: number };
}

const _actorVec = new THREE.Vector3();

/**
 * Imperatively (re)creates the DOM marker for each actor in `actors`. Wipes any
 * existing children of `overlay` first. Returns a Map keyed by actor id.
 */
export function buildActorMarkers(
	overlay: HTMLDivElement,
	actors: ActorOverlayInfo[],
): Map<string, HTMLDivElement> {
	while (overlay.firstChild) overlay.removeChild(overlay.firstChild);
	const map = new Map<string, HTMLDivElement>();
	for (const actor of actors) {
		const wrapper = document.createElement("div");
		wrapper.className = "tooltip tooltip-top";
		wrapper.setAttribute("data-tip", actor.name);
		wrapper.style.cssText =
			"position:absolute;left:0;top:0;display:none;pointer-events:auto;z-index:10";
		const dot = document.createElement("div");
		dot.style.cssText =
			"width:14px;height:14px;border-radius:50%;background:rgba(167,139,250,0.65);" +
			"border:1.5px solid rgba(167,139,250,0.9);box-shadow:0 1px 3px rgba(0,0,0,0.45)";
		wrapper.appendChild(dot);
		overlay.appendChild(wrapper);
		map.set(actor.id, wrapper);
	}
	return map;
}

export function projectActorMarkers(
	canvas: HTMLCanvasElement,
	camera: THREE.Camera,
	terrain: VoxelTerrain,
	actors: ActorOverlayInfo[],
	markerElems: Map<string, HTMLDivElement>,
	shouldShow: boolean,
): void {
	if (!shouldShow) {
		markerElems.forEach((el) => { el.style.display = "none"; });
		return;
	}

	const canvasW = canvas.clientWidth  || 1;
	const canvasH = canvas.clientHeight || 1;

	for (const actor of actors) {
		const el = markerElems.get(actor.id);
		if (!el) continue;
		const worldX = actor.position.x + 0.5 - terrain.Width  / 2;
		const worldZ = actor.position.y + 0.5 - terrain.Length / 2;
		const worldY = terrainHeightToWorldY(actor.position.h) + ACTOR_OVERLAY_FLOAT_Y;
		_actorVec.set(worldX, worldY, worldZ).project(camera);
		if (_actorVec.z > 1) { el.style.display = "none"; continue; }
		const sx = ((_actorVec.x + 1) / 2) * canvasW;
		const sy = ((-_actorVec.y + 1) / 2) * canvasH;
		el.style.display = "";
		el.style.transform = `translate(calc(${sx}px - 50%), calc(${sy}px - 50%))`;
	}
}
