// domains/Log/useUnseenLogActors.ts
//
// Display-time name redaction for log lines, matching the combat banner: a log
// line about an actor the player can't see (hidden or out of sight) still shows,
// with that actor's name blocked out. Nothing here changes the stored entry.
// Feed the result to redactActorNames(text, unseen).

import { useCallback } from "react";
import { useQuestContext } from "../Context/ContextProvider";
import { CampaignUtils } from "../Campaign/CampaignUtils";
import type { Actor } from "../Actor/Actor";
import { isActorVisibleToUser } from "../Actor/ActorVisibilityUtils";
import { useOutOfSightActorIds } from "../../components/Map/useOutOfSightActorIds";
import type { LogEntry } from "./Log";

/**
 * Returns a lookup of the spawned actors a log entry names (its actor and its
 * target) that this user can't currently see. Always empty for the DM, and for
 * chat: a message is the player talking, so its sender and text stay as typed.
 */
export function useUnseenLogActors(): (
	entry: Pick<LogEntry, "ActorId" | "TargetId" | "Category">
) => Actor[] {
	const context = useQuestContext();
	const campaign = CampaignUtils.getActiveCampaign(context);
	const outOfSight = useOutOfSightActorIds();
	const { Characters, Entities } = campaign.GameState;
	const user = context.User;
	const roomCode = campaign.RoomCode;

	return useCallback(
		(entry) => {
			if (entry.Category === "chat") return [];
			return [...Characters, ...Entities].filter(
				(actor) =>
					(actor.Id === entry.ActorId || actor.Id === entry.TargetId) &&
					!isActorVisibleToUser(actor, user, roomCode, outOfSight)
			);
		},
		[Characters, Entities, user, roomCode, outOfSight]
	);
}
