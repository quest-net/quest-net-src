// hooks/usePeerTracking.ts
import { useEffect } from "react";
import { useActionService } from "../services/Actions/ActionServiceProvider";
import { useQuestContext } from "../domains/Context/ContextProvider";
import { User } from "../domains/User/User";
import { CampaignActions } from "../domains/Campaign/CampaignActions";

export interface PeerInfo {
	peerId: string;
	user: User;
	ping: number | null;
}

export interface PeerTrackingData {
	peers: PeerInfo[];
	connectionStatus: "online" | "connected";
	getActorIdFromUserId: (userId: string) => string | null;
	getUserIdFromActorId: (actorId: string) => string | null;
	getUserFromActorId: (actorId: string) => User | null;
	canAccessActor: (actorId: string) => boolean;
}

/**
 * Reads peer presence and ping data from ActionService and re-broadcasts
 * the local User when it changes. Peer state itself (User payloads, pings)
 * is owned by ActionService — see `recordPeerUser` / `broadcastSelf` there.
 *
 * Initial peer User exchange happens via the joinRoom handshake, set up
 * in `CampaignView`. Runtime updates (e.g., character selection) flow
 * through the `userUpdate` action.
 */
export function usePeerTracking(): PeerTrackingData {
	const { actionService } = useActionService();
	const context = useQuestContext();
	const campaign = CampaignActions.getActiveCampaign(context);

	// Re-broadcast our User whenever it changes (character selection, etc.).
	// ActionService dedupes against the last broadcast, so calling this from
	// multiple components is a no-op after the first one.
	const userJson = JSON.stringify(context.User);
	useEffect(() => {
		actionService?.broadcastSelf();
	}, [userJson, actionService]);

	const peerUsersMap = actionService?.peerUsers ?? new Map<string, User>();
	const peerPingsMap = actionService?.peerPings ?? new Map<string, number>();

	const peers: PeerInfo[] = Array.from(peerUsersMap.entries()).map(
		([peerId, user]) => ({
			peerId,
			user,
			ping: peerPingsMap.get(peerId) ?? null,
		})
	);

	const connectionStatus: "online" | "connected" =
		peers.length === 0 ? "online" : "connected";

	const getActorIdFromUserId = (userId: string): string | null => {
		for (const user of peerUsersMap.values()) {
			if (user.Id === userId) {
				return user.SelectedCharacters[campaign.RoomCode] || null;
			}
		}
		return null;
	};

	const getUserIdFromActorId = (actorId: string): string | null => {
		for (const user of peerUsersMap.values()) {
			if (user.SelectedCharacters[campaign.RoomCode] === actorId) {
				return user.Id;
			}
		}
		return null;
	};

	const getUserFromActorId = (actorId: string): User | null => {
		for (const user of peerUsersMap.values()) {
			if (user.SelectedCharacters[campaign.RoomCode] === actorId) {
				return user;
			}
		}
		return null;
	};

	const canAccessActor = (actorId: string): boolean => {
		if (context.User.Role === "dm") return true;
		return context.User.SelectedCharacters[campaign.RoomCode] === actorId;
	};

	return {
		peers,
		connectionStatus,
		getActorIdFromUserId,
		getUserIdFromActorId,
		getUserFromActorId,
		canAccessActor,
	};
}
