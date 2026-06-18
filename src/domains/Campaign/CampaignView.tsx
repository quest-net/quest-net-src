// domains/Campaign/CampaignView.tsx

import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { contextStore } from "../Context/contextStore";
import { useActionService } from "../../services/Actions/ActionServiceProvider";
import { useAutoReconnect } from "../../hooks/useAutoReconnect";
import { useRelayWatchdog } from "../../hooks/useRelayWatchdog";
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
	// rather than a hard failure (bad room code, missing payload, etc.).
	// useAutoReconnect stays enabled for it so the room keeps recycling, and a
	// late first state update still flips us to "ready" (see onFirstUpdate).
	retryable?: boolean;
}

// Player join tuning. This deadline must exceed Trystero's ICE-gathering
// ceiling (15s in @trystero-p2p/core peer.mjs) so a healthy-but-slow first
// connection isn't killed mid-handshake. It is a *soft* deadline: when it
// fires we drop to a retryable error, useAutoReconnect keeps recycling the
// room, and a late first state update recovers us to "ready". The DM's own
// recovery cadences (30s peerless reconnect, up to 60s relay backoff) are all
// longer than any single attempt, so retrying — not a longer one-shot wait —
// is what actually gets a player in.
const PLAYER_JOIN_TIMEOUT_MS = 20000;

export function CampaignView() {
	const { identifier } = useParams<{ identifier: string }>();
	const navigate = useNavigate();
	// Writable proxy: this view mutates context (pack/unpack, role, selected
	// character) and hands the same proxy to ActionService as the single source
	// of truth. Reads happen in effects/callbacks, not render, so no snapshot
	// is needed here.
	const context = contextStore;
	const { setActionService } = useActionService();
	const [reconnectTrigger, setReconnectTrigger] = useState(0);
	const isDMRoute = !!identifier && isGUID(identifier);
	// True when the effect cleanup below should leave the ActionService in
	// place rather than nullifying it. Set by onReconnect before bumping
	// reconnectTrigger so the cleanup that follows sees it. The next effect
	// body installs the new ActionService directly, which lets the stable
	// proxy in ActionServiceProvider avoid the null<->proxy flicker that used
	// to fire actionService-dep effects (ImageDisplay, slot displays, etc.)
	// once per relay watchdog cycle.
	const isReconnectingRef = useRef(false);

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

	const onReconnect = () => {
		// Set BEFORE incrementing so the about-to-fire cleanup observes it.
		isReconnectingRef.current = true;
		setReconnectTrigger((prev) => prev + 1);
	};

	useAutoReconnect(
		{
			// Reconnect not just when connected ("ready"), but also while a
			// player is still waiting for the DM and after a *retryable* join
			// timeout. Previously this was gated on "ready" alone, which meant
			// a first-time joiner's connection machinery was switched off during
			// exactly the window it was needed: a single ~15s shot, then a
			// dead-end error with no retry. Now the room keeps recycling (the
			// player's peerless cadence) until the DM becomes reachable.
			enabled:
				state.status === "ready" ||
				state.status === "waiting-for-dm" ||
				(state.status === "error" && !!state.retryable),
			// Trystero 0.22+ pauses relay reconnects when the browser is offline
			// and resumes when it comes back, so the previous 5s/3s tuning was
			// over-aggressive. Loosen to give the library time to recover before
			// we leave-and-rejoin the room ourselves.
			checkIntervalMs: 10000,
			reconnectDelayMs: 8000,
			peerlessReconnectDelayMs: isDMRoute ? 30000 : 20000,
			// maxAttempts is Infinity by default - unlimited retries!
		},
		onReconnect
	);

	// DM-only relay watchdog. Trystero 0.25.1 auto-resubscribes when a relay
	// socket actually closes, but it has no liveness check for silently-dead
	// sockets, and useAutoReconnect only fires at 0 peers — so a DM with
	// players can quietly become unreachable to NEW joiners with no error.
	// This forces a full leave()+joinRoom() recovery on relay socket close,
	// which empirically keeps a long-lived DM room reliably joinable. See
	// useRelayWatchdog.ts.
	useRelayWatchdog(isDMRoute && state.status === "ready", onReconnect);

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
		let service: ActionService | null = null;
		let isSubscribed = true; // For handling async state updates after unmount
		let joinTimeout: ReturnType<typeof setTimeout> | null = null;

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
						console.error("[CampaignView] onJoinError:", details);
						if (!isSubscribed) return;
						// Only convert to a hard error while we're still waiting
						// for the DM to admit us. After we're "ready", peer-level
						// join failures are transient and useAutoReconnect handles
						// them.
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

				room = RoomService.join(roomCode!, callbacks);

				// =====================================================================
				// STEP 3: Create ActionService
				// =====================================================================
				service = new ActionService(context, room);
				setActionService(service);

				// =====================================================================
				// STEP 4: Handle initial state for players without campaign
				// =====================================================================
				if (!isDM && !context.ActiveCampaign) {
					setState({ status: "waiting-for-dm" });

					// The first state broadcast from the DM flips us to "ready".
					// This is a *latching* recovery: it fires whenever the update
					// lands, including after the soft timeout below has already
					// dropped us to a retryable error. Previously the timeout and
					// success were raced once, so a state update arriving even a
					// moment after the deadline could never recover the view.
					service?.onFirstUpdate(() => {
						if (isSubscribed) {
							setState({ status: "ready" });
						}
					});

					// Soft, retryable deadline. On expiry we surface feedback but
					// stay recoverable: useAutoReconnect keeps recycling the room
					// (it's enabled for the retryable-error state above) and the
					// onFirstUpdate latch above promotes us to "ready" the instant
					// the DM is reachable.
					joinTimeout = setTimeout(() => {
						if (!isSubscribed) return;
						setState((cur) =>
							cur.status === "waiting-for-dm"
								? {
										status: "error",
										retryable: true,
										errorMessage:
											"Still trying to reach the DM. Make sure the room code is correct and the DM is online — we'll keep retrying automatically.",
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
			if (service) {
				service.cleanup();
			}

			// On reconnects, leave the proxy's underlying ref intact — the
			// next effect body will install the new ActionService directly,
			// so no actionService-dep effect needs to wake up. On true
			// teardown (campaign switch / unmount), nullify so downstream
			// consumers see the disconnect.
			if (isReconnectingRef.current) {
				isReconnectingRef.current = false;
			} else {
				setActionService(null);
			}
		};
		// eslint-disable-next-line
	}, [identifier, setActionService, navigate, reconnectTrigger]);

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
		// Retryable errors aren't dead ends: the room keeps recycling in the
		// background and a first state update will promote us to "ready". Show
		// a "still trying" affordance rather than a hard failure.
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
