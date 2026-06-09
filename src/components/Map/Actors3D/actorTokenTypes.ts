import type * as THREE from "three";
import type { ActorSize, Position } from "../../../domains/Actor/Actor";
import type { FogVolumeTexture } from "../mapVolumetricFog";

export type ActorKind = "character" | "entity";

export interface ActorTokenDescriptor {
	id: string;
	kind: ActorKind;
	name: string;
	imageId?: string;
	color: string;
	position: Position;
	moveSpeed: number;
	size: ActorSize;
	// True when the underlying Image has Cutout=true. All tokens now render
	// frameless with the image fitted-to-contain inside the square texture, so
	// this flag no longer changes the look. It still tunes the non-visual
	// behaviour real transparency benefits from: alpha-derived pick bounds
	// (precise hit-testing against the figure) and the slightly larger standee
	// size / tighter base gap a free-standing cutout figure wants.
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
	/** Marks static shadow maps dirty so they update on the next render. */
	requestShadowUpdate: () => void;
	/**
	 * Binds the active fog-density volume to the volumetric fog pass (or null to
	 * disable fog). Set by the scene that owns the post-processing pipeline;
	 * called by the terrain builder whenever terrain geometry changes.
	 */
	setFogVolume?: (volume: FogVolumeTexture | null) => void;
	/**
	 * Mutable list of actor pick meshes shared with the actor layer.
	 * Other layers (e.g. movement) may raycast against this to suppress
	 * tile interactions when the cursor is on top of an actor token.
	 * The actor layer owns the lifecycle of these meshes.
	 */
	actorPickTargets: THREE.Object3D[];
	/**
	 * Mutable list of invisible terrain-link hitbox meshes shared with the
	 * terrain-link layer. The movement layer raycasts against this to suppress
	 * tile clicks over a link (so clicking a link interacts with it instead of
	 * walking onto it). The terrain-link layer owns the lifecycle of these meshes.
	 */
	linkPickTargets: THREE.Object3D[];
	/**
	 * Link hitboxes always exist for raycasting, but only adjacent/visible links
	 * should block terrain hover and tile clicks.
	 */
	isLinkPickTargetInteractive?: (target: THREE.Object3D) => boolean;
	/**
	 * Some visible link authoring markers intentionally render through terrain.
	 * Those should block terrain hover/click even when the terrain surface is
	 * closer than the marker along the ray.
	 */
	isLinkPickTargetTerrainBlocking?: (target: THREE.Object3D) => boolean;
	/**
	 * Set to true by the actor layer while a height-drag gesture is in
	 * flight. Other layers should pause hover/click handling so they
	 * don't fight the drag.
	 */
	dragState: { active: boolean };
}
