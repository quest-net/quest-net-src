import { VersionedMigration } from "./types";

/**
 * Migration 1.2.0: Status Effect Expiration Types
 *
 * Converts the old Duration/turnsLeft system to the new discriminated union expiration system.
 *
 * Status templates:
 *   Old: { Duration?: number }          (undefined = permanent, number = turns)
 *   New: { Expiration: StatusExpiration } (discriminated union with 5 types)
 *
 * Status slots on actors:
 *   Old: { Id, turnsLeft?: number }                (undefined = permanent, number = turns left)
 *   New: { Id, expiration: StatusSlotExpiration }   (discriminated union with 5 types)
 */
export const migration_1_2_0: VersionedMigration = {
	version: "1.2.0",

	update: (context: any): any => {
		const updatedCampaigns = context.Campaigns.map((campaign: any) => {
			// --- Migrate Status Templates ---
			const updatedStatusTemplates = (campaign.StatusTemplates || []).map(
				(status: any) => {
					// Skip if already migrated
					if (status.Expiration) return status;

					const { Duration, ...rest } = status;
					return {
						...rest,
						Expiration:
							Duration === undefined || Duration === null
								? { type: "permanent" }
								: { type: "turns", count: Duration },
					};
				}
			);

			// --- Helper to migrate actor status slots ---
			const migrateActor = (actor: any) => {
				if (!actor.Statuses) return actor;

				const updatedStatuses = actor.Statuses.map((slot: any) => {
					// Skip if already migrated
					if (slot.expiration) return slot;

					const { turnsLeft, ...rest } = slot;
					return {
						...rest,
						expiration:
							turnsLeft === undefined || turnsLeft === null
								? { type: "permanent" }
								: { type: "turns", turnsLeft },
					};
				});

				return { ...actor, Statuses: updatedStatuses };
			};

			return {
				...campaign,
				StatusTemplates: updatedStatusTemplates,
				CharacterRoster: campaign.CharacterRoster.map(migrateActor),
				EntityTemplates: campaign.EntityTemplates.map(migrateActor),
				GameState: {
					...campaign.GameState,
					Characters: campaign.GameState.Characters.map(migrateActor),
					Entities: campaign.GameState.Entities.map(migrateActor),
				},
			};
		});

		return {
			...context,
			Campaigns: updatedCampaigns,
			version: "1.2.0",
		};
	},

	reset: (context: any): any => {
		const downgradedCampaigns = context.Campaigns.map((campaign: any) => {
			// --- Downgrade Status Templates ---
			const downgradedStatusTemplates = (campaign.StatusTemplates || []).map(
				(status: any) => {
					if (!status.Expiration) return status;

					const { Expiration, ...rest } = status;
					let Duration: number | undefined;

					switch (Expiration.type) {
						case "permanent":
						case "shortRest":
						case "longRest":
							// These types didn't exist before — downgrade to permanent
							Duration = undefined;
							break;
						case "turns":
							Duration = Expiration.count;
							break;
						case "days":
							// Days didn't exist — best effort: convert to permanent
							Duration = undefined;
							break;
					}

					return { ...rest, Duration };
				}
			);

			// --- Helper to downgrade actor status slots ---
			const downgradeActor = (actor: any) => {
				if (!actor.Statuses) return actor;

				const downgradedStatuses = actor.Statuses.map((slot: any) => {
					if (!slot.expiration) return slot;

					const { expiration, ...rest } = slot;
					let turnsLeft: number | undefined;

					switch (expiration.type) {
						case "permanent":
						case "shortRest":
						case "longRest":
							turnsLeft = undefined;
							break;
						case "turns":
							turnsLeft = expiration.turnsLeft;
							break;
						case "days":
							turnsLeft = undefined;
							break;
					}

					return { ...rest, turnsLeft };
				});

				return { ...actor, Statuses: downgradedStatuses };
			};

			return {
				...campaign,
				StatusTemplates: downgradedStatusTemplates,
				CharacterRoster: campaign.CharacterRoster.map(downgradeActor),
				EntityTemplates: campaign.EntityTemplates.map(downgradeActor),
				GameState: {
					...campaign.GameState,
					Characters: campaign.GameState.Characters.map(downgradeActor),
					Entities: campaign.GameState.Entities.map(downgradeActor),
				},
			} as any;
		});

		return {
			...context,
			Campaigns: downgradedCampaigns,
			version: "1.1.2",
		};
	},
};
