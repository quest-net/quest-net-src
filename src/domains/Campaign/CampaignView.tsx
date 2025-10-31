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
import { ActionService } from "../../services/Actions/ActionService";
import { isGUID } from "../../utils/UrlParser";
import { DMView } from "./DMView";
import { PlayerView } from "./PlayerView";
import { Campaign } from "./Campaign";

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
			enabled: state.status === "ready", // Only auto-reconnect when we're supposed to be connected
			checkIntervalMs: 5000, // Check every 5 seconds
			reconnectDelayMs: 3000, // Wait 3 seconds of 0 peers before reconnecting
			// maxAttempts is now Infinity by default - unlimited retries!
		},
		() => {
			// Increment the trigger to force useEffect to re-run
			setReconnectTrigger((prev) => prev + 1);
		}
	);

	useEffect(() => {
		// Validate identifier
		if (!identifier) {
			setState({
				status: "error",
				errorMessage: "No campaign identifier provided",
			});
			return;
		}

		const isDM = isGUID(identifier);

		// Setup variables that need cleanup
		let room: ReturnType<typeof RoomActions.join> | null = null;
		let service: ActionService | null = null;
		let isSubscribed = true; // For handling async state updates after unmount

		async function initialize() {
			try {
				// =====================================================================
				// STEP 1: Find or wait for campaign
				// =====================================================================
				let campaign = CampaignActions.findCampaignByIdentifier(
					identifier,
					context
				);

				if (isDM) {
					// DM mode: Campaign must exist
					if (!campaign) {
						setState({
							status: "error",
							errorMessage: `Campaign not found. ID: ${identifier}`,
						});
						return;
					}

					// Set user role if not already set
					if (context.User.Role !== "dm") {
						ContextActions.setUserRole({ role: "dm" }, context);
						triggerContextUpdate();
					}

				} else {
					// Player mode: Campaign might not exist yet
					if (!campaign) {

						// Check if we have a saved version from a previous session
						// Players save received campaigns as: campaign_${roomCode}
						const savedCampaign = localStorage.getItem(
							`campaign_${identifier}`
						);
						if (savedCampaign) {
							try {
								campaign = JSON.parse(savedCampaign) as Campaign;
								context.Campaigns.push(campaign);
								triggerContextUpdate();

							} catch (error) {
								console.error(
									"[CampaignView] Failed to parse saved campaign:",
									error
								);
							}
						}
					}

					// Set user role if not already set
					if (context.User.Role !== "player") {
						ContextActions.setUserRole({ role: "player" }, context);
						triggerContextUpdate();
					}

				}

				// =====================================================================
				// STEP 2: Join room
				// =====================================================================
				const roomCode = isDM ? campaign?.RoomCode || identifier : identifier;
				room = RoomActions.join(roomCode);
				console.log(`[CampaignView] Joined room: ${roomCode}`);

				// =====================================================================
				// STEP 3: Create ActionService
				// =====================================================================
				service = new ActionService(context, room);
				setActionService(service);

				// =====================================================================
				// STEP 4: Handle initial state for players without campaign
				// =====================================================================
				if (!isDM && !campaign) {
					setState({ status: "waiting-for-dm" });

					// This promise resolves when the onFirstUpdate callback is called
					const firstUpdatePromise = new Promise<void>((resolve) => {
						service?.onFirstUpdate(() => {
							if (isSubscribed) {
								resolve();
							}
						});
					});

					// This promise rejects after a timeout
					const timeoutPromise = new Promise<void>(
						(_, reject) =>
							setTimeout(() => {
								if (isSubscribed) {
									reject(new Error("Timeout waiting for DM."));
								}
							}, 15000) // 15-second timeout
					);

					// Race the two promises
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
					// Campaign exists, ready to render
					setState({
						status: "ready",
					});
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

		// =====================================================================
		// CLEANUP
		// =====================================================================
		return () => {
			isSubscribed = false;

			if (room) {
				RoomActions.leave(room);
			}

			if (service) {
				service.cleanup();
			}

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

	// State is 'ready' with a campaign
	const isDM = isGUID(identifier!);

	return isDM ? <DMView /> : <PlayerView />;
}
