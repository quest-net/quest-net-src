import { Character } from "../Character/Character";
import { Entity } from "../Entity/Entity";
import { Scene } from "../Scene/Scene";

export interface GameState {
	Characters: Character[];
	Entities: Entity[];
	CombatState: CombatState;
	Audio: string;
	Volume: number;
	Scene: Scene;
}

export interface CombatState {
  isActive: boolean;
  currentTurn: number;
  initiativeSide: 'party' | 'enemies';
}