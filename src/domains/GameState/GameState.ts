// domains/GameState/GameState.ts
import { Character } from "../Character/Character";
import { Entity } from "../Entity/Entity";
import { Scene } from "../Scene/Scene";
import { CombatState } from "../Combat/Combat";

export interface GameState {
	Characters: Character[];
	Entities: Entity[];
	CombatState: CombatState;
	Audio: string[];
	Volume: number;
	Scene: Scene;
	CalendarDay: number;
	RemainingShortRests: number;
}
