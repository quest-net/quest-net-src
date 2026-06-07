// services/TerrainTransferService.ts
//
// On-demand peer transfer of terrain voxel payloads. Terrain payloads are not
// part of state sync (only the ContentHash metadata is), so a client that
// needs a terrain it does not have cached fetches it from the DM here:
//
//   - Player needs terrain T -> requests it from the DM -> DM responds with
//     the payload it serves from its buffer / IndexedDB.
//
// This rides on a single Trystero `kind: "request"` action: Trystero owns
// request/response correlation, the per-request timeout, and chunking of the
// (possibly multi-megabyte) payload, so no manual bookkeeping is needed here.
// Reliability vs. best-effort comes from the caller: TerrainStorageService.
// hydrateTerrain only resolves once the payload whose ContentHash matches the
// canonical terrain is materialized, and the render / validation paths gate on
// that.

import type { Room, ActionRequest } from "../domains/Room/Room";
import type { Campaign } from "../domains/Campaign/Campaign";
import { TerrainStorageService, type TerrainPayload } from "./TerrainStorageService";

const TERRAIN_REQUEST_TIMEOUT_MS = 30000;

export class TerrainTransferService {
	private room: Room;
	private isDM: boolean;
	private getCampaign: () => Campaign | null;
	private getDmPeerId: () => string | undefined;

	private requestTerrainData!: ActionRequest; // terrainId -> TerrainPayload

	// Dedup concurrent player requests for the same terrainId.
	private pending = new Map<string, Promise<TerrainPayload | null>>();

	constructor(
		room: Room,
		isDM: boolean,
		getDmPeerId: () => string | undefined,
		getCampaign: () => Campaign | null
	) {
		this.room = room;
		this.isDM = isDM;
		this.getDmPeerId = getDmPeerId;
		this.getCampaign = getCampaign;
		this.setupChannels();

		// Players resolve missing terrain payloads through this service.
		if (!isDM) {
			TerrainStorageService.setNetworkProvider((terrainId, expectedHash) =>
				this.requestTerrain(terrainId, expectedHash)
			);
		}
	}

	private setupChannels(): void {
		const terrainFetch = this.room.makeAction<any, any>("terrainFetch", {
			kind: "request",
			onRequest: this.isDM
				? (terrainId) => this.serveTerrain(terrainId as string)
				: undefined,
		});
		this.requestTerrainData = terrainFetch.request;
	}

	/** Player: request a terrain payload from the DM (deduped per terrainId). */
	private requestTerrain(
		terrainId: string,
		_expectedHash: string | undefined
	): Promise<TerrainPayload | null> {
		const existing = this.pending.get(terrainId);
		if (existing) return existing;

		const promise = this.fetchTerrain(terrainId);
		this.pending.set(terrainId, promise);
		promise.finally(() => this.pending.delete(terrainId));
		return promise;
	}

	private async fetchTerrain(terrainId: string): Promise<TerrainPayload | null> {
		const dmPeerId = this.getDmPeerId();
		if (!dmPeerId) {
			console.warn(
				`[TerrainTransferService] No DM peer to request terrain ${terrainId}`
			);
			return null;
		}

		try {
			const payload = (await this.requestTerrainData(terrainId, {
				target: dmPeerId,
				timeoutMs: TERRAIN_REQUEST_TIMEOUT_MS,
			})) as TerrainPayload | null;
			return {
				voxels: payload?.voxels ?? "",
				contentHash: payload?.contentHash ?? "",
			};
		} catch (error) {
			console.warn(
				`[TerrainTransferService] Failed to fetch terrain ${terrainId}:`,
				error
			);
			return null;
		}
	}

	/** DM: serve a requested terrain payload. Throws if it cannot be served. */
	private async serveTerrain(terrainId: string): Promise<TerrainPayload> {
		const campaign = this.getCampaign();
		if (!campaign) {
			throw new Error("No active campaign to serve terrain from");
		}
		const payload = await TerrainStorageService.getPayloadForServing(
			campaign,
			terrainId
		);
		if (!payload) {
			throw new Error(`No payload to serve for terrain ${terrainId}`);
		}
		return payload;
	}

	cleanup(): void {
		// In-flight requests reject on their own when the room tears down
		// (peer disconnect) or their timeout fires; just drop the dedup map.
		this.pending.clear();
		if (!this.isDM) {
			TerrainStorageService.setNetworkProvider(null);
		}
	}
}
