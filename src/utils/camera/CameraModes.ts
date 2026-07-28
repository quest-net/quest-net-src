// utils/camera/CameraModes.ts
//
// The single vocabulary for map camera modes: the mode union, the narrower
// unions each subsystem owns, the ordered lists the UI renders, and the one
// function that decides whether a mode can be selected right now.
//
// Availability lives here rather than in the UI because three call sites need
// the same answer -- the map dropdown, the player's mobile menu, and Main's
// fallback effect -- and they drifted apart when each spelled it out itself.

/** Camera modes exposed by the map UI. */
export type MapCameraMode =
	| "first-person"
	| "follow"
	| "ortho"
	| "perspective"
	| "freecam";

/** Modes owned by CameraRig. First person uses MapModeController's eye camera. */
export type RigCameraMode = Exclude<MapCameraMode, "first-person">;

/** Modes driven by the shared controlled-actor locomotion runtime. Both place
 *  the same capsule; they differ only in which camera presents it. */
export type ActorCameraMode = Extract<MapCameraMode, "first-person" | "follow">;

/** The rig modes available to a consumer that has no actors to anchor to --
 *  i.e. the voxel terrain editor. Excluding "follow" at the type level is what
 *  lets CameraRigConfig.follow be required for everyone else. */
export type ActorlessRigCameraMode = Exclude<RigCameraMode, "follow">;

/** How pointer input is interpreted, which is NOT the same question as which
 *  camera is active: Follow renders the world but takes over the pointer while
 *  right click is held. Map layers gate their input on this, not on the mode. */
export type MapInteractionMode = "world-pointer" | "actor-look";

/** Display order for every mode-selection surface. */
const MAP_CAMERA_MODE_ORDER = [
	"first-person",
	"follow",
	"ortho",
	"perspective",
	"freecam",
] as const satisfies readonly MapCameraMode[];

export const DM_CAMERA_MODES: readonly MapCameraMode[] = MAP_CAMERA_MODE_ORDER;

/** Free camera is DM-only, so players never see the entry at all. */
export const PLAYER_CAMERA_MODES: readonly MapCameraMode[] =
	MAP_CAMERA_MODE_ORDER.filter((mode) => mode !== "freecam");

export const ACTORLESS_RIG_CAMERA_MODES: readonly ActorlessRigCameraMode[] = [
	"ortho",
	"perspective",
	"freecam",
];

/** Selected whenever the active mode stops being available. */
export const FALLBACK_CAMERA_MODE: MapCameraMode = "ortho";

export function isMapCameraMode(value: unknown): value is MapCameraMode {
	return (MAP_CAMERA_MODE_ORDER as readonly string[]).includes(value as string);
}

export function isActorCameraMode(
	mode: MapCameraMode
): mode is ActorCameraMode {
	return mode === "first-person" || mode === "follow";
}

export interface CameraModeAvailability {
	isDM: boolean;
	/** A player's selected character, or the DM's impersonated actor. */
	hasControlledActor: boolean;
	/** First person needs pointer lock and WASD; there is no touch locomotion
	 *  path yet, so it stays visible-but-disabled on touch-sized layouts. */
	isTouchLayout: boolean;
}

/** Why `mode` cannot be selected right now, or undefined when it can. The
 *  message is shown directly to the user as the disabled entry's tooltip. */
export function getCameraModeDisabledReason(
	mode: MapCameraMode,
	availability: CameraModeAvailability
): string | undefined {
	if (mode === "freecam" && !availability.isDM) {
		return "Free camera is DM-only";
	}
	if (mode === "first-person" && availability.isTouchLayout) {
		return "First person requires desktop pointer-lock controls";
	}
	if (isActorCameraMode(mode) && !availability.hasControlledActor) {
		return availability.isDM
			? "Impersonate an actor first"
			: "Select a character first";
	}
	return undefined;
}

export function isCameraModeAvailable(
	mode: MapCameraMode,
	availability: CameraModeAvailability
): boolean {
	return getCameraModeDisabledReason(mode, availability) === undefined;
}
