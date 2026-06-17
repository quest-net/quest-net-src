// PingActions.ts
// Action handlers for ephemeral map pings.
//
// A ping is a short-lived map highlight that any player or the DM can
// place on a tile to draw attention to it during tactical discussion.
// Pings ride on top of the Log system: each ping is recorded as a
// LogEntry with Category === "ping". Visual rendering on the map and
// expiration are handled by useActivePings + the 3D ping layer.

import { Context } from "../Context/Context";
import { LogActions } from "../Log/LogActions";
import { LogUtils } from "../Log/LogUtils";
import { CampaignUtils } from "../Campaign/CampaignUtils";
import { serializePingDetails, PING_DURATION_MS } from "./Ping";

export const PingActions = {
	/**
	 * Records a ping at the clicked tile and surface height.
	 *
	 * Players see the ping on the map and as a log entry. The DM is treated
	 * the same as players for ping visibility (visibility: "all").
	 *
	 * Enforces a per-actor cooldown equal to PING_DURATION_MS: a single
	 * actor can only have one ping on the map at a time. The UI also enforces
	 * this client-side for snappy feedback; this check is the safety net
	 * against stale/replayed/peer-injected requests.
	 */
	create(
		params: { terrainId: string; x: number; y: number; h: number; actorId?: string },
		context: Context
	): void {
		if (context.IsOptimistic) return;
		if (typeof params.h !== "number" || !Number.isFinite(params.h)) return;

		const x = Math.round(params.x);
		const y = Math.round(params.y);
		let h = params.h;

		const campaign = CampaignUtils.getActiveCampaign(context);

		// Defense-in-depth bounds check against the ping's terrain. The UI's
		// screenToTile() should already discard clicks outside the grid, so
		// this is just a safety net.
		const terrain = campaign.VoxelTerrains?.find(
			(t) => t.Id === params.terrainId
		);
		if (terrain) {
			if (x < 0 || y < 0 || x >= terrain.Width || y >= terrain.Length) {
				return;
			}
			h = Math.max(0, Math.min(terrain.Height, h));
		}

		// Per-actor cooldown. Skip if this actor already has a ping on the
		// map within the cooldown window. Only enforced when an actorId is
		// supplied — anonymous pings (e.g. DM without impersonation) rely
		// purely on the client-side rate limit.
		if (params.actorId) {
			const cutoff = Date.now() - PING_DURATION_MS;
			const logs = LogUtils.getChronologicalLog(campaign);
			for (let i = logs.length - 1; i >= 0; i--) {
				const entry = logs[i];
				if (entry.Timestamp < cutoff) break;
				if (
					entry.Category === "ping" &&
					entry.ActorId === params.actorId
				) {
					return;
				}
			}
		}

		LogActions.create(
			{
				action: `pinged location (${x}, ${y}, ${h})`,
				details: serializePingDetails({ terrainId: params.terrainId, x, y, h }),
				category: "ping",
				level: "info",
				visibility: ["all"],
				actorId: params.actorId,
			},
			context
		);
	},
};
