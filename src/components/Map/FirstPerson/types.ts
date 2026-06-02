import type { Character } from "../../../domains/Character/Character";
import type { Entity } from "../../../domains/Entity/Entity";

export interface FirstPersonActor {
	id: string;
	kind: "character" | "entity";
	actor: Character | Entity;
}

export type MovementOverlayState =
	| { kind: "combat"; value: number; overage?: number; overageUnbounded?: boolean }
	| { kind: "exploration"; value: number; overage?: number; overageUnbounded?: boolean }
	| null;

export interface FirstPersonFrameInput {
	pointerLocked: boolean;
	keys: ReadonlySet<string>;
}
