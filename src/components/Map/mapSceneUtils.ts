import * as THREE from "three";
import type { ThreeDSceneResources } from "./Actors3D/actorTokenTypes";

// ---------------------------------------------------------------------------
// Small Three.js scene helpers shared by the tactical overlay layers (actors,
// movement, pings, stickers). Each used to keep its own copy of these.
// ---------------------------------------------------------------------------

/**
 * Recursively dispose the geometry and material(s) of every Mesh / Line / Points
 * descendant of `object` (including `object` itself).
 *
 * Sprites are intentionally skipped: `THREE.Sprite` shares a single module-level
 * geometry across every sprite in the app, so disposing it would break unrelated
 * sprites. Layers that use sprites dispose their per-sprite materials/textures
 * explicitly.
 */
export function disposeObject3D(object: THREE.Object3D): void {
	object.traverse((child) => {
		if (
			child instanceof THREE.Mesh ||
			child instanceof THREE.Line ||
			child instanceof THREE.Points
		) {
			child.geometry.dispose();
			const material = child.material as THREE.Material | THREE.Material[];
			if (Array.isArray(material)) {
				for (const m of material) m.dispose();
			} else {
				material.dispose();
			}
		}
	});
}

/**
 * Convert a pointer/mouse event to normalized device coordinates against the
 * renderer canvas and point the raycaster from the scene's active camera through
 * it. Mutates `pointer` in place (callers reuse one Vector2 to avoid allocations).
 *
 * Returns the canvas bounding rect, which callers that also project world points
 * back to screen space can reuse instead of measuring the canvas a second time.
 */
export function setRaycasterFromPointer(
	raycaster: THREE.Raycaster,
	event: MouseEvent,
	resources: ThreeDSceneResources,
	pointer: THREE.Vector2
): DOMRect {
	const rect = resources.domElement.getBoundingClientRect();
	pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
	pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
	raycaster.setFromCamera(pointer, resources.camera);
	return rect;
}

// Screen-center in normalized device coordinates. Reused for crosshair-aimed
// raycasts (first-person), where the pointer is locked and the aim point is
// always the middle of the viewport rather than the cursor.
const SCREEN_CENTER = new THREE.Vector2(0, 0);

/**
 * Point the raycaster from the scene's active camera straight through the centre
 * of the viewport (the first-person crosshair). Unlike setRaycasterFromPointer
 * this ignores cursor position entirely — while pointer-locked the cursor is
 * hidden and centred, so the aim is wherever the camera is looking.
 */
export function setRaycasterFromCenter(
	raycaster: THREE.Raycaster,
	resources: ThreeDSceneResources
): void {
	raycaster.setFromCamera(SCREEN_CENTER, resources.camera);
}
