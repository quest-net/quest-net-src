import { Context } from "../Context/Context";
import { Campaign } from "./Campaign";
import { getUrlIdentifier, isGUID } from "../../utils/UrlParser";
import { ContextActions } from "../Context/ContextActions";
import { CampaignSettingActions } from "../CampaignSetting/CampaignSettingActions";
import { TerrainActions } from "../Terrain/TerrainActions";

/**
 * Generates a random room code (lowercase, alphanumeric, max 32 chars)
 */
function generateRoomCode(): string {
	const adjectives = [
		"swift",
		"brave",
		"dark",
		"golden",
		"silent",
		"ancient",
		"mystic",
		"iron",
	];
	const nouns = [
		"dragon",
		"sword",
		"shield",
		"tower",
		"forest",
		"mountain",
		"ocean",
		"phoenix",
	];

	const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
	const noun = nouns[Math.floor(Math.random() * nouns.length)];
	const num = Math.floor(Math.random() * 100);

	return `${adj}-${noun}-${num}`;
}

/**
 * Creates a blank campaign structure
 */
function createBlankCampaign(name: string, roomCode?: string): Campaign {
	return {
		Id: crypto.randomUUID(),
		Name: name,
		RoomCode: roomCode || generateRoomCode(),
		CharacterRoster: [],
		ItemTemplates: [],
		SkillTemplates: [],
		StatusTemplates: [],
		EntityTemplates: [],
		Terrains: [TerrainActions.createDefault(), TerrainActions.createHills()],
		Audios: [],
		Images: [],
		GameState: {
			Characters: [],
			Entities: [],
			CombatState: {
				isActive: false,
				currentTurn: 0,
				initiativeSide: "party",
			},
			Audio: [],
			Volume: 0.5,
			Scene: {
				EnvironmentImageId: "",
				FocusImageId: "",
			},
			TerrainId: "DEFAULT_TERRAIN",
			CalendarDay: 0,
			RemainingShortRests: 2,
		},
		Log: [],
		Settings: CampaignSettingActions.createDefault(),
	};
}

export const CampaignActions = {
	findCampaignByIdentifier(
		identifier: string | undefined,
		context: Context
	): Campaign | undefined {
		if (!identifier) {
			return undefined;
		}
		if (isGUID(identifier)) {
			// DM mode: search by Campaign.Id (the secret GUID)
			return context.Campaigns.find((c) => c.Id === identifier);
		} else {
			// Player mode: search by Campaign.RoomCode (the public identifier)
			return context.Campaigns.find((c) => c.RoomCode === identifier);
		}
	},

	getActiveCampaign(context: Context): Campaign {
		const identifier = getUrlIdentifier();

		if (!identifier) {
			throw new Error("No campaign identifier in URL");
		}

		let campaign: Campaign | undefined;

		if (isGUID(identifier)) {
			campaign = context.Campaigns.find((c) => c.Id === identifier);
		} else {
			campaign = context.Campaigns.find((c) => c.RoomCode === identifier);
		}

		if (!campaign) {
			throw new Error(`Campaign not found for identifier: ${identifier}`);
		}

		return campaign;
	},

	/**
	 * Creates a new campaign and adds it to context
	 */
	create(
		params: { name: string; roomCode?: string },
		context: Context
	): Campaign {
		const campaign = createBlankCampaign(params.name, params.roomCode);

		context.Campaigns.push(campaign);
		ContextActions.save(context);

		return campaign;
	},

	/**
	 * Deletes a campaign by ID
	 */
	delete(params: { campaignId: string }, context: Context): void {
		const index = context.Campaigns.findIndex(
			(c) => c.Id === params.campaignId
		);

		if (index === -1) {
			console.warn(`Campaign not found: ${params.campaignId}`);
			return;
		}

		context.Campaigns.splice(index, 1);
		ContextActions.save(context);
	},

	/**
	 * Edits campaign properties (name, room code, settings)
	 */
	edit(
		params: { campaignId: string; updates: Partial<Campaign> },
		context: Context
	): void {
		const campaign = context.Campaigns.find((c) => c.Id === params.campaignId);

		if (!campaign) {
			console.warn(`Campaign not found: ${params.campaignId}`);
			return;
		}

		Object.assign(campaign, params.updates);
		ContextActions.save(context);
	},

	/**
	 * Downloads a campaign as a JSON file
	 */
	download(params: { campaignId: string }, context: Context): void {
		const campaign = context.Campaigns.find((c) => c.Id === params.campaignId);

		if (!campaign) {
			console.warn(`Campaign not found: ${params.campaignId}`);
			return;
		}

		const json = JSON.stringify(campaign, null, 2);
		const blob = new Blob([json], { type: "application/json" });
		const url = URL.createObjectURL(blob);

		const link = document.createElement("a");
		link.href = url;
		link.download = `${campaign.Name.replace(
			/[^a-z0-9]/gi,
			"_"
		)}_${Date.now()}.json`;
		document.body.appendChild(link);
		link.click();
		document.body.removeChild(link);
		URL.revokeObjectURL(url);
	},

	/**
	 * Imports a campaign from a JSON file
	 */
	async importFromFile(
		params: { file: File },
		context: Context
	): Promise<Campaign> {
		try {
			const text = await params.file.text();
			const campaign = JSON.parse(text) as Campaign;

			// Generate new ID to avoid conflicts
			campaign.Id = crypto.randomUUID();

			// Ensure room code is unique
			const existingRoomCodes = context.Campaigns.map((c) => c.RoomCode);
			if (existingRoomCodes.includes(campaign.RoomCode)) {
				campaign.RoomCode = generateRoomCode();
			}

			context.Campaigns.push(campaign);
			ContextActions.save(context);

			return campaign;
		} catch (error) {
			throw new Error(
				`Failed to import campaign: ${
					error instanceof Error ? error.message : "Invalid JSON"
				}`
			);
		}
	},
};
