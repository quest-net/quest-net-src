// domains/GameState/GameState.ts
import { Character } from "../Character/Character";
import { Entity } from "../Entity/Entity";
import { Scene } from "../Scene/Scene";

export interface GameState {
	Characters: Character[];
	Entities: Entity[];
	CombatState: CombatState;
	Audio: string[];
	Volume: number;
	Scene: Scene;
	TerrainId: string;
	CalendarDay: number;
	RemainingShortRests: number;
}

export interface CombatState {
	isActive: boolean;
	currentTurn: number;
	initiativeSide: "party" | "enemies";
}
