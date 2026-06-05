// services/TerrainTransferService.ts
//
// On-demand peer transfer of terrain voxel payloads, mirroring ImageService's
// imgReq/imgData pattern. Terrain payloads are no longer part of state sync
// (only the ContentHash metadata is), so a client that needs a terrain it does
// not have cached fetches it here:
//
//   - Player needs terrain T -> sends `terrainReq` -> DM replies on `terrainData`.
//   - DM is the authority and serves from its buffer / IndexedDB.
//
// Reliability vs. the (best-effort) image pattern comes from the caller:
// TerrainStorageService.hydrateTerrain only resolves once the payload whose
// ContentHash matches the canonical terrain is materialized, and the render /
// validation paths gate on that. Trystero transparently chunks the (possibly
// multi-megabyte) payload, so no manual chunking is needed here.

import type { Room } from "../domains/Room/Room";
import type { Campaign } from "../domains/Campaign/Campaign";
import { TerrainStorageService, type TerrainPayload } from "./TerrainStorageService";

interface TerrainRequestMessage {
	terrainId: string;
}

const TERRAIN_REQUEST_TIMEOUT_MS = 30000;

export class TerrainTransferService {
	private room: Room;
	private isDM: boolean;
	private getCampaign: () => Campaign | null;

	private sendTerrainRequest!: (
		data: TerrainRequestMessage,
		targetPeers?: string | string[] | null
	) => void;
	private sendTerrainData!: (
		data: TerrainPayload,
		targetPeers: string | string[],
		metadata: { terrainId: string }
	) => void;

	// In-flight player requests, deduped by terrainId.
	private pending = new Map<string, Promise<TerrainPayload | null>>();

	constructor(room: Room, isDM: boolean, getCampaign: () => Campaign | null) {
		this.room = room;
		this.isDM = isDM;
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
		const [sendRequest, getRequest] = this.room.makeAction("terrainReq");
		this.sendTerrainRequest = sendRequest as any;
		getRequest((data, peerId) => {
			if (!this.isDM) return;
			void this.handleRequest(
				(data as unknown as TerrainRequestMessage)?.terrainId,
				peerId
			);
		});

		const [sendData, getData] = this.room.makeAction("terrainData");
		this.sendTerrainData = sendData as any;
		getData((data, _peerId, metadata) => {
			const terrainId = (metadata as { terrainId?: string })?.terrainId;
			if (!terrainId) return;
			this.handleData(terrainId, data as unknown as TerrainPayload);
		});
	}

	/** DM: serve a requested terrain payload to a peer. */
	private async handleRequest(
		terrainId: string | undefined,
		peerId: string
	): Promise<void> {
		if (!terrainId) return;
		const campaign = this.getCampaign();
		if (!campaign) return;
		try {
			const payload = await TerrainStorageService.getPayloadForServing(
				campaign,
				terrainId
			);
			if (!payload) {
				console.warn(`[TerrainTransferService] No payload to serve: ${terrainId}`);
				return;
			}
			this.sendTerrainData(payload, peerId, { terrainId });
		} catch (error) {
			console.error(
				`[TerrainTransferService] Error serving terrain ${terrainId}:`,
				error
			);
		}
	}

	/** Player: a requested payload arrived; resolve the pending request. */
	private handleData(terrainId: string, payload: TerrainPayload): void {
		const pending = this.pendingResolvers.get(terrainId);
		if (!pending) return;
		this.pendingResolvers.delete(terrainId);
		this.pending.delete(terrainId);
		clearTimeout(pending.timeout);
		pending.resolve({
			voxels: payload?.voxels ?? "",
			contentHash: payload?.contentHash ?? "",
		});
	}

	private pendingResolvers = new Map<
		string,
		{ resolve: (p: TerrainPayload | null) => void; timeout: ReturnType<typeof setTimeout> }
	>();

	/** Player: request a terrain payload from the DM (deduped per terrainId). */
	private requestTerrain(
		terrainId: string,
		_expectedHash: string | undefined
	): Promise<TerrainPayload | null> {
		const existing = this.pending.get(terrainId);
		if (existing) return existing;

		const promise = new Promise<TerrainPayload | null>((resolve) => {
			const timeout = setTimeout(() => {
				this.pendingResolvers.delete(terrainId);
				this.pending.delete(terrainId);
				console.warn(`[TerrainTransferService] Timeout fetching terrain ${terrainId}`);
				resolve(null);
			}, TERRAIN_REQUEST_TIMEOUT_MS);
			this.pendingResolvers.set(terrainId, { resolve, timeout });
			// Broadcast to peers; the DM answers.
			this.sendTerrainRequest({ terrainId });
		});

		this.pending.set(terrainId, promise);
		return promise;
	}

	cleanup(): void {
		for (const { timeout } of this.pendingResolvers.values()) {
			clearTimeout(timeout);
		}
		this.pendingResolvers.clear();
		this.pending.clear();
		if (!this.isDM) {
			TerrainStorageService.setNetworkProvider(null);
		}
	}
}
