// domains/Character/CharacterUtils.ts

import { Context } from "../Context/Context";
import { Character } from "./Character";
import { CampaignUtils } from "../Campaign/CampaignUtils";
import { ACTOR_DEFAULT_COLORS } from "../Actor/Actor";
import { createDefaultStatSlots, createDefaultActionSlots, createDefaultAttributeSlots } from "../Actor/ActorUtils";

export const CharacterUtils = {
	/**
	 * Creates a default character with campaign stat definitions
	 */
	createDefault(context: Context): Character {
		const campaign = CampaignUtils.getActiveCampaign(context);
		const settings = campaign.Settings;

		return {
			Id: crypto.randomUUID(),
			Name: "New Character",
			Description: "",
			Image: undefined,
			Color: ACTOR_DEFAULT_COLORS.CHARACTER,
			Stats: createDefaultStatSlots(settings.StatDefinitions),
			Actions: createDefaultActionSlots(settings.ActionDefinitions),
			Attributes: createDefaultAttributeSlots(settings.AttributeDefinitions ?? []),
			// Roster default; terrainId is assigned when the character is spawned.
			Position: { terrainId: "", x: 0, y: 0, h: 0 },
			MoveSpeed: 5,
			CanFly: false,
			Size: "small",
			Inventory: [],
			Equipment: [],
			Skills: [],
			Statuses: [],
			Tags: [],
			Notes: [],
			CritMessage: undefined,
		};
	},
};
