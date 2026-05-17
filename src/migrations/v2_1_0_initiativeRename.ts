// src/migrations/v2_1_0_initiativeRename.ts
//
// Renames the combat "turn" concept to "round" wherever it referred to a
// collective side-cycle, and folds the two side-specific done lists into a
// single unified RoundCompleted list. Also defaults InitiativeSettings.Mode
// to "party" on any campaign that already had InitiativeSettings configured,
// preserving the legacy alternating-rounds behavior.
//
// Renames on CombatState:
//   currentTurn          -> currentRound
//   PartyTurnsCompleted  -+
//   EnemyTurnsCompleted  -+-> RoundCompleted (seeded from the side currently
//                                              holding initiative when combat
//                                              is active, otherwise empty)
//
// initiativeSide is preserved as-is. The individual actor concept ("turn") is
// also preserved -- combat:markActorTurnDone keeps its name.

import type { Migration } from "./types";

export const initiativeRenameV210Migration: Migration = {
	version: "2.1.0",
	migrate: (data: unknown) => {
		const campaign = data as any;

		// ---- CombatState rename ------------------------------------------------
		const combatState = campaign.GameState?.CombatState;
		if (combatState && typeof combatState === "object") {
			// currentTurn -> currentRound
			if (typeof combatState.currentRound !== "number") {
				combatState.currentRound =
					typeof combatState.currentTurn === "number"
						? combatState.currentTurn
						: 0;
			}
			delete combatState.currentTurn;

			// PartyTurnsCompleted / EnemyTurnsCompleted -> RoundCompleted
			//
			// In legacy party mode, only the side currently holding initiative
			// has meaningful entries (the other side's list was cleared when
			// initiative last flipped). Use that side's list as the seed; if the
			// campaign isn't in active combat, start empty.
			if (!Array.isArray(combatState.RoundCompleted)) {
				const partyDone = Array.isArray(combatState.PartyTurnsCompleted)
					? combatState.PartyTurnsCompleted
					: [];
				const enemyDone = Array.isArray(combatState.EnemyTurnsCompleted)
					? combatState.EnemyTurnsCompleted
					: [];
				if (combatState.isActive === true) {
					combatState.RoundCompleted =
						combatState.initiativeSide === "enemies"
							? [...enemyDone]
							: [...partyDone];
				} else {
					combatState.RoundCompleted = [];
				}
			}
			delete combatState.PartyTurnsCompleted;
			delete combatState.EnemyTurnsCompleted;
		}

		// ---- InitiativeSettings.Mode default -----------------------------------
		// Only set a default when InitiativeSettings is already present; absent
		// settings stay absent so the "not configured" empty state is preserved.
		const initSettings = campaign.Settings?.InitiativeSettings;
		if (
			initSettings &&
			typeof initSettings === "object" &&
			typeof initSettings.Mode !== "string"
		) {
			initSettings.Mode = "party";
		}

		return campaign;
	},
};
