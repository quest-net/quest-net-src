import { Context } from "../Context/Context";
import {
	clearBackupKeyTombstone,
	clearCampaignBackupState,
	contextStore,
	tombstoneBackupKey,
} from "../Context/contextStore";
import { Campaign } from "./Campaign";
import { CampaignInfo } from "./CampaignInfo";
import { getUrlIdentifier, isReservedRouteKeyword } from "../../utils/UrlParser";
import { CampaignSettingUtils } from "../CampaignSetting/CampaignSettingUtils";
import {
	CAMPAIGNS_STORE_NAME,
	CONTEXT_BACKUPS_STORE_NAME,
	IndexedDBUtilities,
} from "../../utils/IndexedDBUtilities";
import { APP_VERSION, type VersionString } from "../../version";
import { CampaignLoadingService } from "../../services/CampaignLoadingService";
import { VoxelTerrainUtils } from "../VoxelTerrain/VoxelTerrainUtils";
import { TerrainStorageService } from "../../services/TerrainStorageService";
import { runMigrations } from "../../migrations/runMigrations";
import { campaignMigrations } from "../../migrations/campaignMigrations";
import {
	addMissingDefaultVoxelStamps,
	commitEditableVoxelTerrain,
	createDefaultVoxelStamps,
} from "../../data/defaultVoxelStamps";
import {
	base64ToBlob,
	base64ToBytes,
	blobToBase64,
	bytesToBase64,
} from "../../utils/base64";


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
	const defaultVoxelTerrain = commitEditableVoxelTerrain(
		VoxelTerrainUtils.createDefault()
	);
	const defaultVoxelStamps = createDefaultVoxelStamps().map(
		commitEditableVoxelTerrain
	);

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
		VoxelTerrains: [defaultVoxelTerrain, ...defaultVoxelStamps],
		Audios: [],
		Images: [],
		Scenarios: [],
		TerrainLinks: [],
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
			CalendarDay: 0,
			RemainingShortRests: 2,
		},
		Log: [],
		LogHead: 0,
		Settings: CampaignSettingUtils.createDefault(),
	};
}

export function assertUsableRoomCode(roomCode?: string): void {
	if (roomCode && isReservedRouteKeyword(roomCode)) {
		throw new Error(`"${roomCode}" is a reserved app route and cannot be used as a room code`);
	}
}


export interface CampaignExportData {
	version: VersionString;
	campaign: Campaign;
	imageData: Record<string, { base64: string; mimeType: string }>;
	// Terrain voxel payloads, keyed by terrain Id. Kept out of the campaign
	// object (which carries only metadata + ContentHash) and shipped alongside,
	// the same way image binaries are. Optional for backward compat with
	// pre-2.7.0 export files (whose voxels are inline and handled by migration).
	terrainData?: Record<string, { voxels: string; contentHash: string }>;
	// Per-campaign local DM state that lives on the Context (keyed by the
	// campaign's GUID), not on the Campaign object: secret-mode flag and the
	// recently-viewed-terrains list. Travels with the campaign so it follows a
	// cloud restore; re-keyed onto the (possibly new) campaign Id on restore.
	// Optional — absence just means "no state to carry".
	contextState?: { secretMode?: boolean; viewedTerrains?: string[] };
}

export interface ExportProgress {
	current: number;
	total: number;
	status: string;
}

/**
 * How a restore should treat an existing local campaign.
 * - `copy`: brand-new Id, never clobbers anything (fresh machine / import file).
 * - `replace`: write under an existing local Id (update-in-place across devices).
 *
 * `keepBackupKey` is for the cloud restore of a campaign this device does not
 * have yet -- the restored copy IS that Drive file, so it keeps its identity.
 * Every other copy (importing a file, restoring a second copy of something you
 * already have) must take a fresh key: two local campaigns sharing one BackupKey
 * both upload to the same Drive file and overwrite each other's backups.
 */
export type RestoreMode =
	| { mode: "copy"; keepBackupKey?: boolean }
	| { mode: "replace"; targetCampaignId: string };

/** Per-collection content counts used for the restore shrink guard. */
export interface CampaignCounts {
	Items: number;
	Terrains: number;
	Images: number;
	Characters: number;
	Entities: number;
	Skills: number;
	Statuses: number;
}

export interface CountChange {
	label: keyof CampaignCounts;
	before: number;
	after: number;
}

export interface CampaignCountDiff {
	changes: CountChange[];
	significantShrink: boolean;
}

/**
 * Binaries a campaign's metadata references but that are absent from local
 * storage -- the signature of browser eviction wiping IndexedDB/OPFS while
 * localStorage (and so the campaign object) survived.
 */
export interface MissingBinaries {
	imageIds: string[];
	terrainIds: string[];
}

/** True when nothing is missing. */
export function hasNoMissingBinaries(missing: MissingBinaries): boolean {
	return missing.imageIds.length === 0 && missing.terrainIds.length === 0;
}

// A collection must drop by more than this fraction AND more than the absolute
// floor below for an update-in-place restore to flag a "significant shrink" and
// ask the user to confirm. Trimming a couple of images never nags.
export const RESTORE_SHRINK_THRESHOLD = 0.2;
export const RESTORE_SHRINK_MIN_ABSOLUTE = 5;

/**
 * Splits a parsed export payload into its parts, tolerating both the modern
 * container shape ({ version, campaign, imageData, terrainData }) and old-style
 * files that are just the bare Campaign object.
 */
function parseExportData(data: unknown): {
	campaign: Campaign;
	imageData: Record<string, { base64: string; mimeType: string }>;
	terrainData: Record<string, { voxels: string; contentHash: string }>;
	contextState?: CampaignExportData["contextState"];
	fileVersion: string;
} {
	let campaign: Campaign;
	let imageData: Record<string, { base64: string; mimeType: string }> = {};
	let terrainData: Record<string, { voxels: string; contentHash: string }> = {};
	let contextState: CampaignExportData["contextState"];

	if (
		data &&
		typeof data === "object" &&
		"campaign" in data &&
		"imageData" in data
	) {
		const container = data as CampaignExportData;
		campaign = (container.campaign as Campaign) ?? ({} as Campaign);
		imageData = container.imageData || {};
		terrainData = container.terrainData || {};
		contextState = container.contextState;
	} else {
		campaign = data as Campaign;
	}

	const fileVersion: string =
		(data && typeof data === "object" && "version" in data
			? (data as { version?: string }).version
			: null) ?? "0.0.0";

	return { campaign, imageData, terrainData, contextState, fileVersion };
}

/**
 * Every image id referenced by a campaign OTHER than `excludeCampaignId`.
 *
 * Image binaries live in one global IndexedDB store keyed by image id, and image
 * ids are PRESERVED across a copy-restore or a file import -- so a campaign and
 * any copy of it reference the very same blobs. Deleting a campaign must
 * therefore free only the blobs nothing else still points at. (Terrain needs no
 * equivalent: its OPFS paths are namespaced per campaign, so each copy owns its
 * own files.)
 *
 * Returns null when the set could not be established. Callers must then delete
 * NO image binaries: a leaked blob costs some space and a future GC pass can
 * reclaim it, whereas one wrongly deleted is gone for good.
 */
async function imageIdsInUseElsewhere(
	excludeCampaignId: string,
	context: Context
): Promise<Set<string> | null> {
	const inUse = new Set<string>();

	try {
		// Player entries count too -- a joined copy references the same image ids.
		const records = await IndexedDBUtilities.op<
			{ Id: string; Campaign?: Campaign }[]
		>(CAMPAIGNS_STORE_NAME, "readonly", (store) => store.getAll());

		for (const record of records ?? []) {
			if (!record || record.Id === excludeCampaignId) continue;
			for (const image of record.Campaign?.Images ?? []) {
				inUse.add(image.Id);
			}
		}
	} catch (e) {
		console.error(
			"[CampaignActions] Could not determine which images are still in use; " +
				"keeping all image binaries rather than risk deleting a shared one:",
			e
		);
		return null;
	}

	// The active campaign's stored record can lag behind the live object (images
	// added this session may not be packed yet), so read it directly as well.
	const active = context.ActiveCampaign;
	if (
		active &&
		active.Id !== excludeCampaignId &&
		active.RoomCode !== excludeCampaignId
	) {
		for (const image of active.Images ?? []) inUse.add(image.Id);
	}

	return inUse;
}

export const CampaignUtils = {
	/**
	 * Returns the lightweight CampaignInfo metadata matching the URL
	 * identifier -- DM secret GUID or player room code. Use this for
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
	 * is active -- callers should only invoke this after CampaignView has
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

		// Already unpacked the right one -- nothing to do.
		if (
			currentActive &&
			(currentActive.Id === identifier ||
				currentActive.RoomCode === identifier)
		) {
			return currentActive;
		}

		// Pack the previously active campaign back to IndexedDB.
		if (currentActive) {
			await CampaignUtils.packActive(context);
		}

		return await CampaignUtils.unpackById(identifier, context);
	},

	/**
	 * Creates a new campaign, persists it to IndexedDB, and adds a
	 * CampaignInfo to context.Campaigns. The new campaign is left packed --
	 * it gets unpacked when the user navigates to its URL.
	 */
	async create(
		params: { name: string; roomCode?: string },
		context: Context
	): Promise<CampaignInfo> {
		assertUsableRoomCode(params.roomCode);
		const campaign = createBlankCampaign(params.name, params.roomCode);

		await CampaignLoadingService.saveCampaign(campaign);

		const info = CampaignLoadingService.buildInfo(campaign);
		context.Campaigns.push(info);

		return info;
	},

	/**
	 * Deletes a campaign by ID -- removes the CampaignInfo entry, the
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
				// Raw: a plain read for cleanup must not re-key the global terrain
				// payload buffer onto the campaign being deleted, which would blank
				// the voxels of whatever campaign is actually being played.
				const stored = await CampaignLoadingService.loadCampaignRaw(
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

		// Work out which of those blobs anything else still needs, while the context
		// is intact (this reads ActiveCampaign, cleared further down).
		const inUseElsewhere =
			imageIds.length > 0
				? await imageIdsInUseElsewhere(params.campaignId, context)
				: new Set<string>();

		// Tombstone the backup identity BEFORE dropping the entry -- it is the only
		// place the key is still readable. Cloud backups are never deleted from
		// Drive (deliberately), so without this the next on-open sync sees a backup
		// with no local counterpart and silently restores what was just deleted.
		const backupKey =
			context.Campaigns[index].BackupKey ??
			(isActive ? context.ActiveCampaign?.BackupKey : undefined);
		if (backupKey) tombstoneBackupKey(backupKey);

		// Drop the metadata + active-campaign reference up front so the UI
		// reflects the deletion immediately even if the IDB cleanup below
		// is slow.
		context.Campaigns.splice(index, 1);

		clearCampaignBackupState(params.campaignId);

		if (isActive) {
			context.ActiveCampaign = null;
		}

		// Free image binaries first -- but only the ones no surviving campaign
		// references. Blobs are keyed by image id in a single global store and those
		// ids survive a copy-restore/import, so a campaign and a copy of it share
		// them; deleting every id this campaign mentions used to take the copy's
		// images with it. A null set means "could not tell", and there we keep
		// everything: leaking a blob is recoverable, deleting a live one is not.
		// ponytail: no refcount table, just a scan at delete time -- deletes are
		// rare and user-initiated. Revisit if campaign counts ever get large.
		if (imageIds.length > 0) {
			if (!inUseElsewhere) {
				console.warn(
					`[CampaignActions] Keeping all ${imageIds.length} image binaries of ` +
						`the deleted campaign: could not confirm they are unreferenced.`
				);
			} else {
				const orphaned = imageIds.filter((id) => !inUseElsewhere.has(id));
				const shared = imageIds.length - orphaned.length;
				if (shared > 0) {
					console.info(
						`[CampaignActions] Keeping ${shared} image binar${
							shared === 1 ? "y" : "ies"
						} still referenced by another campaign.`
					);
				}
				await Promise.all(
					orphaned.map(async (id) => {
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
	},

	/** Per-collection content counts, used for the restore shrink guard. */
	campaignCounts(campaign: Campaign): CampaignCounts {
		return {
			Items: campaign.ItemTemplates?.length ?? 0,
			Terrains: campaign.VoxelTerrains?.length ?? 0,
			Images: campaign.Images?.length ?? 0,
			Characters: campaign.CharacterRoster?.length ?? 0,
			Entities: campaign.EntityTemplates?.length ?? 0,
			Skills: campaign.SkillTemplates?.length ?? 0,
			Statuses: campaign.StatusTemplates?.length ?? 0,
		};
	},

	/**
	 * Compares incoming (backup) counts against local counts. Returns the changed
	 * collections and whether any of them shrank enough to warrant a confirm.
	 */
	diffCounts(local: CampaignCounts, incoming: CampaignCounts): CampaignCountDiff {
		const changes: CountChange[] = [];
		let significantShrink = false;

		(Object.keys(local) as (keyof CampaignCounts)[]).forEach((key) => {
			const before = local[key];
			const after = incoming[key];
			if (before !== after) {
				changes.push({ label: key, before, after });
			}
			const drop = before - after;
			if (
				drop > RESTORE_SHRINK_MIN_ABSOLUTE &&
				before > 0 &&
				drop / before > RESTORE_SHRINK_THRESHOLD
			) {
				significantShrink = true;
			}
		});

		return { changes, significantShrink };
	},

	/**
	 * Builds the self-contained export payload for an already-loaded campaign:
	 * the campaign object plus every image binary (from IndexedDB) and terrain
	 * voxel payload (from OPFS), base64-encoded for the JSON format. Pure data —
	 * no transport (download/upload) concern.
	 */
	async buildExportDataForCampaign(
		campaign: Campaign,
		onProgress?: (progress: ExportProgress) => void
	): Promise<CampaignExportData> {
		// Terrain voxel payloads travel as a separate bundle (like images); the
		// campaign object stays payload-free. The canonical payload is raw bytes;
		// base64-encode it here for the text (JSON) export format.
		const rawTerrainData = await TerrainStorageService.exportTerrainPayloads(campaign);
		const terrainData: Record<string, { voxels: string; contentHash: string }> = {};
		for (const [terrainId, payload] of Object.entries(rawTerrainData)) {
			terrainData[terrainId] = {
				voxels: bytesToBase64(payload.voxels),
				contentHash: payload.contentHash,
			};
		}

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

		// Carry the campaign's local DM context state (keyed by its GUID Id) so it
		// survives a cloud round-trip. Spread the array so no proxy reference leaks
		// into the export object.
		const secretMode = contextStore.SecretModes?.[campaign.Id];
		const viewedTerrains = contextStore.ViewedTerrains?.[campaign.Id];
		const contextState: CampaignExportData["contextState"] = {};
		if (secretMode !== undefined) contextState.secretMode = secretMode;
		if (viewedTerrains) contextState.viewedTerrains = [...viewedTerrains];

		return {
			version: APP_VERSION,
			campaign,
			imageData,
			terrainData,
			contextState,
		};
	},

	/**
	 * Downloads a campaign as a JSON file with all image + terrain data included.
	 */
	async download(
		params: { campaignId: string },
		context: Context,
		onProgress?: (progress: ExportProgress) => void
	): Promise<void> {
		try {
			const { campaignId } = params;
			// Prefer the live ActiveCampaign if it matches; otherwise pull from IDB.
			const campaign =
				context.ActiveCampaign &&
				(context.ActiveCampaign.Id === campaignId ||
					context.ActiveCampaign.RoomCode === campaignId)
					? context.ActiveCampaign
					: await CampaignLoadingService.loadCampaign(campaignId);

			if (!campaign) {
				console.warn(`Campaign payload missing: ${campaignId}`);
				return;
			}

			const exportData = await this.buildExportDataForCampaign(
				campaign,
				onProgress
			);

			const json = JSON.stringify(exportData, null, 2);
			const blob = new Blob([json], { type: "application/json" });
			const url = URL.createObjectURL(blob);

			const link = document.createElement("a");
			link.href = url;
			link.download = `${exportData.campaign.Name.replace(
				/[^a-z0-9]/gi,
				"_"
			)}_${Date.now()}.json`;
			document.body.appendChild(link);
			link.click();
			document.body.removeChild(link);
			URL.revokeObjectURL(url);

			onProgress?.({
				current: exportData.campaign.Images.length,
				total: exportData.campaign.Images.length,
				status: "Export complete!",
			});
		} catch (error) {
			throw new Error(
				`Failed to export campaign: ${error instanceof Error ? error.message : "Unknown error"
				}`
			);
		}
	},

	/**
	 * Lists the binaries this campaign references but no longer has on disk.
	 * Cheap: one keys-only IndexedDB read plus one existence probe per terrain,
	 * no payload bytes are loaded.
	 */
	async findMissingBinaries(campaign: Campaign): Promise<MissingBinaries> {
		// The image store is keyed by image id across all campaigns, so one
		// keys-only read covers every image this campaign references.
		const storedImageIds = await IndexedDBUtilities.listIds();
		const imageIds = (campaign.Images ?? [])
			.map((image) => image.Id)
			.filter((id) => !storedImageIds.has(id));

		const terrainIds: string[] = [];
		for (const terrain of campaign.VoxelTerrains ?? []) {
			if (!(await TerrainStorageService.hasStoredRecord(campaign, terrain.Id))) {
				terrainIds.push(terrain.Id);
			}
		}

		return { imageIds, terrainIds };
	},

	/**
	 * Writes back ONLY the binaries named in `missing` that this export payload
	 * happens to carry, leaving the campaign object completely untouched.
	 *
	 * Strictly additive by construction -- it can only fill gaps, never overwrite
	 * or delete -- which is what makes it safe to run automatically with no
	 * confirm. Returns how much it actually recovered.
	 */
	async repairBinariesFromExportData(
		campaign: Campaign,
		data: CampaignExportData | unknown,
		missing: MissingBinaries
	): Promise<{ images: number; terrains: number }> {
		const { imageData, terrainData } = parseExportData(data);

		let images = 0;
		for (const imageId of missing.imageIds) {
			const entry = imageData[imageId];
			if (!entry) continue;
			await IndexedDBUtilities.save(
				imageId,
				base64ToBlob(entry.base64, entry.mimeType)
			);
			images++;
		}

		// Terrain payloads land under the LOCAL campaign's id (terrain ids are
		// stable across a backup of the same campaign).
		const payloads: Record<string, { voxels: Uint8Array; contentHash: string }> =
			{};
		for (const terrainId of missing.terrainIds) {
			const entry = terrainData[terrainId];
			if (!entry) continue;
			payloads[terrainId] = {
				voxels: base64ToBytes(entry.voxels),
				contentHash: entry.contentHash,
			};
		}
		await TerrainStorageService.importTerrainPayloads(campaign, payloads);

		return { images, terrains: Object.keys(payloads).length };
	},

	/**
	 * The counts of a campaign as it ACTUALLY arrived, read from the parsed export
	 * payload rather than from whatever the uploading device advertised. The Drive
	 * appProperties counts are cheap (no download) and fine for the preview, but
	 * they are a claim -- this is the measurement, and it is what the irreversible
	 * step gets checked against.
	 */
	countsFromExportData(data: CampaignExportData | unknown): CampaignCounts | null {
		const { campaign } = parseExportData(data);
		if (!campaign || typeof campaign !== "object") return null;
		return this.campaignCounts(campaign);
	},

	/**
	 * Snapshots a campaign, whole and self-contained, into IndexedDB right before
	 * something overwrites it. This is what makes update-in-place restore
	 * reversible: the shrink guard can only warn, and it only sees seven
	 * collections, so the real protection is that the previous state still exists
	 * afterwards.
	 *
	 * Unlike `backupContextOnce` this deliberately OVERWRITES the previous
	 * snapshot -- the useful one is always the most recent pre-restore state.
	 *
	 * Throws on failure. Callers must not proceed with the overwrite: a restore
	 * with no way back is exactly the situation this exists to prevent.
	 */
	async snapshotBeforeRestore(campaign: Campaign): Promise<void> {
		const exportData = await this.buildExportDataForCampaign(campaign);
		await IndexedDBUtilities.op(CONTEXT_BACKUPS_STORE_NAME, "readwrite", (store) =>
			store.put({
				Key: `pre-restore-${campaign.Id}`,
				SourceVersion: exportData.version,
				SavedAt: Date.now(),
				CampaignName: campaign.Name,
				Counts: this.campaignCounts(campaign),
				// Stored as a string: the export is already JSON-shaped, and a string
				// cannot trip structuredClone on any proxy that leaked into it.
				ExportJson: JSON.stringify(exportData),
			})
		);
		console.info(
			`[CampaignUtils] Snapshotted "${campaign.Name}" under IndexedDB key ` +
				`"pre-restore-${campaign.Id}" before overwriting it.`
		);
	},

	/**
	 * Restores a campaign from a parsed export payload. `copy` mode (default)
	 * mints a new Id so nothing local is ever clobbered; `replace` mode writes
	 * under an existing local Id (update-in-place). The archive's `BackupKey` is
	 * preserved in both modes so cross-device identity survives the restore.
	 */
	async restoreFromExportData(
		data: CampaignExportData | unknown,
		context: Context,
		opts: RestoreMode = { mode: "copy" },
		onProgress?: (progress: ExportProgress) => void
	): Promise<CampaignInfo> {
		const { campaign, imageData, terrainData, contextState, fileVersion } =
			parseExportData(data);

		// Identity. A replace IS the campaign it overwrites, so it keeps the
		// archive's key; a copy only keeps it when the caller can guarantee no
		// local campaign already claims it (see RestoreMode).
		const keepBackupKey =
			opts.mode === "replace" || opts.keepBackupKey === true;
		if (!campaign.BackupKey || !keepBackupKey) {
			campaign.BackupKey = crypto.randomUUID();
		}

		if (opts.mode === "replace") {
			// Update in place: keep the existing local Id so we overwrite that
			// campaign instead of creating a duplicate entry.
			campaign.Id = opts.targetCampaignId;
		} else {
			// Restore as a copy: brand-new Id so an existing local campaign is
			// never clobbered.
			campaign.Id = crypto.randomUUID();
		}

		// Restore terrain payloads into IndexedDB/OPFS under the (possibly new)
		// id. Pre-2.7.0 files carry voxels inline on the campaign instead; the
		// schema migration below moves those over. The file stores voxels as
		// base64; decode back to the canonical byte form here.
		const terrainPayloads: Record<string, { voxels: Uint8Array; contentHash: string }> = {};
		for (const [terrainId, payload] of Object.entries(terrainData)) {
			terrainPayloads[terrainId] = {
				voxels: base64ToBytes(payload.voxels),
				contentHash: payload.contentHash,
			};
		}
		await TerrainStorageService.importTerrainPayloads(campaign, terrainPayloads);

		// Run schema migrations against the archive's saved version.
		const migrated = (await runMigrations(
			campaign,
			fileVersion,
			campaignMigrations
		)) as Campaign;
		addMissingDefaultVoxelStamps(migrated);

		// Ensure the room code is unique against OTHER local campaigns (exclude
		// the replace target itself so a same-campaign update keeps its code).
		const existingRoomCodes = context.Campaigns
			.filter((c) => c.Id !== migrated.Id)
			.map((c) => c.RoomCode);
		if (existingRoomCodes.includes(migrated.RoomCode)) {
			migrated.RoomCode = generateRoomCode();
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

		// Restore the campaign's local DM context state onto the FINAL id (a new
		// GUID for a copy, the target id for a replace), so secret mode and
		// recently-viewed terrains follow the campaign across a cloud restore.
		if (contextState?.secretMode !== undefined) {
			if (!contextStore.SecretModes) contextStore.SecretModes = {};
			contextStore.SecretModes[migrated.Id] = contextState.secretMode;
		}
		if (contextState?.viewedTerrains) {
			if (!contextStore.ViewedTerrains) contextStore.ViewedTerrains = {};
			contextStore.ViewedTerrains[migrated.Id] = [...contextState.viewedTerrains];
		}

		// Restoring a campaign is a deliberate un-delete: drop any tombstone so the
		// on-open sync stops suppressing it.
		if (migrated.BackupKey) clearBackupKeyTombstone(migrated.BackupKey);

		// Persist the full Campaign payload to IndexedDB, then replace the
		// matching CampaignInfo in place or append a new one.
		await CampaignLoadingService.saveCampaign(migrated);
		const info = CampaignLoadingService.buildInfo(migrated);
		const existingIndex = context.Campaigns.findIndex(
			(c) => c.Id === migrated.Id
		);
		if (existingIndex >= 0) {
			context.Campaigns[existingIndex] = info;
		} else {
			context.Campaigns.push(info);
		}

		onProgress?.({
			current: totalSteps,
			total: totalSteps,
			status: "Restore complete!",
		});

		return info;
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

			// Importing a file always restores as a copy — never clobber a local
			// campaign.
			return await this.restoreFromExportData(
				data,
				context,
				{ mode: "copy" },
				onProgress
			);
		} catch (error) {
			throw new Error(
				`Failed to import campaign: ${error instanceof Error ? error.message : "Invalid JSON"
				}`
			);
		}
	}
};
