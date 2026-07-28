import type { Character } from "../../../domains/Character/Character";
import type { Entity } from "../../../domains/Entity/Entity";

/** The actor the locomotion runtime drives: a player's selected character, or
 *  the DM's impersonated actor. Named for the runtime rather than for a camera,
 *  since First Person and Follow both steer the same one. */
export interface LocomotionActor {
	id: string;
	kind: "character" | "entity";
	actor: Character | Entity;
}

export type MovementOverlayState =
	| { kind: "combat"; value: number; overage?: number; overageUnbounded?: boolean }
	| { kind: "exploration"; value: number; overage?: number; overageUnbounded?: boolean }
	| null;

export interface ActorLocomotionFrameInput {
	pointerLocked: boolean;
	keys: ReadonlySet<string>;
	/** Camera-relative movement yaw, supplied by MapModeController: the eye
	 *  camera's heading in First Person, the boom's in Follow. The runtime owns
	 *  no camera of its own, which is what lets one instance serve both. */
	yaw: number;
}
