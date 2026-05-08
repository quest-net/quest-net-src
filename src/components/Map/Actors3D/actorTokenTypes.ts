import type * as THREE from "three";
import type { ActorSize, Position } from "../../../domains/Actor/Actor";

export type ActorKind = "character" | "entity";

export interface ActorTokenDescriptor {
	id: string;
	kind: ActorKind;
	name: string;
	imageId?: string;
	position: Position;
	moveSpeed: number;
	size: ActorSize;
	// True when the underlying Image has Cutout=true. Cutout tokens render
	// frameless with the image fitted-to-contain inside the square texture
	// (transparency shows through), and the selection overlay is suppressed
	// so a frame doesn't appear around a transparent figure.
	cutout: boolean;
	// Drives the height-drag interaction: only fliers can change altitude
	// by dragging the selected token.
	canFly: boolean;
}

export interface ThreeDSceneResources {
	scene: THREE.Scene;
	camera: THREE.Camera;
	domElement: HTMLCanvasElement;
	occlusionTargets: THREE.Object3D[];
	movementHighlight: {
		texture: THREE.Data3DTexture;
		data: Uint8Array;
		width: number;
		/** Number of tactical height levels in the texture (terrain.Height + 1). */
		heightLevels: number;
		length: number;
	};
	/**
	 * Per-frame callbacks driven by the map's main render loop. Overlay
	 * layers register here instead of starting independent RAF loops.
	 */
	animationCallbacks: Set<(now: number) => void>;
	/**
	 * Mutable list of actor pick meshes shared with the actor layer.
	 * Other layers (e.g. movement) may raycast against this to suppress
	 * tile interactions when the cursor is on top of an actor token.
	 * The actor layer owns the lifecycle of these meshes.
	 */
	actorPickTargets: THREE.Object3D[];
	/**
	 * Set to true by the actor layer while a height-drag gesture is in
	 * flight. Other layers should pause hover/click handling so they
	 * don't fight the drag.
	 */
	dragState: { active: boolean };
}
