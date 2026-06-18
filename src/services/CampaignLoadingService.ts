// services/CampaignLoadingService.ts

import {
	IndexedDBUtilities,
	CAMPAIGNS_STORE_NAME,
} from "../utils/IndexedDBUtilities";
import type { Campaign } from "../domains/Campaign/Campaign";
import type { CampaignInfo } from "../domains/Campaign/CampaignInfo";
import { APP_VERSION } from "../version";
import { TerrainStorageService } from "./TerrainStorageService";
import { runMigrations } from "../migrations/runMigrations";
import { campaignMigrations } from "../migrations/campaignMigrations";
import { addMissingDefaultVoxelStamps } from "../data/defaultVoxelStamps";
import { toPlain } from "../utils/toPlain";

/**
 * CampaignLoadingService
 *
 * Persists full Campaign payloads in IndexedDB so the active Context (and
 * therefore localStorage) only ever holds metadata for non-active campaigns.
 *
 * Naming follows the user's mental model:
 *   - "pack" = move a Campaign out of Context.ActiveCampaign and into IDB
 *   - "unpack" = pull a Campaign from IDB into Context.ActiveCampaign
 *
 * The active campaign stays unpacked in localStorage during play; we only
 * pack/unpack when the URL switches to a different campaign.
 */
export class CampaignLoadingService {
	/**
	 * Saves the full Campaign payload to IndexedDB. Stamps the current app
	 * version on the stored record so future schema migrations can find it.
	 */
	static async saveCampaign(campaign: Campaign): Promise<void> {
		await TerrainStorageService.prepareCampaignForStorage(campaign);
		const db = await IndexedDBUtilities.getDB();

		const record = {
			Id: campaign.Id,
			Version: APP_VERSION,
			// campaign may be the live Valtio proxy; IndexedDB's structured clone
			// throws on proxies, so store a plain snapshot.
			Campaign: toPlain(campaign),
			SavedAt: Date.now(),
		};

		return new Promise((resolve, reject) => {
			const transaction = db.transaction([CAMPAIGNS_STORE_NAME], "readwrite");
			const store = transaction.objectStore(CAMPAIGNS_STORE_NAME);
			const request = store.put(record);

			request.onsuccess = () => resolve();
			request.onerror = () => {
				console.error(
					`[CampaignLoadingService] Failed to save campaign: ${campaign.Id}`,
					request.error
				);
				reject(request.error);
			};
		});
	}

	/**
	 * Loads a full Campaign payload from IndexedDB by id (DM secret GUID, or
	 * RoomCode for the player path). Runs schema migrations transparently if
	 * the stored payload is older than APP_VERSION, and writes the migrated
	 * version back so the migration is incremental.
	 *
	 * Returns null if no campaign is stored under that id.
	 */
	static async loadCampaign(id: string): Promise<Campaign | null> {
		const db = await IndexedDBUtilities.getDB();

		const record = await new Promise<{
			Id: string;
			Version: string;
			Campaign: Campaign;
		} | null>((resolve, reject) => {
			const transaction = db.transaction([CAMPAIGNS_STORE_NAME], "readonly");
			const store = transaction.objectStore(CAMPAIGNS_STORE_NAME);
			const request = store.get(id);

			request.onsuccess = () => resolve(request.result ?? null);
			request.onerror = () => {
				console.error(
					`[CampaignLoadingService] Failed to load campaign: ${id}`,
					request.error
				);
				reject(request.error);
			};
		});

		if (!record) return null;

		const storedVersion = record.Version ?? "0.0.0";
		let campaign = record.Campaign;

		// Run schema migrations if the stored record is older than APP_VERSION.
		// Write the migrated payload back so each campaign is only migrated once.
		if (storedVersion !== APP_VERSION) {
			campaign = (await runMigrations(
				campaign,
				storedVersion,
				campaignMigrations
			)) as Campaign;
			await this.saveCampaign(campaign);
		}

		// Prepare BEFORE adding default stamps: prepareCampaignAfterLoad resets the
		// per-client payload buffer for this campaign, which would otherwise
		// discard freshly materialized stamp payloads before they are persisted.
		await TerrainStorageService.prepareCampaignAfterLoad(campaign);

		const addedDefaultVoxelStamps = addMissingDefaultVoxelStamps(campaign);
		if (addedDefaultVoxelStamps > 0) {
			await this.saveCampaign(campaign);
		}

		return campaign;
	}

	/**
	 * Removes a Campaign payload from IndexedDB.
	 */
	static async deleteCampaign(id: string): Promise<void> {
		const db = await IndexedDBUtilities.getDB();

		return new Promise((resolve, reject) => {
			const transaction = db.transaction([CAMPAIGNS_STORE_NAME], "readwrite");
			const store = transaction.objectStore(CAMPAIGNS_STORE_NAME);
			const request = store.delete(id);

			request.onsuccess = () => resolve();
			request.onerror = () => {
				console.error(
					`[CampaignLoadingService] Failed to delete campaign: ${id}`,
					request.error
				);
				reject(request.error);
			};
		});
	}

	/**
	 * Lists all stored campaign ids — primarily useful for diagnostics.
	 */
	static async listCampaignIds(): Promise<string[]> {
		const db = await IndexedDBUtilities.getDB();

		return new Promise((resolve, reject) => {
			const transaction = db.transaction([CAMPAIGNS_STORE_NAME], "readonly");
			const store = transaction.objectStore(CAMPAIGNS_STORE_NAME);
			const request = store.getAllKeys();

			request.onsuccess = () => resolve(request.result as string[]);
			request.onerror = () => reject(request.error);
		});
	}

	/**
	 * Builds a CampaignInfo metadata record from a full Campaign. Used when
	 * importing, creating, or migrating from the legacy "all-campaigns-in-
	 * localStorage" layout.
	 */
	static buildInfo(campaign: Campaign): CampaignInfo {
		const lastLog = campaign.Log[campaign.Log.length - 1];
		return {
			Id: campaign.Id,
			RoomCode: campaign.RoomCode,
			Name: campaign.Name,
			CreatedAt: campaign.CreatedAt,
			LastActivity: lastLog?.Timestamp ?? campaign.CreatedAt,
			CharacterCount:
				(campaign.CharacterRoster?.length ?? 0) +
				(campaign.GameState?.Characters?.length ?? 0),
			Version: APP_VERSION,
		};
	}

	/**
	 * Builds a CampaignInfo for the player path, where Id is the public
	 * RoomCode (since players never see the DM's secret GUID).
	 */
	static buildPlayerInfo(campaign: Campaign): CampaignInfo {
		const info = this.buildInfo(campaign);
		info.Id = campaign.RoomCode;
		return info;
	}
}
