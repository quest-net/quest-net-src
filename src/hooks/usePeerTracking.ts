// hooks/usePeerTracking.ts
import { useState, useEffect, useRef } from "react";
import { useActionService } from "../services/Actions/ActionServiceProvider";
import { useQuestContext } from "../domains/Context/ContextProvider";
import { RoomActions } from "../domains/Room/RoomActions";
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

export function usePeerTracking(): PeerTrackingData {
	const { actionService } = useActionService();
	const context = useQuestContext();
	const campaign = CampaignActions.getActiveCampaign(context);

	const [peerUsers, setPeerUsers] = useState<Record<string, User>>({});
	const [peerPings, setPeerPings] = useState<Record<string, number>>({});

	const sendUserRef = useRef<((data: any, peerId?: string) => void) | null>(null);
	const pingIntervalsRef = useRef<Record<string, ReturnType<typeof setInterval>>>({});

	// Convenience function: Get actor ID from user ID
	const getActorIdFromUserId = (userId: string): string | null => {
		const peer = Object.values(peerUsers).find((user) => user.Id === userId);
		if (!peer) return null;
		return peer.SelectedCharacters[campaign.RoomCode] || null;
	};

	// Convenience function: Get user ID from actor ID
	const getUserIdFromActorId = (actorId: string): string | null => {
		const peer = Object.values(peerUsers).find(
			(user) => user.SelectedCharacters[campaign.RoomCode] === actorId
		);
		return peer?.Id || null;
	};

	// Convenience function: Get full user from actor ID
	const getUserFromActorId = (actorId: string): User | null => {
		const peer = Object.values(peerUsers).find(
			(user) => user.SelectedCharacters[campaign.RoomCode] === actorId
		);
		return peer || null;
	};

	// Convenience function: Check if current user can access this actor
	const canAccessActor = (actorId: string): boolean => {
		if (context.User.Role === "dm") return true;
		return context.User.SelectedCharacters[campaign.RoomCode] === actorId;
	};

	useEffect(() => {
		if (!actionService) {
			return;
		}

		const room = actionService["room"];
		if (!room) {
			return;
		}

		// STEP 1: Create action
		const [sendUser, getUser] = room.makeAction("userState");
		sendUserRef.current = sendUser;

		// STEP 2: Set up receiver FIRST (before any broadcasting)
		getUser((userData, peerId) => {
			if (typeof userData === "object" && userData !== null) {
				setPeerUsers((current) => {
					const isNewPeer = !current[peerId];
					const updated = {
						...current,
						[peerId]: userData as unknown as User,
					};

					// If this is the first time we're hearing from this peer,
					// respond by sending our user data back to ensure mutual awareness
					if (isNewPeer && sendUserRef.current) {
						sendUserRef.current(context.User as any, peerId);
					}

					return updated;
				});
			}
		});

		// STEP 3: NOW broadcast to all existing peers
		sendUser(context.User as any);

		const startPingingPeer = (peerId: string) => {
			if (pingIntervalsRef.current[peerId]) {
				clearInterval(pingIntervalsRef.current[peerId]);
			}

			room
				.ping(peerId)
				.then((ms) => {
					setPeerPings((current) => ({
						...current,
						[peerId]: ms,
					}));
				})
				.catch((err) => {
					console.warn("[usePeerTracking] Failed initial ping:", {
						peerId,
						error: err,
					});
				});

			pingIntervalsRef.current[peerId] = setInterval(async () => {
				try {
					const ms = await room.ping(peerId);
					setPeerPings((current) => ({
						...current,
						[peerId]: ms,
					}));
				} catch (err) {
					console.warn("[usePeerTracking] Failed to ping peer:", {
						peerId,
						error: err,
					});
				}
			}, 3000);
		};

		// Set up peer join handler
		actionService.setOnPeerJoin((peerId) => {
			// Send our User object to the new peer
			if (sendUserRef.current) {
				sendUserRef.current(context.User as any, peerId);
			} else {
				console.warn(
					"[usePeerTracking] sendUserRef not set, cannot send to peer:",
					peerId
				);
			}

			startPingingPeer(peerId);
		});

		// Set up peer leave handler
		actionService.setOnPeerLeave((peerId) => {
			setPeerUsers((current) => {
				const updated = { ...current };
				delete updated[peerId];
				return updated;
			});

			setPeerPings((current) => {
				const updated = { ...current };
				delete updated[peerId];
				return updated;
			});

			if (pingIntervalsRef.current[peerId]) {
				clearInterval(pingIntervalsRef.current[peerId]);
				delete pingIntervalsRef.current[peerId];
			}
		});

		// Start pinging current peers
		const currentPeers = RoomActions.getConnectedPeerIds(room);
		currentPeers.forEach((peerId) => startPingingPeer(peerId));

		return () => {
			Object.values(pingIntervalsRef.current).forEach(clearInterval);
			pingIntervalsRef.current = {};
			// neutralize the userState receiver so unmounted closures never fire
			getUser(() => {});
			sendUserRef.current = null;
			// Clear state on cleanup - this only happens when actionService changes
			setPeerUsers({});
			setPeerPings({});
		};
	}, [actionService]);

	// Re-broadcast when User object changes (e.g., character selection)
	const userJson = JSON.stringify(context.User);

	useEffect(() => {
		if (sendUserRef.current) {
			sendUserRef.current(context.User as any);
		}
	}, [userJson]);

	// Build clean peer list from internal state
	const peers: PeerInfo[] = Object.keys(peerUsers).map((peerId) => ({
		peerId,
		user: peerUsers[peerId],
		ping: peerPings[peerId] ?? null,
	}));

	const connectionStatus: "online" | "connected" =
		peers.length === 0 ? "online" : "connected";

	return {
		peers,
		connectionStatus,
		getActorIdFromUserId,
		getUserIdFromActorId,
		getUserFromActorId,
		canAccessActor,
	};
}