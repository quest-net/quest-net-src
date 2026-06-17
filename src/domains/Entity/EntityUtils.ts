// domains/Entity/EntityUtils.ts

import { Context } from "../Context/Context";
import { Entity } from "./Entity";
import { CampaignUtils } from "../Campaign/CampaignUtils";
import { createDefaultStatSlots, createDefaultActionSlots, createDefaultAttributeSlots } from "../Actor/ActorUtils";
import { ACTOR_DEFAULT_COLORS } from "../Actor/Actor";

export const EntityUtils = {
	/**
	 * Creates a default entity with campaign stat definitions
	 */
	createDefault(context: Context): Entity {
		const campaign = CampaignUtils.getActiveCampaign(context);
		const settings = campaign.Settings;

		return {
			Id: crypto.randomUUID(),
			Name: "New Entity",
			Description: "",
			Image: undefined,
			Color: ACTOR_DEFAULT_COLORS.ENTITY,
			Stats: createDefaultStatSlots(settings.StatDefinitions),
			Actions: createDefaultActionSlots(settings.ActionDefinitions),
			Attributes: createDefaultAttributeSlots(settings.AttributeDefinitions ?? []),
			// Template default; terrainId is assigned when the entity is spawned.
			Position: { terrainId: "", x: 0, y: 0, h: 0 },
			MoveSpeed: 5,
			CanFly: false,
			Size: "small",
			Inventory: [],
			Equipment: [],
			Skills: [],
			Statuses: [],
			Tags: [],
		};
	},

	/**
	 * Helper function to extract base name from entity name
	 * "Goblin" -> "Goblin"
	 * "Goblin [A]" -> "Goblin"
	 * "Goblin [Z]" -> "Goblin"
	 */
	getBaseName(name: string): string {
		const match = name.match(/^(.+?)\s*\[[A-Z]\]$/);
		return match ? match[1] : name;
	},

	/**
	 * Helper function to get letter suffix from alphabet position
	 * 0 -> 'A', 1 -> 'B', ..., 25 -> 'Z'
	 */
	getLetterSuffix(index: number): string {
		return String.fromCharCode(65 + index); // 65 is 'A' in ASCII
	},
};
