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
	/**
	 * Actor IDs of party members who have been marked "turn over" for the
	 * current party-side turn. Cleared whenever the side flips back to "party"
	 * or combat starts/ends. Order numbers themselves are computed live at
	 * render time from CampaignSettings.InitiativeSettings.
	 */
	PartyTurnsCompleted?: string[];
	/**
	 * Same as PartyTurnsCompleted, but for enemies. Wired through the action
	 * layer for symmetry; no UI consumes it yet.
	 */
	EnemyTurnsCompleted?: string[];
}
