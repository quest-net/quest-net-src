import type { Character } from "../../../domains/Character/Character";
import type { Entity } from "../../../domains/Entity/Entity";
import type { VoxelTerrain } from "../../../domains/VoxelTerrain/VoxelTerrain";

export interface FirstPersonMapProps {
	terrain?: VoxelTerrain | null;
	characters?: Character[];
	entities?: Entity[];
	onExitFirstPerson?: () => void;
}

export interface FirstPersonActor {
	id: string;
	kind: "character" | "entity";
	actor: Character | Entity;
}

export type MovementOverlayState =
	| { kind: "combat"; value: number; overage?: number }
	| { kind: "exploration"; value: number; overage?: number }
	| null;

export interface FirstPersonFrameInput {
	pointerLocked: boolean;
	keys: ReadonlySet<string>;
}
