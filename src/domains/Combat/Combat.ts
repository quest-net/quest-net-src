// domains/Combat/Combat.ts

/**
 * Live state for a turn-based battle. The CombatState instance lives on
 * GameState.CombatState; this type is owned by the Combat domain since the
 * combat actions/utilities operate on it.
 */
export interface CombatState {
	isActive: boolean;
	/**
	 * 1-based round counter. In party mode each "round" is one side acting
	 * (party round, enemy round, party round, ...); in individual mode each
	 * round is everyone acting once. Bumped by combat:incrementRound.
	 */
	currentRound: number;
	/**
	 * Which side currently holds initiative. Only meaningful in party mode —
	 * individual mode ignores this field (everyone shares the round) but the
	 * field is still written so a campaign can switch modes mid-combat.
	 */
	initiativeSide: "party" | "enemies";
	/**
	 * Actor IDs marked "turn over" within the current round. In party mode this
	 * only collects IDs from the side that currently has initiative and clears
	 * when initiative flips. In individual mode it collects every actor across
	 * party + entities and clears when the round advances. Order numbers
	 * themselves are computed live at render time from
	 * CampaignSettings.InitiativeSettings.
	 */
	RoundCompleted?: string[];
}
