import { Context } from "../Context/Context";
import { Campaign, CampaignInfo } from "./Campaign";
import { getUrlIdentifier, isGUID } from "../../utils/UrlParser";
import { ContextActions } from "../Context/ContextActions";
import { CampaignSettingActions } from "../CampaignSetting/CampaignSettingActions";
import { TerrainActions } from "../Terrain/TerrainActions";
import { IndexedDBUtilities } from "../../utils/IndexedDBUtilities";
import { APP_VERSION, type VersionString } from "../../version";
import { runMigrations } from "../../updates/migrator";


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
		CreatedAt: Date.now(),
		CharacterRoster: [],
		ItemTemplates: [],
		SkillTemplates: [],
		StatusTemplates: [],
		EntityTemplates: [],
		Terrains: [TerrainActions.createDefault(), TerrainActions.createHills()],
		Audios: [],
		Images: [],
		Scenarios: [],
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
		LogHead: 0,
		Settings: CampaignSettingActions.createDefault(),
	};
}

/** Extracts a CampaignInfo stub from a Campaign */
function toStub(campaign: Campaign): CampaignInfo {
	return {
		Id: campaign.Id,
		Name: campaign.Name,
		RoomCode: campaign.RoomCode,
		CreatedAt: campaign.CreatedAt,
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
	version: VersionString;
	campaign: Campaign;
	imageData: Record<string, { base64: string; mimeType: string }>;
}

export interface ExportProgress {
	current: number;
	total: number;
	status: string;
}

export const CampaignActions = {
	/**
	 * Finds the campaign for the given URL identifier by checking context.ActiveCampaign.
	 * Returns undefined if ActiveCampaign doesn't match the identifier.
	 */
	findCampaignByIdentifier(
		identifier: string | undefined,
		context: Context
	): Campaign | undefined {
		if (!identifier) return undefined;
		const active = context.ActiveCampaign;
		if (!active) return undefined;
		return isGUID(identifier)
			? active.Id === identifier ? active : undefined
			: active.RoomCode === identifier ? active : undefined;
	},

	/**
	 * Returns context.ActiveCampaign, throwing if not set.
	 * Use inside campaign views where a campaign is guaranteed to be loaded.
	 */
	getActiveCampaign(context: Context): Campaign {
		const campaign = context.ActiveCampaign;
		if (!campaign) {
			// Fallback: check URL for legacy callers
			const identifier = getUrlIdentifier();
			if (identifier) {
				throw new Error(
					`Campaign not loaded yet for identifier: ${identifier}. ` +
					`Use context.ActiveCampaign or await ContextActions.loadActiveCampaign().`
				);
			}
			throw new Error("No active campaign");
		}
		return campaign;
	},

	/**
	 * Creates a new campaign, saves it to IndexedDB, and adds a stub to context.Campaigns.
	 * Sets context.ActiveCampaign to the new campaign.
	 */
	async create(
		params: { name: string; roomCode?: string },
		context: Context
	): Promise<Campaign> {
		const campaign = createBlankCampaign(params.name, params.roomCode);

		await IndexedDBUtilities.saveCampaign(campaign);

		context.Campaigns.push(toStub(campaign));
		context.ActiveCampaign = campaign;
		ContextActions.save(context);

		return campaign;
	},

	/**
	 * Deletes a campaign from IndexedDB and removes its stub from context.Campaigns.
	 * Clears context.ActiveCampaign if it was the deleted campaign.
	 */
	async delete(params: { campaignId: string }, context: Context): Promise<void> {
		const index = context.Campaigns.findIndex(
			(c) => c.Id === params.campaignId
		);

		if (index === -1) {
			console.warn(`Campaign not found: ${params.campaignId}`);
			return;
		}

		await IndexedDBUtilities.removeCampaign(params.campaignId);
		context.Campaigns.splice(index, 1);

		if (context.ActiveCampaign?.Id === params.campaignId) {
			context.ActiveCampaign = undefined;
		}

		ContextActions.save(context);
	},

	/**
	 * Edits campaign properties. Updates the stub in context.Campaigns and
	 * the full Campaign in IndexedDB (via ActiveCampaign if loaded, or IDB directly).
	 */
	async edit(
		params: { campaignId: string; updates: Partial<Campaign> },
		context: Context
	): Promise<void> {
		// Update the stub (only stub-level fields are relevant here)
		const stub = context.Campaigns.find((c) => c.Id === params.campaignId);
		if (!stub) {
			console.warn(`Campaign stub not found: ${params.campaignId}`);
			return;
		}

		if (params.updates.Name !== undefined) stub.Name = params.updates.Name;
		if (params.updates.RoomCode !== undefined) stub.RoomCode = params.updates.RoomCode;

		// Update the full campaign
		if (context.ActiveCampaign?.Id === params.campaignId) {
			Object.assign(context.ActiveCampaign, params.updates);
			await IndexedDBUtilities.saveCampaign(context.ActiveCampaign);
		} else {
			// Campaign isn't currently active — load, patch, save back
			const campaign = await IndexedDBUtilities.loadCampaign(params.campaignId);
			if (campaign) {
				Object.assign(campaign, params.updates);
				await IndexedDBUtilities.saveCampaign(campaign);
			}
		}

		ContextActions.save(context);
	},

	/**
	 * Downloads a campaign as a JSON file with all image data included.
	 * Uses context.ActiveCampaign if it matches, otherwise loads from IndexedDB.
	 */
	async download(
		params: { campaignId: string },
		context: Context,
		onProgress?: (progress: ExportProgress) => void
	): Promise<void> {
		let campaign: Campaign | null =
			context.ActiveCampaign?.Id === params.campaignId
				? context.ActiveCampaign
				: await IndexedDBUtilities.loadCampaign(params.campaignId);

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
					imageData[image.Id] = { base64, mimeType: image.MimeType };
				}
			}

			onProgress?.({
				current: campaign.Images.length,
				total: campaign.Images.length,
				status: "Finalizing export...",
			});

			const exportData: CampaignExportData = {
				version: APP_VERSION,
				campaign,
				imageData,
			};

			const json = JSON.stringify(exportData, null, 2);
			const blob = new Blob([json], { type: "application/json" });
			const url = URL.createObjectURL(blob);

			const link = document.createElement("a");
			link.href = url;
			link.download = `${campaign.Name.replace(/[^a-z0-9]/gi, "_")}_${Date.now()}.json`;
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
				`Failed to export campaign: ${error instanceof Error ? error.message : "Unknown error"}`
			);
		}
	},

	async importFromFile(
		params: { file: File },
		context: Context,
		onProgress?: (progress: ExportProgress) => void
	): Promise<Campaign> {
		try {
			onProgress?.({ current: 0, total: 1, status: "Reading file..." });

			const text = await params.file.text();
			const data = JSON.parse(text);

			let campaign: Campaign;
			let imageData: Record<string, { base64: string; mimeType: string }> = {};
			let dataVersion: VersionString = "1.0.0";

			if (data && typeof data === "object" && "campaign" in data && "imageData" in data) {
				campaign = (data.campaign as Campaign) ?? ({} as Campaign);
				imageData =
					(data.imageData as Record<string, { base64: string; mimeType: string }>) || {};
				if (typeof data.version === "string") {
					dataVersion = data.version as VersionString;
				}
			} else {
				campaign = data as Campaign;
			}

			// Run sync schema migrations on the imported campaign using a scratch Context.
			// The IDB migration chain is NOT run here — we handle IDB persistence manually below.
			const tempContext = {
				User: structuredClone(context.User),
				// Cast: tempContext.Campaigns is Campaign[] (pre-1.6.0 shape) for migration purposes
				Campaigns: [structuredClone(campaign)] as unknown as CampaignInfo[],
				AppSettings: structuredClone(context.AppSettings as Record<string, string>),
				version: dataVersion,
			} as Context;

			const migratedContext = runMigrations(tempContext, APP_VERSION);
			// Extract the migrated campaign from the scratch context
			campaign = (migratedContext.Campaigns as unknown as Campaign[])[0];

			// Generate a new ID to avoid conflicts
			campaign.Id = crypto.randomUUID();

			// Ensure room code is unique
			const existingRoomCodes = context.Campaigns.map((c) => c.RoomCode);
			if (existingRoomCodes.includes(campaign.RoomCode)) {
				campaign.RoomCode = generateRoomCode();
			}

			// Import images to IndexedDB
			const imageIds = Object.keys(imageData);
			const totalSteps = imageIds.length + 1;

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

			onProgress?.({ current: imageIds.length, total: totalSteps, status: "Saving campaign..." });

			// Save campaign to IDB and add stub to context
			await IndexedDBUtilities.saveCampaign(campaign);
			context.Campaigns.push(toStub(campaign));
			context.ActiveCampaign = campaign;
			ContextActions.save(context);

			onProgress?.({ current: totalSteps, total: totalSteps, status: "Import complete!" });

			return campaign;
		} catch (error) {
			throw new Error(
				`Failed to import campaign: ${error instanceof Error ? error.message : "Invalid JSON"}`
			);
		}
	},
};
