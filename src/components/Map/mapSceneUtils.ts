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
 */
export function setRaycasterFromPointer(
	raycaster: THREE.Raycaster,
	event: MouseEvent,
	resources: ThreeDSceneResources,
	pointer: THREE.Vector2
): void {
	const rect = resources.domElement.getBoundingClientRect();
	pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
	pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
	raycaster.setFromCamera(pointer, resources.camera);
}
