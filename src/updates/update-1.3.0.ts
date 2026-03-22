import { Context } from "../domains/Context/Context";
import { VersionedMigration } from "./types";

/**
 * Migration 1.3.0: Stat/Action/Attribute Slot Pattern
 *
 * Converts actors from embedding full StatDefinition/ActionDefinition objects
 * to lightweight slots that reference campaign-level templates by Id.
 *
 * Stats:
 *   Old: StatDefinition[] on actor (Id, Name, Color, Current?, Max, RegenRate?, RestoreRule?, OverflowTarget?)
 *   New: StatSlot[] on actor (Id, Current, Max, RegenRate?, RestoreRule?, OverflowTarget?)
 *        Name/Color always come from CampaignSettings.StatDefinitions
 *
 * Actions:
 *   Old: ActionDefinition[] on actor (Id, Name, Color, Default, Current?)
 *   New: ActionSlot[] on actor (Id, Max, Current)
 *        Name/Color always come from CampaignSettings.ActionDefinitions
 *        "Default" renamed to "Max" on ActionDefinition template
 *
 * Attributes:
 *   Old: Record<string, string> on actor
 *   New: AttributeSlot[] on actor (Id, Value)
 *        CampaignSettings gains AttributeDefinitions[] (Id, Name)
 *
 * SharedInventory.Stats:
 *   Same conversion as actor stats → StatSlot[]
 */
export const migration_1_3_0: VersionedMigration = {
	version: "1.3.0",

	update: (context: Context): Context => {
		const updatedCampaigns = context.Campaigns.map((campaign: any) => {
			const settings = campaign.Settings ?? {};

			// --- Migrate ActionDefinitions: Default → Max ---
			const actionDefs = (settings.ActionDefinitions ?? []).map((def: any) => {
				if ("Max" in def) return def; // Already migrated
				const { Default, Current, ...rest } = def;
				return { ...rest, Max: Default ?? 1 };
			});

			// --- Remove Current from StatDefinitions (it was optional, template-only now) ---
			const statDefs = (settings.StatDefinitions ?? []).map((def: any) => {
				const { Current, ...rest } = def;
				return rest;
			});

			// --- Build AttributeDefinitions from existing attribute keys across all actors ---
			const allAttributeKeys = new Set<string>();
			const allActors = [
				...(campaign.CharacterRoster ?? []),
				...(campaign.EntityTemplates ?? []),
				...((campaign.GameState?.Characters) ?? []),
				...((campaign.GameState?.Entities) ?? []),
			];

			for (const actor of allActors) {
				const attrs = actor.Attributes;
				if (attrs && typeof attrs === "object" && !Array.isArray(attrs)) {
					for (const key of Object.keys(attrs)) {
						allAttributeKeys.add(key);
					}
				}
			}

			const attributeDefs = Array.from(allAttributeKeys).map((key) => ({
				Id: key,
				Name: key,
			}));

			// --- Migrate actor stats/actions/attributes ---
			const migrateActor = (actor: any) => {
				// Stats: strip Name/Color, ensure Current exists
				const stats = (actor.Stats ?? []).map((stat: any) => {
					// Already a StatSlot (no Name field) — skip
					if (!("Name" in stat)) return stat;
					const { Name, Color, ...slotFields } = stat;
					return {
						Id: slotFields.Id,
						Current: slotFields.Current ?? slotFields.Max,
						Max: slotFields.Max,
						// Preserve overrides if they differ from template
						...(slotFields.RegenRate !== undefined ? { RegenRate: slotFields.RegenRate } : {}),
						...(slotFields.RestoreRule !== undefined ? { RestoreRule: slotFields.RestoreRule } : {}),
						...(slotFields.OverflowTarget !== undefined ? { OverflowTarget: slotFields.OverflowTarget } : {}),
					};
				});

				// Actions: Default → Max, strip Name/Color
				const actions = (actor.Actions ?? []).map((action: any) => {
					// Already an ActionSlot (no Name field) — skip
					if (!("Name" in action)) return action;
					const max = action.Max ?? action.Default ?? 1;
					return {
						Id: action.Id,
						Max: max,
						Current: action.Current ?? max,
					};
				});

				// Attributes: Record<string, string> → AttributeSlot[]
				let attributes = actor.Attributes;
				if (attributes && typeof attributes === "object" && !Array.isArray(attributes)) {
					attributes = Object.entries(attributes).map(([key, value]) => ({
						Id: key,
						Value: String(value ?? ""),
					}));
				}
				// If already an array, leave as-is
				if (!Array.isArray(attributes)) {
					attributes = [];
				}

				return { ...actor, Stats: stats, Actions: actions, Attributes: attributes };
			};

			// --- Migrate SharedInventory stats ---
			const sharedInventories = (settings.SharedInventories ?? []).map((inv: any) => {
				const stats = (inv.Stats ?? []).map((stat: any) => {
					if (!("Name" in stat)) return stat;
					const { Name, Color, ...slotFields } = stat;
					return {
						Id: slotFields.Id,
						Current: slotFields.Current ?? slotFields.Max,
						Max: slotFields.Max,
						...(slotFields.RegenRate !== undefined ? { RegenRate: slotFields.RegenRate } : {}),
						...(slotFields.RestoreRule !== undefined ? { RestoreRule: slotFields.RestoreRule } : {}),
						...(slotFields.OverflowTarget !== undefined ? { OverflowTarget: slotFields.OverflowTarget } : {}),
					};
				});
				return { ...inv, Stats: stats };
			});

			return {
				...campaign,
				CharacterRoster: campaign.CharacterRoster.map(migrateActor),
				EntityTemplates: campaign.EntityTemplates.map(migrateActor),
				GameState: {
					...campaign.GameState,
					Characters: campaign.GameState.Characters.map(migrateActor),
					Entities: campaign.GameState.Entities.map(migrateActor),
				},
				Settings: {
					...settings,
					StatDefinitions: statDefs,
					ActionDefinitions: actionDefs,
					AttributeDefinitions: settings.AttributeDefinitions ?? attributeDefs,
					SharedInventories: sharedInventories,
				},
			};
		});

		return {
			...context,
			Campaigns: updatedCampaigns,
			version: "1.3.0",
		};
	},

	reset: (context: Context): Context => {
		const downgradedCampaigns = context.Campaigns.map((campaign: any) => {
			const settings = campaign.Settings ?? {};

			// --- ActionDefinitions: Max → Default ---
			const actionDefs = (settings.ActionDefinitions ?? []).map((def: any) => {
				const { Max, ...rest } = def;
				return { ...rest, Default: Max ?? 1 };
			});

			// --- Remove AttributeDefinitions ---
			const { AttributeDefinitions, ...restSettings } = settings;

			// --- Downgrade actor data ---
			const downgradeActor = (actor: any) => {
				// Stats: re-embed Name/Color from campaign settings
				const statDefMap = new Map<string, any>(
					(settings.StatDefinitions ?? []).map((d: any) => [d.Id, d])
				);
				const stats = (actor.Stats ?? []).map((slot: any) => {
					const def = statDefMap.get(slot.Id);
					return {
						Id: slot.Id,
						Name: def?.Name ?? slot.Id,
						Color: def?.Color ?? "#888",
						Max: slot.Max,
						Current: slot.Current,
						...(slot.RegenRate !== undefined ? { RegenRate: slot.RegenRate } : {}),
						...(slot.RestoreRule !== undefined ? { RestoreRule: slot.RestoreRule } : {}),
						...(slot.OverflowTarget !== undefined ? { OverflowTarget: slot.OverflowTarget } : {}),
					};
				});

				// Actions: re-embed Name/Color, Max → Default
				const actionDefMap = new Map<string, any>(
					(settings.ActionDefinitions ?? []).map((d: any) => [d.Id, d])
				);
				const actions = (actor.Actions ?? []).map((slot: any) => {
					const def = actionDefMap.get(slot.Id);
					return {
						Id: slot.Id,
						Name: def?.Name ?? slot.Id,
						Color: def?.Color ?? "#888",
						Default: slot.Max,
						Current: slot.Current,
					};
				});

				// Attributes: AttributeSlot[] → Record<string, string>
				let attributes: Record<string, string> = {};
				if (Array.isArray(actor.Attributes)) {
					for (const attr of actor.Attributes) {
						attributes[attr.Id] = attr.Value ?? "";
					}
				} else {
					attributes = actor.Attributes ?? {};
				}

				return { ...actor, Stats: stats, Actions: actions, Attributes: attributes };
			};

			// --- Downgrade SharedInventory stats ---
			const sharedInventories = (settings.SharedInventories ?? []).map((inv: any) => {
				const statDefMap = new Map<string, any>(
					(settings.StatDefinitions ?? []).map((d: any) => [d.Id, d])
				);
				const stats = (inv.Stats ?? []).map((slot: any) => {
					const def = statDefMap.get(slot.Id);
					return {
						Id: slot.Id,
						Name: def?.Name ?? slot.Id,
						Color: def?.Color ?? "#888",
						Max: slot.Max,
						Current: slot.Current,
					};
				});
				return { ...inv, Stats: stats };
			});

			return {
				...campaign,
				CharacterRoster: campaign.CharacterRoster.map(downgradeActor),
				EntityTemplates: campaign.EntityTemplates.map(downgradeActor),
				GameState: {
					...campaign.GameState,
					Characters: campaign.GameState.Characters.map(downgradeActor),
					Entities: campaign.GameState.Entities.map(downgradeActor),
				},
				Settings: {
					...restSettings,
					ActionDefinitions: actionDefs,
					SharedInventories: sharedInventories,
				},
			} as any;
		});

		return {
			...context,
			Campaigns: downgradedCampaigns,
			version: "1.2.1",
		};
	},
};
