// domains/Campaign/CampaignView.tsx

import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { contextStore } from "../Context/contextStore";
import { useActionService } from "../../services/Actions/ActionServiceProvider";
import { CampaignUtils } from "./CampaignUtils";
import { ContextService } from "../Context/ContextService";
import { RoomService } from "../Room/RoomService";
import type { RoomCallbacks } from "../Room/RoomService";
import type { DataPayload } from "trystero";
import { ActionService } from "../../services/Actions/ActionService";
import { isGUID } from "../../utils/UrlParser";
import { DMView } from "./DMView";
import { PlayerView } from "./PlayerView";
import { CampaignConnectionScreen } from "./CampaignConnectionScreen";
import type { User } from "../User/User";
import { UserUtils } from "../User/UserUtils";

type ViewStatus = "loading" | "ready" | "waiting-for-dm" | "error";

interface CampaignViewState {
	status: ViewStatus;
	errorMessage?: string;
	// When true, this error is a transient "couldn't reach the DM yet" state
	// rather than a hard failure (bad room code, missing payload, etc.). The
	// original Trystero room remains mounted, and a late first state update still
	// flips us to "ready" (see onFirstUpdate).
	retryable?: boolean;
}

// UI feedback only. Reaching this deadline changes the connection screen but
// never leaves, recreates, or otherwise interferes with the Trystero room.
const PLAYER_JOIN_TIMEOUT_MS = 20000;
const POSE_ROOM_SUFFIX = ":pose:v1";
const PLAYER_POSE_JOIN_MIN_DELAY_MS = 250;
const PLAYER_POSE_JOIN_JITTER_MS = 500;

export function CampaignView() {
	const { identifier } = useParams<{ identifier: string }>();
	const navigate = useNavigate();
	// Writable proxy: this view mutates context (pack/unpack, role, selected
	// character) and hands the same proxy to ActionService as the single source
	// of truth. Reads happen in effects/callbacks, not render, so no snapshot
	// is needed here.
	const context = contextStore;
	const { setActionService } = useActionService();
	const isDMRoute = !!identifier && isGUID(identifier);

	const [state, setState] = useState<CampaignViewState>({
		status: "loading",
	});

	// When the URL identifier changes, drop status back to "loading" before
	// any other effect runs. Without this, status carries over as "ready"
	// from the previous campaign, and there's a window during the new
	// effect's pack/unpack where ActiveCampaign is null but the parent still
	// thinks it should render <DMView/> or <PlayerView/> — both of those
	// call usePeerTracking() unconditionally, which throws on null
	// ActiveCampaign. Resetting here closes that window.
	useEffect(() => {
		setState((prev) =>
			prev.status === "loading" ? prev : { status: "loading" }
		);
	}, [identifier]);

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
		let room: ReturnType<typeof RoomService.join> | null = null;
		let poseRoom: ReturnType<typeof RoomService.join> | null = null;
		let service: ActionService | null = null;
		let isSubscribed = true; // For handling async state updates after unmount
		let joinTimeout: ReturnType<typeof setTimeout> | null = null;
		let poseJoinTimeout: ReturnType<typeof setTimeout> | null = null;
		let campaignRoomCode: string | null = null;
		let unsubscribeDmConnectionLost: (() => void) | null = null;

		const closePoseRoom = () => {
			if (poseJoinTimeout) {
				clearTimeout(poseJoinTimeout);
				poseJoinTimeout = null;
			}
			service?.actorPoseService.detachRoom();
			if (poseRoom) {
				RoomService.leave(poseRoom);
				poseRoom = null;
			}
		};

		const openPoseRoom = () => {
			if (!isSubscribed || !service || !campaignRoomCode || poseRoom) return;

			try {
				poseRoom = RoomService.join(`${campaignRoomCode}${POSE_ROOM_SUFFIX}`, {
					passive: false,
					callbacks: {
						onJoinError: (details) => {
							console.warn(
								"[PoseRoom] Optional pose connection failed:",
								details.error
							);
						},
					},
				});
				service.actorPoseService.attachRoom(poseRoom);
			} catch (error) {
				console.warn("[PoseRoom] Could not start optional pose room:", error);
				closePoseRoom();
			}
		};

		const schedulePlayerPoseRoom = () => {
			if (isDM || poseRoom || poseJoinTimeout) return;
			const delay =
				PLAYER_POSE_JOIN_MIN_DELAY_MS +
				Math.random() * PLAYER_POSE_JOIN_JITTER_MS;
			poseJoinTimeout = setTimeout(() => {
				poseJoinTimeout = null;
				if (!service?.getDmPeerId()) return;
				openPoseRoom();
			}, delay);
		};

		const handlePlayerStateReady = () => {
			if (!isSubscribed) return;
			if (joinTimeout) {
				clearTimeout(joinTimeout);
				joinTimeout = null;
			}
			setState({ status: "ready" });
			schedulePlayerPoseRoom();
		};

		async function initialize() {
			try {
				// =====================================================================
				// STEP 1: Pack/Unpack switch — bring the right campaign into Active
				// =====================================================================
				//
				// We only "pack" (write back to IndexedDB) the previously active
				// campaign if it's different from the one we're about to load,
				// matching the user's mental model: an actively played campaign
				// stays unpacked, and we only swap when the URL truly changes.
				let info = CampaignUtils.findCampaignByIdentifier(
					identifier,
					context
				);

				const alreadyActive =
					context.ActiveCampaign &&
					(context.ActiveCampaign.Id === identifier ||
						context.ActiveCampaign.RoomCode === identifier);

				if (!alreadyActive) {
					if (isDM) {
						// DM mode: payload must already exist in IndexedDB.
						if (!info) {
							setState({
								status: "error",
								errorMessage: `Campaign not found. ID: ${identifier}`,
							});
							return;
						}
						const loaded = await CampaignUtils.switchActive(
							identifier!,
							context
						);
						if (!loaded) {
							setState({
								status: "error",
								errorMessage: `Campaign payload missing in storage. ID: ${identifier}`,
							});
							return;
						}
					} else {
						// Player mode: campaign may not exist yet (haven't joined this
						// room before). If we have CampaignInfo for it, unpack from
						// IndexedDB; otherwise, we'll wait for the DM's first state
						// broadcast and ActionService will create the entry.
						if (info) {
							await CampaignUtils.switchActive(identifier!, context);
						} else if (context.ActiveCampaign) {
							// No info — but if some other campaign is currently
							// unpacked, pack it away before we wait for the DM.
							await CampaignUtils.packActive(context);
						}
					}
					// The reshape (active campaign + metadata refresh) persists on
					// its own: mutating the proxy re-renders consumers, and
					// ContextProvider's subscription flushes the change.
				}

				// Refresh info reference now that the active campaign has been
				// swapped in (packActive may have refreshed metadata too).
				info = CampaignUtils.findCampaignByIdentifier(identifier, context);

				// Set user role if not already set.
				if (isDM && context.User.Role !== "dm") {
					ContextService.setUserRole({ role: "dm" }, context);
				} else if (!isDM && context.User.Role !== "player") {
					ContextService.setUserRole({ role: "player" }, context);
				}

				if (isDM) {
					const activeCampaign = context.ActiveCampaign;
					const hasSelectedCharacter = activeCampaign
						? !!(
							context.User.SelectedCharacters[activeCampaign.Id] ||
							context.User.SelectedCharacters[activeCampaign.RoomCode]
						)
						: undefined;

					if (activeCampaign && hasSelectedCharacter) {
						UserUtils.clearSelectedCharacter(
							{ campaignId: activeCampaign.Id },
							context
						);
						UserUtils.clearSelectedCharacter(
							{ campaignId: activeCampaign.RoomCode },
							context
						);
					}
				}

				// =====================================================================
				// STEP 2: Join room
				// =====================================================================
				const activeCampaign = context.ActiveCampaign;
				const roomCode = isDM
					? activeCampaign?.RoomCode || identifier
					: identifier;
				campaignRoomCode = roomCode!;

				// Build joinRoom callbacks BEFORE constructing the room.
				// The handshake closure references `service` (declared above as
				// `let service`); by the time a peer actually connects and the
				// handshake fires, `service` will already have been assigned.
				const callbacks: RoomCallbacks = {
					onPeerHandshake: async (peerId, send, receive, isInitiator) => {
						// Symmetrical User exchange. `isInitiator` is set
						// deterministically by Trystero to avoid deadlocks: the
						// initiator sends first, the other side receives first.
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
						console.warn("[CampaignView] onJoinError:", details);
						if (!isSubscribed || isDM) return;
						// Trystero reports this per peer for handshake failures and
						// for SDP exchanges that fail to establish WebRTC. Quest-Net
						// does not currently reject admission or configure a room
						// password, so these are recoverable network-attempt failures.
						// Keep the original room alive so Trystero can continue its
						// own discovery, signaling, and ICE recovery.
						setState((cur) => {
							const isJoinInProgress =
								cur.status === "waiting-for-dm" ||
								(cur.status === "error" && !!cur.retryable);
							if (!isJoinInProgress) return cur;
							const message = details.error || "unknown";
							return {
								status: "error",
								retryable: true,
								errorMessage: `The last connection attempt failed (${message}). Trystero is still listening for the DM.`,
							};
						});
					},
				};

				// Trystero's documented passive mode gives the authoritative room
				// its intended star topology: the DM announces as the sole active
				// peer, while players listen for the DM and ignore other players.
				room = RoomService.join(roomCode!, {
					callbacks,
					passive: !isDM,
				});

				// =====================================================================
				// STEP 3: Create ActionService
				// =====================================================================
				service = new ActionService(context, room);
				setActionService(service);

				if (isDM) {
					openPoseRoom();
				} else {
					// Even when a cached campaign can render immediately, wait for a fresh
					// authoritative snapshot before joining the optional pose mesh.
					service.onFirstUpdate(handlePlayerStateReady);
					unsubscribeDmConnectionLost = service.onDmConnectionLost(() => {
						if (!isSubscribed) return;
						closePoseRoom();
						service?.onFirstUpdate(handlePlayerStateReady);
					});
				}

				// =====================================================================
				// STEP 4: Handle initial state for players without campaign
				// =====================================================================
				if (!isDM && !context.ActiveCampaign) {
					setState({ status: "waiting-for-dm" });

					// The first state snapshot from the DM flips us to "ready" through
					// handlePlayerStateReady above.
					// This is a *latching* recovery: it fires whenever the update
					// lands, including after the soft timeout below has already
					// dropped us to a retryable error. Previously the timeout and
					// success were raced once, so a state update arriving even a
					// moment after the deadline could never recover the view.
					// Soft, retryable deadline. On expiry we surface feedback only;
					// the original room stays mounted and the onFirstUpdate latch
					// promotes us to "ready" whenever the DM becomes reachable.
					joinTimeout = setTimeout(() => {
						if (!isSubscribed) return;
						setState((cur) =>
							cur.status === "waiting-for-dm"
								? {
										status: "error",
										retryable: true,
										errorMessage:
											"Still trying to reach the DM. Make sure the room code is correct and the DM is online — Trystero is continuing to listen.",
									}
								: cur
						);
					}, PLAYER_JOIN_TIMEOUT_MS);
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

			if (joinTimeout) {
				clearTimeout(joinTimeout);
				joinTimeout = null;
			}

			// service.cleanup() calls RoomService.leave() internally —
			// don't call it here too or Trystero's leave logic runs twice.
			unsubscribeDmConnectionLost?.();
			unsubscribeDmConnectionLost = null;
			closePoseRoom();

			if (service) {
				service.cleanup();
			}

			setActionService(null);
		};
		// eslint-disable-next-line
	}, [identifier, setActionService, navigate]);

	// =====================================================================
	// RENDER
	// =====================================================================

	if (state.status === "loading") {
		// `identifier` is a private GUID for the DM, so only pass it as a
		// shareable room code for players.
		return (
			<CampaignConnectionScreen
				phase="connecting"
				roomCode={isDMRoute ? undefined : identifier}
			/>
		);
	}

	if (state.status === "error") {
		// Retryable errors aren't dead ends: the original room remains active and
		// a first state update will promote us to "ready". Show an in-progress
		// affordance rather than a hard failure.
		if (state.retryable) {
			return (
				<CampaignConnectionScreen
					phase="retrying"
					roomCode={identifier}
					message={state.errorMessage}
				/>
			);
		}

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
		return <CampaignConnectionScreen phase="waiting" roomCode={identifier} />;
	}

	// State is 'ready' with a campaign
	const isDM = isGUID(identifier!);

	return isDM ? <DMView /> : <PlayerView />;
}
