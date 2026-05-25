// hooks/usePeerTracking.ts
import { useEffect } from "react";
import { selfId } from "trystero";
import { useActionService } from "../services/Actions/ActionServiceProvider";
import { useQuestContext } from "../domains/Context/ContextProvider";
import { User } from "../domains/User/User";

export interface PeerInfo {
	peerId: string;
	user: User | null;
	ping: number | null;
}

export interface PeerTrackingData {
	/** Remote peers only — does not include the local user. */
	peers: PeerInfo[];
	/** The local user as a PeerInfo, for display alongside peers. */
	selfPeer: PeerInfo;
	/** Total people in the room: peers.length + 1 (self). */
	totalInRoom: number;
	connectionStatus: "online" | "connected";
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
 *
 * NOTE: Reads `context.ActiveCampaign` as nullable — during the brief
 * navigation window between campaigns, ActiveCampaign can be null while
 * the parent view is mid-transition. The actor-resolver helpers all
 * gracefully degrade to "no actor" in that case rather than throwing.
 */
export function usePeerTracking(): PeerTrackingData {
	const { actionService } = useActionService();
	const context = useQuestContext();
	const campaign = context.ActiveCampaign;
	const roomCode = campaign?.RoomCode;

	// Re-broadcast our User whenever it changes (character selection, etc.).
	// ActionService dedupes against the last broadcast, so calling this from
	// multiple components is a no-op after the first one.
	const userJson = JSON.stringify(context.User);
	useEffect(() => {
		actionService?.broadcastSelf();
	}, [userJson, actionService]);

	const peerUsersMap = actionService?.peerUsers ?? new Map<string, User>();
	const peerPingsMap = actionService?.peerPings ?? new Map<string, number>();
	const connectedPeerIds = actionService?.connectedPeerIds ?? new Set<string>();

	const peers: PeerInfo[] = Array.from(connectedPeerIds).map(
		(peerId) => ({
			peerId,
			user: peerUsersMap.get(peerId) ?? null,
			ping: peerPingsMap.get(peerId) ?? null,
		})
	);

	// Represent the local user as a PeerInfo so the UI can include them in the
	// room list alongside remote peers. selfId is Trystero's ID for this peer.
	const selfPeer: PeerInfo = {
		peerId: selfId as string,
		user: context.User,
		ping: null,
	};

	const totalInRoom = peers.length + 1;

	const connectionStatus: "online" | "connected" =
		peers.length === 0 ? "online" : "connected";

	const canAccessActor = (actorId: string): boolean => {
		if (context.User.Role === "dm") return true;
		if (!roomCode) return false;
		return context.User.SelectedCharacters[roomCode] === actorId;
	};

	return {
		peers,
		selfPeer,
		totalInRoom,
		connectionStatus,
		canAccessActor,
	};
}
