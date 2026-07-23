// Per-frame driver for the hero-occlusion cutout (see heroOcclusionShader.ts).
//
// Terrain materials carry an always-compiled, uniform-gated cutout that discards
// fragments between the camera and the focused actor. This hook is what feeds
// those shared uniforms each frame: it resolves the focused actor's world
// position + the active camera position and writes them into
// `resources.heroOcclusion`, toggling the cutout on/off.
//
// It registers ONE callback on the scene's shared animation loop
// (resources.animationCallbacks), mirroring the overlay layers (ThreeDPingLayer
// etc.). The cutout is disabled (enabled = 0, a single coherent shader branch)
// whenever the feature is off, there is no focused actor, or the view is
// first-person (where the camera is the actor's own eyes).

import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { ActorSize, Position } from "../../domains/Actor/Actor";
import type { VoxelTerrain } from "../../domains/VoxelTerrain/VoxelTerrain";
import {
	ACTOR_TOKEN_SIZE_SCALE,
	ACTOR_TOKEN_WORLD_SIZE,
} from "./Actors3D/actorTokenConstants";
import { getActorGroundPosition } from "./Actors3D/actorTokenPlacement";
import type {
	ActorTokenDescriptor,
	ThreeDSceneResources,
} from "./Actors3D/actorTokenTypes";
import { THREE_D_HERO_OCCLUSION } from "./threeDMapConstants";

interface UseHeroOcclusionParams {
	resources: ThreeDSceneResources | null;
	/** Active terrain (for tile -> world position). */
	terrain: VoxelTerrain | null;
	/** Focused actor's rules position: player = played actor, DM = inspector selection. */
	focusedActorPosition: Position | null;
	/** Focused actor's size, used to place the head cut plane. Defaults to "small". */
	focusedActorSize: ActorSize | null;
	/** True in the world view; the cutout is disabled in first-person. */
	isWorld: boolean;
	/** AppSettings master toggle. */
	enabled: boolean;
	/** Personal world-space radius preference (roughly one unit per tactical tile). */
	radius: number;
}

export function useHeroOcclusion({
	resources,
	terrain,
	focusedActorPosition,
	focusedActorSize,
	isWorld,
	enabled,
	radius,
}: UseHeroOcclusionParams): void {
	// Latest inputs, read inside the per-frame callback without re-registering it.
	const stateRef = useRef({
		terrain,
		focusedActorPosition,
		focusedActorSize,
		isWorld,
		enabled,
		radius,
	});
	stateRef.current = {
		terrain,
		focusedActorPosition,
		focusedActorSize,
		isWorld,
		enabled,
		radius,
	};

	useEffect(() => {
		if (!resources) return;
		const hero = resources.heroOcclusion;
		const camPos = new THREE.Vector3();
		// The camera moves every frame; the actor rarely does. Cache the derived
		// torso point and recompute it (which touches the LRU-cached terrain index
		// and allocates) only when the actor's tile position or the terrain changes.
		// Numeric comparison keeps the per-frame path allocation-free.
		const torso = new THREE.Vector3();
		// Cut-plane heights derived alongside the torso: feet = the floor the actor
		// stands on (protected when cutting downward from above), head = the actor's
		// crown (protected when cutting upward from below).
		let feetY = 0;
		let headY = 0;
		let lastX = NaN;
		let lastY = NaN;
		let lastH = NaN;
		let lastSize: ActorSize | null = null;
		let lastTerrain: typeof stateRef.current.terrain = null;

		const tick = (): void => {
			const state = stateRef.current;
			const pos = state.focusedActorPosition;
			// Rendering and pointer picking both read this shared uniform holder, so
			// changing the preference updates the visible and clickable cutout together.
			hero.radius.value = state.radius;
			if (!state.enabled || !state.isWorld || !state.terrain || !pos) {
				hero.enabled.value = 0;
				lastTerrain = null;
				return;
			}
			const h = pos.h ?? 0;
			const size = state.focusedActorSize;
			if (
				pos.x !== lastX ||
				pos.y !== lastY ||
				h !== lastH ||
				size !== lastSize ||
				state.terrain !== lastTerrain
			) {
				lastX = pos.x;
				lastY = pos.y;
				lastH = h;
				lastSize = size;
				lastTerrain = state.terrain;
				// getActorGroundPosition only reads `.position`, so a position-only
				// stand-in is safe here (avoids threading a full descriptor in).
				const ground = getActorGroundPosition(
					{ position: pos } as ActorTokenDescriptor,
					state.terrain
				);
				torso.set(
					ground.x,
					ground.y + THREE_D_HERO_OCCLUSION.TORSO_OFFSET_Y,
					ground.z
				);
				feetY = ground.y;
				// Approximate the token's crown from its size (billboard height); the
				// exact standee math is not reproduced here -- a soft cut plane only
				// needs to sit near the top of the figure.
				const tokenHeight =
					ACTOR_TOKEN_WORLD_SIZE.BASE_HEIGHT *
					ACTOR_TOKEN_SIZE_SCALE[size ?? "small"];
				headY = ground.y + tokenHeight;
			}
			hero.actorPos.value.copy(torso);
			resources.camera.getWorldPosition(camPos);
			hero.camPos.value.copy(camPos);
			// Cut only the half-space between the camera and the actor's height: from
			// above, discard geometry above the feet; from below, below the head.
			const eps = THREE_D_HERO_OCCLUSION.CUT_PLANE_EPSILON;
			if (camPos.y >= torso.y) {
				hero.cutSign.value = 1;
				hero.cutY.value = feetY + eps;
			} else {
				hero.cutSign.value = -1;
				hero.cutY.value = headY - eps;
			}
			hero.enabled.value = 1;
		};

		tick();
		resources.animationCallbacks.add(tick);
		return () => {
			resources.animationCallbacks.delete(tick);
			hero.enabled.value = 0;
		};
	}, [resources]);
}
