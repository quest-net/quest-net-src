// PingActions.ts
// Action handlers for ephemeral map pings.
//
// A ping is a short-lived map highlight that any player or the DM can
// place on a tile to draw attention to it during tactical discussion.
// Pings ride on top of the Log system: each ping is recorded as a
// LogEntry with Category === "ping". Visual rendering on the map and
// expiration are handled by useActivePings + MapWorldLayer.

import { Context } from "../Context/Context";
import { LogActions } from "../Log/LogActions";
import { CampaignActions } from "../Campaign/CampaignActions";
import { serializePingDetails, PING_DURATION_MS } from "./Ping";

export const PingActions = {
	/**
	 * Records a ping at the given tile coordinates.
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
		params: { x: number; y: number; actorId?: string },
		context: Context
	): void {
		if (context.IsOptimistic) return;

		const x = Math.round(params.x);
		const y = Math.round(params.y);

		const campaign = CampaignActions.getActiveCampaign(context);

		// Defense-in-depth bounds check against the active terrain. The UI's
		// screenToTile() should already discard clicks outside the grid, so
		// this is just a safety net.
		const terrain =
			campaign.VoxelTerrains?.find((t) => t.Id === campaign.GameState.VoxelTerrainId) ||
			campaign.Terrains.find((t) => t.Id === campaign.GameState.TerrainId) ||
			campaign.Terrains.find((t) => t.Id === "DEFAULT_TERRAIN");
		if (terrain) {
			if (x < 0 || y < 0 || x >= terrain.Width || y >= terrain.Length) {
				return;
			}
		}

		// Per-actor cooldown. Skip if this actor already has a ping on the
		// map within the cooldown window. Only enforced when an actorId is
		// supplied — anonymous pings (e.g. DM without impersonation) rely
		// purely on the client-side rate limit.
		if (params.actorId) {
			const cutoff = Date.now() - PING_DURATION_MS;
			const logs = LogActions.getChronologicalLog(campaign);
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
				action: `pinged location (${x}, ${y})`,
				details: serializePingDetails({ x, y }),
				category: "ping",
				level: "info",
				visibility: ["all"],
				actorId: params.actorId,
			},
			context
		);
	},
};
