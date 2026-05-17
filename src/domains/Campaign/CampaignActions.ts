import { Context } from "../Context/Context";
import { Campaign } from "./Campaign";
import { CampaignInfo } from "./CampaignInfo";
import { getUrlIdentifier } from "../../utils/UrlParser";
import { ContextActions } from "../Context/ContextActions";
import { CampaignSettingActions } from "../CampaignSetting/CampaignSettingActions";
import { IndexedDBUtilities } from "../../utils/IndexedDBUtilities";
import { APP_VERSION, type VersionString } from "../../version";
import { CampaignLoadingService } from "../../services/CampaignLoadingService";
import { VoxelTerrainActions } from "../VoxelTerrain/VoxelTerrainActions";
import { TerrainStorageService } from "../../services/TerrainStorageService";
import { runMigrations } from "../../migrations/runMigrations";
import { campaignMigrations } from "../../migrations/campaignMigrations";


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
	const defaultVoxelTerrain = VoxelTerrainActions.createDefault();
	defaultVoxelTerrain.VoxelsLoaded = true;

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
		VoxelTerrains: [defaultVoxelTerrain],
		Audios: [],
		Images: [],
		Scenarios: [],
		GameState: {
			Characters: [],
			Entities: [],
			CombatState: {
				isActive: false,
				currentRound: 0,
				initiativeSide: "party",
				RoundCompleted: [],
			},
			Audio: [],
			Volume: 0.5,
			Scene: {
				EnvironmentImageId: "",
				FocusImageId: "",
			},
			TerrainId: "DEFAULT_TERRAIN",
			VoxelTerrainId: defaultVoxelTerrain.Id,
			CalendarDay: 0,
			RemainingShortRests: 2,
		},
		Log: [],
		LogHead: 0,
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
	 * Returns the lightweight CampaignInfo metadata matching the URL
	 * identifier — DM secret GUID or player room code. Use this for
	 * existence checks and list rendering; for the live campaign payload,
	 * use getActiveCampaign.
	 */
	findCampaignByIdentifier(
		identifier: string | undefined,
		context: Context
	): CampaignInfo | undefined {
		if (!identifier) {
			return undefined;
		}
		// CampaignInfo.Id is the DM's secret GUID for DM entries and the
		// RoomCode for player entries (mirroring StateSync's sanitization),
		// so a single Id lookup works for both paths.
		return context.Campaigns.find((c) => c.Id === identifier);
	},

	/**
	 * Returns the currently unpacked Campaign payload. Throws if no campaign
	 * is active — callers should only invoke this after CampaignView has
	 * unpacked the active campaign for the URL.
	 */
	getActiveCampaign(context: Context): Campaign {
		if (context.ActiveCampaign) {
			return context.ActiveCampaign;
		}

		const identifier = getUrlIdentifier();
		if (!identifier) {
			throw new Error("No campaign identifier in URL");
		}
		throw new Error(
			`No active campaign for identifier: ${identifier}. ` +
			`The campaign may not be unpacked yet.`
		);
	},

	/**
	 * Pack the currently active campaign back into IndexedDB and clear
	 * context.ActiveCampaign. Safe to call when nothing is active. Refreshes
	 * the matching CampaignInfo metadata at the same time.
	 */
	async packActive(context: Context): Promise<void> {
		const active = context.ActiveCampaign;
		if (!active) return;

		try {
			await CampaignLoadingService.saveCampaign(active);
		} catch (e) {
			console.error("[CampaignActions] Failed to pack active campaign:", e);
		}

		// Refresh CampaignInfo metadata (last activity, character count, name)
		const isPlayerEntry =
			!!context.Campaigns.find((c) => c.Id === active.RoomCode);
		const refreshedInfo = isPlayerEntry
			? CampaignLoadingService.buildPlayerInfo(active)
			: CampaignLoadingService.buildInfo(active);

		const idx = context.Campaigns.findIndex((c) => c.Id === refreshedInfo.Id);
		if (idx !== -1) {
			context.Campaigns[idx] = refreshedInfo;
		} else {
			context.Campaigns.push(refreshedInfo);
		}

		context.ActiveCampaign = null;
	},

	/**
	 * Unpack a stored campaign by its identifier (DM GUID or player
	 * RoomCode) into context.ActiveCampaign. Returns the loaded Campaign or
	 * null if no payload exists in IndexedDB for that id.
	 *
	 * Caller is responsible for packing the previous active campaign first.
	 */
	async unpackById(
		identifier: string,
		context: Context
	): Promise<Campaign | null> {
		const loaded = await CampaignLoadingService.loadCampaign(
			identifier
		);
		if (!loaded) return null;

		context.ActiveCampaign = loaded;
		return loaded;
	},

	/**
	 * Switches the active campaign: packs whatever is currently active (if
	 * different) and unpacks the requested one. Returns the now-active
	 * Campaign or null if nothing was found in IndexedDB.
	 */
	async switchActive(
		identifier: string,
		context: Context
	): Promise<Campaign | null> {
		const currentActive = context.ActiveCampaign;

		// Already unpacked the right one — nothing to do.
		if (
			currentActive &&
			(currentActive.Id === identifier ||
				currentActive.RoomCode === identifier)
		) {
			return currentActive;
		}

		// Pack the previously active campaign back to IndexedDB.
		if (currentActive) {
			await this.packActive(context);
		}

		return await this.unpackById(identifier, context);
	},

	/**
	 * Creates a new campaign, persists it to IndexedDB, and adds a
	 * CampaignInfo to context.Campaigns. The new campaign is left packed —
	 * it gets unpacked when the user navigates to its URL.
	 */
	async create(
		params: { name: string; roomCode?: string },
		context: Context
	): Promise<CampaignInfo> {
		const campaign = createBlankCampaign(params.name, params.roomCode);

		await CampaignLoadingService.saveCampaign(campaign);

		const info = CampaignLoadingService.buildInfo(campaign);
		context.Campaigns.push(info);
		ContextActions.save(context);

		return info;
	},

	/**
	 * Deletes a campaign by ID — removes the CampaignInfo entry, the
	 * stored payload in IndexedDB, AND every image binary referenced by
	 * the campaign. Clears ActiveCampaign if it matches.
	 *
	 * The image cleanup runs before the payload delete so that if we crash
	 * partway through, we'd rather leak the (small) campaign record than
	 * leave the (potentially large) image binaries behind unreferenced.
	 */
	async delete(params: { campaignId: string }, context: Context): Promise<void> {
		const index = context.Campaigns.findIndex(
			(c) => c.Id === params.campaignId
		);

		if (index === -1) {
			console.warn(`Campaign not found: ${params.campaignId}`);
			return;
		}

		// Resolve image IDs from the live ActiveCampaign if it matches, so
		// we don't pay for an extra IDB load when deleting the current one.
		// Otherwise we have to pull the payload to know which image binaries
		// to free.
		let imageIds: string[] = [];
		const isActive =
			!!context.ActiveCampaign &&
			(context.ActiveCampaign.Id === params.campaignId ||
				context.ActiveCampaign.RoomCode === params.campaignId);

		if (isActive && context.ActiveCampaign) {
			imageIds = (context.ActiveCampaign.Images ?? []).map((img) => img.Id);
		} else {
			try {
				const stored = await CampaignLoadingService.loadCampaign(
					params.campaignId
				);
				if (stored) {
					imageIds = (stored.Images ?? []).map((img) => img.Id);
				}
			} catch (e) {
				// Non-fatal: we'll still proceed with the deletion below.
				// Worst case is leaked image binaries that a future GC pass
				// can pick up, which is the same situation we were in before
				// this cleanup existed.
				console.error(
					"[CampaignActions] Failed to enumerate images for delete cleanup:",
					e
				);
			}
		}

		// Drop the metadata + active-campaign reference up front so the UI
		// reflects the deletion immediately even if the IDB cleanup below
		// is slow.
		context.Campaigns.splice(index, 1);

		if (isActive) {
			context.ActiveCampaign = null;
		}

		// Free image binaries first. We log per-failure but don't abort the
		// rest — partial cleanup is better than no cleanup.
		if (imageIds.length > 0) {
			await Promise.all(
				imageIds.map(async (id) => {
					try {
						await IndexedDBUtilities.remove(id);
					} catch (e) {
						console.error(
							`[CampaignActions] Failed to remove image binary ${id}:`,
							e
						);
					}
				})
			);
		}

		try {
			await CampaignLoadingService.deleteCampaign(params.campaignId);
		} catch (e) {
			console.error("[CampaignActions] Failed to delete campaign payload:", e);
		}

		try {
			await TerrainStorageService.deleteCampaignTerrains(params.campaignId);
		} catch (e) {
			console.error("[CampaignActions] Failed to delete terrain payloads:", e);
		}

		ContextActions.save(context);
	},

	/**
	 * Edits campaign metadata (name, room code, settings). If the campaign
	 * is currently active, updates the live payload; otherwise loads the
	 * stored payload, applies the patch, and saves it back. Always refreshes
	 * the CampaignInfo metadata.
	 */
	async edit(
		params: { campaignId: string; updates: Partial<Campaign> },
		context: Context
	): Promise<void> {
		const info = context.Campaigns.find((c) => c.Id === params.campaignId);

		if (!info) {
			console.warn(`Campaign not found: ${params.campaignId}`);
			return;
		}

		let campaign: Campaign | null = null;

		if (
			context.ActiveCampaign &&
			(context.ActiveCampaign.Id === params.campaignId ||
				context.ActiveCampaign.RoomCode === params.campaignId)
		) {
			campaign = context.ActiveCampaign;
			Object.assign(campaign, params.updates);
		} else {
			campaign = await CampaignLoadingService.loadCampaign(
				params.campaignId
			);
			if (!campaign) {
				console.warn(
					`Campaign payload missing in IndexedDB: ${params.campaignId}`
				);
				return;
			}
			Object.assign(campaign, params.updates);
			await CampaignLoadingService.saveCampaign(campaign);
		}

		// Sync metadata fields that the user might have edited (Name,
		// RoomCode) so the campaigns list stays accurate.
		info.Name = campaign.Name;
		info.RoomCode = campaign.RoomCode;
		info.CharacterCount =
			(campaign.CharacterRoster?.length ?? 0) +
			(campaign.GameState?.Characters?.length ?? 0);

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
		const info = context.Campaigns.find((c) => c.Id === params.campaignId);

		if (!info) {
			console.warn(`Campaign not found: ${params.campaignId}`);
			return;
		}

		// Prefer the live ActiveCampaign if it matches; otherwise pull from IDB.
		let campaign: Campaign | null = null;
		if (
			context.ActiveCampaign &&
			(context.ActiveCampaign.Id === params.campaignId ||
				context.ActiveCampaign.RoomCode === params.campaignId)
		) {
			campaign = context.ActiveCampaign;
		} else {
			campaign = await CampaignLoadingService.loadCampaign(
				params.campaignId
			);
		}

		if (!campaign) {
			console.warn(
				`Campaign payload missing in IndexedDB: ${params.campaignId}`
			);
			return;
		}

		campaign = await TerrainStorageService.hydrateAllTerrains(campaign);

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
				version: APP_VERSION,
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
				`Failed to export campaign: ${error instanceof Error ? error.message : "Unknown error"
				}`
			);
		}
	},

	async importFromFile(
		params: { file: File },
		context: Context,
		onProgress?: (progress: ExportProgress) => void
	): Promise<CampaignInfo> {
		try {
			onProgress?.({
				current: 0,
				total: 1,
				status: "Reading file...",
			});

			const text = await params.file.text();
			const data = JSON.parse(text);

			let campaign: Campaign;
			let imageData: Record<string, { base64: string; mimeType: string }> = {};

			// New-style exports: { version, campaign, imageData }
			if (
				data &&
				typeof data === "object" &&
				"campaign" in data &&
				"imageData" in data
			) {
				campaign = (data.campaign as Campaign) ?? ({} as Campaign);
				imageData =
					(data.imageData as Record<string, { base64: string; mimeType: string }>) ||
					{};
			} else {
				// Old-style exports (pre-container) – assume it's just the Campaign object
				campaign = data as Campaign;
			}

			// Generate new ID to avoid conflicts
			campaign.Id = crypto.randomUUID();
			for (const terrain of campaign.VoxelTerrains ?? []) {
				delete terrain.VoxelStorageKey;
				terrain.VoxelsLoaded = true;
			}

			// Run schema migrations against the file's saved version.
			// For new-style exports the version lives on the container object;
			// old-style exports carry no version, so we start from scratch.
			const fileVersion: string =
				(data && typeof data === "object" && "version" in data
					? (data as any).version
					: null) ?? "0.0.0";
			campaign = (await runMigrations(
				campaign,
				fileVersion,
				campaignMigrations
			)) as Campaign;

			// Ensure room code is unique against existing CampaignInfos
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

			// Persist the full Campaign payload to IndexedDB and add a
			// CampaignInfo to the in-memory list.
			await CampaignLoadingService.saveCampaign(campaign);
			const info = CampaignLoadingService.buildInfo(campaign);
			context.Campaigns.push(info);
			ContextActions.save(context);

			onProgress?.({
				current: totalSteps,
				total: totalSteps,
				status: "Import complete!",
			});

			return info;
		} catch (error) {
			throw new Error(
				`Failed to import campaign: ${error instanceof Error ? error.message : "Invalid JSON"
				}`
			);
		}
	}
};
