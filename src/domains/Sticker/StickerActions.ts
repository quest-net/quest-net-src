// StickerActions.ts
// Action handlers for ephemeral emoji stickers shown above an actor.
//
// A sticker is a short-lived emoji reaction that any player or the DM can
// send while they have an active actor (selected character for players,
// impersonated actor for the DM). Stickers ride on top of the Log system:
// each sticker is recorded as a LogEntry with Category === "sticker" and
// the emoji in Details. Visual rendering and expiration are handled by
// useActiveStickers + Token.

import { Context } from "../Context/Context";
import { LogActions } from "../Log/LogActions";
import { LogUtils } from "../Log/LogUtils";
import { CampaignUtils } from "../Campaign/CampaignUtils";
import { STICKER_RATE_LIMIT_MS } from "./Sticker";

export const StickerActions = {
	/**
	 * Records a sticker for the given actor.
	 *
	 * Enforces a per-actor cooldown equal to STICKER_RATE_LIMIT_MS so a
	 * single actor can only fire one sticker every N seconds. The picker UI
	 * also enforces this client-side for snappy feedback (countdown timer);
	 * this check is the safety net against stale/replayed/peer-injected
	 * requests.
	 */
	create(
		params: { emoji: string; actorId: string },
		context: Context
	): void {
		if (context.IsOptimistic) return;

		const emoji = params.emoji;
		const actorId = params.actorId;

		// Basic shape validation — guards against peers sending garbage.
		if (!emoji || typeof emoji !== "string") return;
		if (!actorId || typeof actorId !== "string") return;

		const campaign = CampaignUtils.getActiveCampaign(context);

		// Per-actor cooldown. Skip if this actor sent another sticker within
		// the rate-limit window. Walk newest -> oldest and break as soon as
		// we drop out of the window.
		const cutoff = Date.now() - STICKER_RATE_LIMIT_MS;
		const logs = LogUtils.getChronologicalLog(campaign);
		for (let i = logs.length - 1; i >= 0; i--) {
			const entry = logs[i];
			if (entry.Timestamp < cutoff) break;
			if (entry.Category === "sticker" && entry.ActorId === actorId) {
				return;
			}
		}

		LogActions.create(
			{
				action: `sent a sticker: ${emoji}`,
				details: emoji,
				category: "sticker",
				level: "info",
				visibility: ["all"],
				actorId,
			},
			context
		);
	},
};
