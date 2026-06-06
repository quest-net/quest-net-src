// Door markers in the editor: small amber door icons overlaid above the canvas
// showing where the (otherwise invisible) doors on this terrain sit. Hovering a
// marker reveals the destination terrain name.
//
// Mirrors editorActorMarkers: DOM nodes are created imperatively and projected
// every rAF tick from world space into canvas pixels, avoiding React re-renders
// on the hot path.

import * as THREE from "three";
import { terrainHeightToWorldY } from "../../Map/Actors3D/actorTokenPlacement";
import type { VoxelTerrain } from "../../../domains/VoxelTerrain/VoxelTerrain";

const DOOR_OVERLAY_FLOAT_Y = 1;

export interface DoorMarkerInfo {
	/** Stable per-anchor key (a same-terrain door contributes two markers). */
	id: string;
	/** The door this marker belongs to (deleting removes the whole door). */
	doorId: string;
	anchor: { x: number; y: number; h: number };
	/** Destination terrain name, shown on hover. */
	destinationName: string;
}

const _doorVec = new THREE.Vector3();

const DOOR_BADGE_CSS =
	"width:18px;height:18px;border-radius:4px;display:flex;align-items:center;" +
	"justify-content:center;background:rgba(245,158,11,0.85);" +
	"border:1.5px solid rgba(245,158,11,1);box-shadow:0 1px 3px rgba(0,0,0,0.45)";
const DELETE_BADGE_CSS =
	"width:18px;height:18px;border-radius:4px;display:flex;align-items:center;" +
	"justify-content:center;background:rgba(239,68,68,0.9);" +
	"border:1.5px solid rgba(239,68,68,1);box-shadow:0 1px 3px rgba(0,0,0,0.45)";
const DELETE_ARM_TIMEOUT_MS = 3000;

/**
 * Imperatively (re)creates the DOM marker for each door anchor. Wipes any
 * existing children of `overlay` first. Returns a Map keyed by marker id.
 *
 * When `onDelete` is provided, a marker becomes a two-click delete affordance:
 * the first click arms it (door icon -> red trash), a second click within a few
 * seconds deletes the door; otherwise it disarms.
 */
export function buildDoorMarkers(
	overlay: HTMLDivElement,
	doors: DoorMarkerInfo[],
	onDelete?: (doorId: string) => void
): Map<string, HTMLDivElement> {
	while (overlay.firstChild) overlay.removeChild(overlay.firstChild);
	const map = new Map<string, HTMLDivElement>();
	for (const door of doors) {
		const wrapper = document.createElement("div");
		wrapper.className = "tooltip tooltip-top";
		const hoverTip = `→ ${door.destinationName}`;
		wrapper.setAttribute("data-tip", hoverTip);
		wrapper.style.cssText =
			"position:absolute;left:0;top:0;display:none;pointer-events:auto;z-index:10" +
			(onDelete ? ";cursor:pointer" : "");
		const badge = document.createElement("div");
		badge.style.cssText = DOOR_BADGE_CSS;
		const icon = document.createElement("span");
		icon.className = "icon-[mdi--door] w-3 h-3";
		icon.style.cssText = "color:#1c1917";
		badge.appendChild(icon);
		wrapper.appendChild(badge);
		overlay.appendChild(wrapper);
		map.set(door.id, wrapper);

		if (onDelete) {
			let armed = false;
			let timer: ReturnType<typeof setTimeout> | null = null;
			const disarm = () => {
				armed = false;
				if (timer) {
					clearTimeout(timer);
					timer = null;
				}
				badge.style.cssText = DOOR_BADGE_CSS;
				icon.className = "icon-[mdi--door] w-3 h-3";
				wrapper.setAttribute("data-tip", hoverTip);
			};
			wrapper.addEventListener("click", (event) => {
				event.stopPropagation();
				event.preventDefault();
				if (armed) {
					if (timer) clearTimeout(timer);
					onDelete(door.doorId);
					return;
				}
				armed = true;
				badge.style.cssText = DELETE_BADGE_CSS;
				icon.className = "icon-[mdi--trash-can] w-3 h-3";
				wrapper.setAttribute("data-tip", "Click again to delete");
				timer = setTimeout(disarm, DELETE_ARM_TIMEOUT_MS);
			});
		}
	}
	return map;
}

export function projectDoorMarkers(
	canvas: HTMLCanvasElement,
	camera: THREE.Camera,
	terrain: VoxelTerrain,
	doors: DoorMarkerInfo[],
	markerElems: Map<string, HTMLDivElement>,
	shouldShow: boolean
): void {
	if (!shouldShow) {
		markerElems.forEach((el) => {
			el.style.display = "none";
		});
		return;
	}

	const canvasW = canvas.clientWidth || 1;
	const canvasH = canvas.clientHeight || 1;

	for (const door of doors) {
		const el = markerElems.get(door.id);
		if (!el) continue;
		const worldX = door.anchor.x + 0.5 - terrain.Width / 2;
		const worldZ = door.anchor.y + 0.5 - terrain.Length / 2;
		const worldY = terrainHeightToWorldY(door.anchor.h) + DOOR_OVERLAY_FLOAT_Y;
		_doorVec.set(worldX, worldY, worldZ).project(camera);
		if (_doorVec.z > 1) {
			el.style.display = "none";
			continue;
		}
		const sx = ((_doorVec.x + 1) / 2) * canvasW;
		const sy = ((-_doorVec.y + 1) / 2) * canvasH;
		el.style.display = "";
		el.style.transform = `translate(calc(${sx}px - 50%), calc(${sy}px - 50%))`;
	}
}
