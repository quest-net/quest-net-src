// domains/Campaign/CampaignView.tsx

import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
	useQuestContext,
	triggerContextUpdate,
} from "../Context/ContextProvider";
import { useActionService } from "../../services/Actions/ActionServiceProvider";
import { useAutoReconnect } from "../../hooks/useAutoReconnect";
import { CampaignActions } from "./CampaignActions";
import { ContextActions } from "../Context/ContextActions";
import { RoomActions } from "../Room/RoomActions";
import type { RoomCallbacks } from "../Room/RoomActions";
import type { DataPayload } from "trystero";
import { ActionService } from "../../services/Actions/ActionService";
import { isGUID } from "../../utils/UrlParser";
import { DMView } from "./DMView";
import { PlayerView } from "./PlayerView";
import { Campaign, CampaignInfo } from "./Campaign";
import type { User } from "../User/User";

type ViewStatus = "loading" | "ready" | "waiting-for-dm" | "error";

interface CampaignViewState {
	status: ViewStatus;
	errorMessage?: string;
}

export function CampaignView() {
	const { identifier } = useParams<{ identifier: string }>();
	const navigate = useNavigate();
	const context = useQuestContext();
	const { setActionService } = useActionService();
	const [reconnectTrigger, setReconnectTrigger] = useState(0);

	const [state, setState] = useState<CampaignViewState>({
		status: "loading",
	});

	useAutoReconnect(
		{
			enabled: state.status === "ready",
			checkIntervalMs: 10000,
			reconnectDelayMs: 8000,
		},
		() => {
			setReconnectTrigger((prev) => prev + 1);
		}
	);

	useEffect(() => {
		if (!identifier) {
			setState({
				status: "error",
				errorMessage: "No campaign identifier provided",
			});
			return;
		}

		const isDM = isGUID(identifier);

		let room: ReturnType<typeof RoomActions.join> | null = null;
		let service: ActionService | null = null;
		let isSubscribed = true;

		async function initialize() {
			try {
				// =====================================================================
				// STEP 1: Resolve ActiveCampaign from IDB if not already loaded
				// =====================================================================
				let campaign: Campaign | undefined =
					CampaignActions.findCampaignByIdentifier(identifier, context);

				if (!campaign) {
					// Try loading from IndexedDB (covers both DM and player-cached campaigns)
					const loaded = await ContextActions.loadActiveCampaign(identifier!, context);

					if (loaded) {
						campaign = loaded;

						// Ensure a stub exists in context.Campaigns for the index
						if (!context.Campaigns.find((s) => s.Id === loaded.Id)) {
							const stub: CampaignInfo = {
								Id: loaded.Id,
								Name: loaded.Name,
								RoomCode: loaded.RoomCode,
								CreatedAt: loaded.CreatedAt,
							};
							context.Campaigns.push(stub);
						}

						triggerContextUpdate();
					}
				}

				if (isDM) {
					if (!campaign) {
						if (!isSubscribed) return;
						setState({
							status: "error",
							errorMessage: `Campaign not found. ID: ${identifier}`,
						});
						return;
					}

					if (context.User.Role !== "dm") {
						ContextActions.setUserRole({ role: "dm" }, context);
						triggerContextUpdate();
					}
				} else {
					if (context.User.Role !== "player") {
						ContextActions.setUserRole({ role: "player" }, context);
						triggerContextUpdate();
					}
				}

				// =====================================================================
				// STEP 2: Join room
				// =====================================================================
				const roomCode = isDM ? campaign?.RoomCode || identifier! : identifier!;

				const callbacks: RoomCallbacks = {
					onPeerHandshake: async (peerId, send, receive, isInitiator) => {
						const myUser = context.User;
						let theirUser: User;
						if (isInitiator) {
							await send(myUser as unknown as DataPayload);
							const { data } = await receive();
							theirUser = data as unknown as User;
						} else {
							const { data } = await receive();
							await send(myUser as unknown as DataPayload);
							theirUser = data as unknown as User;
						}
						service?.recordPeerUser(peerId, theirUser);
					},
					onJoinError: (details) => {
						console.error("[CampaignView] onJoinError:", details);
						if (!isSubscribed) return;
						setState((cur) => {
							if (cur.status !== "waiting-for-dm") return cur;
							const message = details.error || "unknown";
							return {
								status: "error",
								errorMessage: `Couldn't join the room: ${message}`,
							};
						});
					},
				};

				room = RoomActions.join(roomCode, callbacks);
				console.log(`[CampaignView] Joined room: ${roomCode}`);

				// =====================================================================
				// STEP 3: Create ActionService
				// =====================================================================
				service = new ActionService(context, room);
				setActionService(service);

				// =====================================================================
				// STEP 4: Handle players with no cached campaign yet
				// =====================================================================
				if (!isDM && !campaign) {
					setState({ status: "waiting-for-dm" });

					const firstUpdatePromise = new Promise<void>((resolve) => {
						service?.onFirstUpdate(() => {
							if (isSubscribed) resolve();
						});
					});

					const timeoutPromise = new Promise<void>(
						(_, reject) =>
							setTimeout(() => {
								if (isSubscribed) reject(new Error("Timeout waiting for DM."));
							}, 15000)
					);

					Promise.race([firstUpdatePromise, timeoutPromise])
						.then(() => {
							setState({ status: "ready" });
						})
						.catch((error) => {
							console.error("[CampaignView]", error);
							setState({
								status: "error",
								errorMessage:
									"Could not connect to the DM. Please verify the room code and try again.",
							});
						});
				} else {
					setState({ status: "ready" });
				}
			} catch (error) {
				console.error("[CampaignView] Initialization error:", error);
				if (isSubscribed) {
					setState({
						status: "error",
						errorMessage:
							error instanceof Error ? error.message : "Unknown error",
					});
				}
			}
		}

		initialize();

		return () => {
			isSubscribed = false;
			if (room) RoomActions.leave(room);
			if (service) service.cleanup();
			setActionService(null);
		};
		// eslint-disable-next-line
	}, [identifier, setActionService, navigate, reconnectTrigger]);

	// =====================================================================
	// RENDER
	// =====================================================================

	if (state.status === "loading") {
		return (
			<div className="p-8 text-center">
				<h2>Connecting to campaign...</h2>
				<p>Establishing connection</p>
			</div>
		);
	}

	if (state.status === "error") {
		return (
			<div className="p-8 text-center">
				<h2 className="text-error font-bold text-2xl mb-4">Error</h2>
				<p className="mb-4">{state.errorMessage}</p>
				<button
					onClick={() => navigate("/campaigns")}
					className="btn btn-neutral"
				>
					Back to Campaigns
				</button>
			</div>
		);
	}

	if (state.status === "waiting-for-dm") {
		return (
			<div className="p-8 text-center">
				<h2>Waiting for DM...</h2>
				<p className="mb-4">
					Connected to room. Waiting for the DM to start the session.
				</p>
				<div className="spin">⏳</div>
				<button
					onClick={() => navigate("/campaigns")}
					className="btn btn-neutral"
				>
					Leave Room
				</button>
			</div>
		);
	}

	const isDM = isGUID(identifier!);
	return isDM ? <DMView /> : <PlayerView />;
}
