import { Context } from "../Context/Context";
import { Campaign } from "./Campaign";
import { getUrlIdentifier, isGUID } from "../../utils/UrlParser";
import { ContextActions } from "../Context/ContextActions";
import { CampaignSettingActions } from "../CampaignSetting/CampaignSettingActions";
import { TerrainActions } from "../Terrain/TerrainActions";
import { IndexedDBUtilities } from "../../utils/IndexedDBUtilities";

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

/**
 * Converts a Blob to base64 string
 */
async function blobToBase64(blob: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onloadend = () => {
			const result = reader.result as string;
			// Remove the data URL prefix (e.g., "data:image/png;base64,")
			const base64 = result.split(',')[1];
			resolve(base64);
		};
		reader.onerror = reject;
		reader.readAsDataURL(blob);
	});
}

/**
 * Converts base64 string to Blob
 */
function base64ToBlob(base64: string, mimeType: string): Blob {
	const byteCharacters = atob(base64);
	const byteNumbers = new Array(byteCharacters.length);
	for (let i = 0; i < byteCharacters.length; i++) {
		byteNumbers[i] = byteCharacters.charCodeAt(i);
	}
	const byteArray = new Uint8Array(byteNumbers);
	return new Blob([byteArray], { type: mimeType });
}

export interface CampaignExportData {
	version: string;
	campaign: Campaign;
	imageData: Record<string, { base64: string; mimeType: string }>;
}

export interface ExportProgress {
	current: number;
	total: number;
	status: string;
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
	 * Downloads a campaign as a JSON file with all image data included
	 */
	async download(
		params: { campaignId: string },
		context: Context,
		onProgress?: (progress: ExportProgress) => void
	): Promise<void> {
		const campaign = context.Campaigns.find((c) => c.Id === params.campaignId);

		if (!campaign) {
			console.warn(`Campaign not found: ${params.campaignId}`);
			return;
		}

		try {
			onProgress?.({
				current: 0,
				total: campaign.Images.length,
				status: "Starting export...",
			});

			// Collect all image data from IndexedDB
			const imageData: Record<string, { base64: string; mimeType: string }> = {};
			
			for (let i = 0; i < campaign.Images.length; i++) {
				const image = campaign.Images[i];
				
				onProgress?.({
					current: i,
					total: campaign.Images.length,
					status: `Exporting image ${i + 1}/${campaign.Images.length}: ${image.Name}`,
				});

				const cached = await IndexedDBUtilities.load(image.Id);
				if (cached) {
					const blob = cached.data as Blob;
					const base64 = await blobToBase64(blob);
					imageData[image.Id] = {
						base64,
						mimeType: image.MimeType,
					};
				}
			}

			onProgress?.({
				current: campaign.Images.length,
				total: campaign.Images.length,
				status: "Finalizing export...",
			});

			// Create export data structure
			const exportData: CampaignExportData = {
				version: "2.0",
				campaign,
				imageData,
			};

			// Download as JSON file
			const json = JSON.stringify(exportData, null, 2);
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

			onProgress?.({
				current: campaign.Images.length,
				total: campaign.Images.length,
				status: "Export complete!",
			});
		} catch (error) {
			throw new Error(
				`Failed to export campaign: ${
					error instanceof Error ? error.message : "Unknown error"
				}`
			);
		}
	},

	/**
	 * Imports a campaign from a JSON file with image data
	 */
	async importFromFile(
		params: { file: File },
		context: Context,
		onProgress?: (progress: ExportProgress) => void
	): Promise<Campaign> {
		try {
			onProgress?.({
				current: 0,
				total: 1,
				status: "Reading file...",
			});

			const text = await params.file.text();
			const data = JSON.parse(text);

			// Check if this is a v2.0 export with images or older format
			let campaign: Campaign;
			let imageData: Record<string, { base64: string; mimeType: string }> = {};

			if (data.version === "2.0" && data.campaign && data.imageData) {
				campaign = data.campaign as Campaign;
				imageData = data.imageData;
			} else {
				// Assume old format - just the campaign object
				campaign = data as Campaign;
			}

			// Generate new ID to avoid conflicts
			campaign.Id = crypto.randomUUID();

			// Ensure room code is unique
			const existingRoomCodes = context.Campaigns.map((c) => c.RoomCode);
			if (existingRoomCodes.includes(campaign.RoomCode)) {
				campaign.RoomCode = generateRoomCode();
			}

			// Import images to IndexedDB
			const imageIds = Object.keys(imageData);
			const totalSteps = imageIds.length + 1; // +1 for final save

			for (let i = 0; i < imageIds.length; i++) {
				const imageId = imageIds[i];
				const { base64, mimeType } = imageData[imageId];

				onProgress?.({
					current: i,
					total: totalSteps,
					status: `Importing image ${i + 1}/${imageIds.length}...`,
				});

				const blob = base64ToBlob(base64, mimeType);
				await IndexedDBUtilities.save(imageId, blob);
			}

			onProgress?.({
				current: imageIds.length,
				total: totalSteps,
				status: "Saving campaign...",
			});

			context.Campaigns.push(campaign);
			ContextActions.save(context);

			onProgress?.({
				current: totalSteps,
				total: totalSteps,
				status: "Import complete!",
			});

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