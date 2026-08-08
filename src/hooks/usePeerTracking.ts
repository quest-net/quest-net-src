// hooks/usePeerTracking.ts
import { useEffect } from "react";
import { useSnapshot } from "valtio";
import { selfId } from "trystero";
import { useActionService } from "../services/Actions/ActionServiceProvider";
import { useQuestContext } from "../domains/Context/ContextProvider";
import { presenceStore } from "../domains/Context/contextStore";
import { User } from "../domains/User/User";

export interface PeerInfo {
	peerId: string;
	user: User | null;
	ping: number | null;
}

export interface PeerTrackingData {
	/**
	 * Remote peers only — does not include the local user. Players join
	 * passively, so for them this is the DM and nobody else.
	 */
	peers: PeerInfo[];
	/** The local user as a PeerInfo, for display alongside peers. */
	selfPeer: PeerInfo;
	/** Trivially true for the DM themselves. */
	isDmConnected: boolean;
	canAccessActor: (actorId: string) => boolean;
}

/**
 * Reads peer presence and ping data from ActionService and re-broadcasts the
 * local User when it changes. Peer state is owned by ActionService — see
 * `recordPeerUser` / `broadcastSelf` there.
 *
 * `ActiveCampaign` is read as nullable: it can be null mid-navigation between
 * campaigns, so the actor helpers degrade to "no actor" rather than throwing.
 */
export function usePeerTracking(): PeerTrackingData {
	const { actionService } = useActionService();
	const context = useQuestContext();
	const campaign = context.ActiveCampaign;
	const roomCode = campaign?.RoomCode;

	// Peer presence/pings are transient state on ActionService; it bumps
	// presenceStore.version on change, so subscribing here keeps this current.
	const { version: presenceVersion } = useSnapshot(presenceStore);
	void presenceVersion;

	// ActionService dedupes against the last broadcast, so calling this from
	// multiple components is a no-op after the first.
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

	const selfPeer: PeerInfo = {
		peerId: selfId as string,
		user: context.User,
		ping: null,
	};

	// Not peer count: a peer whose handshake User hasn't landed yet is present
	// but not yet known to be the DM.
	const isDmConnected =
		context.User.Role === "dm" ||
		peers.some((peer) => peer.user?.Role === "dm");

	const canAccessActor = (actorId: string): boolean => {
		if (context.User.Role === "dm") return true;
		if (!roomCode) return false;
		return context.User.SelectedCharacters[roomCode] === actorId;
	};

	return {
		peers,
		selfPeer,
		isDmConnected,
		canAccessActor,
	};
}
