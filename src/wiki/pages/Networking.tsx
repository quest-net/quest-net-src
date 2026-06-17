import {
	WikiCallout,
	WikiCardGrid,
	WikiCode,
	WikiDiagram,
	WikiDiagramNode,
	WikiFieldGrid,
	WikiFlow,
	WikiFlowStep,
	WikiHighlight,
	WikiPageLink,
} from "../components/content";
import type { WikiPage } from "./WikiPage";

export const networkingPage: WikiPage = {
	slug: "networking",
	title: "Networking",
	audience: "Developer",
	category: "Technical",
	summary: "How Quest-Net synchronizes campaign state between DM and players.",
	tags: ["trystero", "webrtc", "nostr", "sync", "actions"],
	icon: "icon-[mdi--access-point-network]",
	sections: [
		{
			id: "topology",
			title: "Room Topology",
			body: (
				<div className="space-y-4">
					<p>
						Quest-Net uses Trystero rooms with app ID{" "}
						<WikiCode>quest-net</WikiCode>. The transport is peer-to-peer after
						signaling, but the game model is not peer-authoritative. The{" "}
						<WikiHighlight tone="primary">DM</WikiHighlight> owns the canonical
						campaign state, and players send requests into that authority model.
					</p>
					<WikiDiagram title="Connection shape">
						<div className="grid items-stretch gap-3 md:grid-cols-[1fr_auto_1fr_auto_1fr]">
							<WikiDiagramNode title="DM route" tone="primary">
								Private URL uses the campaign GUID. The DM still joins the public
								room with <WikiCode>Campaign.RoomCode</WikiCode>.
							</WikiDiagramNode>
							<div className="flex items-center justify-center font-mono text-2xl font-black opacity-70">
								-&gt;
							</div>
							<WikiDiagramNode title="Trystero room" tone="accent">
								Peers meet through Nostr signaling, then communicate through
								Trystero actions.
							</WikiDiagramNode>
							<div className="flex items-center justify-center font-mono text-2xl font-black opacity-70">
								&lt;-
							</div>
							<WikiDiagramNode title="Player route" tone="secondary">
								Public URL uses the room code. Player campaign metadata is keyed
								by that code, not the private DM GUID.
							</WikiDiagramNode>
						</div>
					</WikiDiagram>
					<WikiCallout tone="info" title="Related structure">
						<p>
							The identity split between <WikiCode>Campaign.Id</WikiCode> and{" "}
							<WikiCode>Campaign.RoomCode</WikiCode> is covered in{" "}
							<WikiPageLink slug="data-structures">Data Structures</WikiPageLink>.
							Networking depends on that split because player-facing state is
							sanitized before it leaves the DM.
						</p>
					</WikiCallout>
				</div>
			),
		},
		{
			id: "joining",
			title: "Join Lifecycle",
			body: (
				<div className="space-y-4">
					<p>
						<WikiCode>CampaignView</WikiCode> owns the room lifecycle. Before it
						joins the room, it packs or unpacks the right campaign, assigns the
						local role, builds Trystero join callbacks, and then creates a fresh{" "}
						<WikiCode>ActionService</WikiCode>.
					</p>
					<WikiFlow>
						<WikiFlowStep number="1" title="Resolve route identity" tone="primary">
							A GUID route is treated as the DM path. A non-GUID identifier is
							treated as a player room code.
						</WikiFlowStep>
						<WikiFlowStep number="2" title="Pack or unpack campaign" tone="secondary">
							The DM loads the campaign payload from IndexedDB. A player may wait
							with no local campaign until the first DM state broadcast arrives.
						</WikiFlowStep>
						<WikiFlowStep number="3" title="Exchange User payloads" tone="accent">
							<WikiCode>onPeerHandshake</WikiCode> performs a symmetrical user
							exchange before peer metadata is visible through normal room APIs.
						</WikiFlowStep>
						<WikiFlowStep number="4" title="Install service channels" tone="success">
							<WikiCode>ActionService</WikiCode>, <WikiCode>StateSync</WikiCode>,{" "}
							<WikiCode>ImageService</WikiCode>, and{" "}
							<WikiCode>ActorPoseService</WikiCode> register their Trystero
							actions.
						</WikiFlowStep>
						<WikiFlowStep number="5" title="Wait for first state when needed" tone="warning">
							A new player waits up to 15 seconds for the DM's first campaign
							broadcast before showing a connection error.
						</WikiFlowStep>
					</WikiFlow>
				</div>
			),
		},
		{
			id: "channels",
			title: "Channel Map",
			body: (
				<div className="space-y-4">
					<p>
						Trystero actions are short named channels. Quest-Net keeps campaign
						mutations, state updates, image transfer, user metadata, and live pose
						traffic separated so each path can use the right validation and
						payload shape.
					</p>
					<WikiFieldGrid
						items={[
							{
								name: "actionReq",
								tone: "primary",
								detail:
									"Player to DM. Carries actionKey, params, and playerId for permission-checked mutations.",
							},
							{
								name: "stateSync",
								tone: "secondary",
								detail:
									"DM to players. Carries full campaign snapshots or fast-json-patch deltas.",
							},
							{
								name: "imgFetch",
								tone: "success",
								detail:
									"Request action: a player asks the DM for an imageId; the DM responds with the ArrayBuffer. Trystero handles correlation, timeout, and binary chunking.",
							},
							{
								name: "imgUpload",
								tone: "warning",
								detail:
									"Request action: a player sends compressed bytes plus metadata; the DM stores them and responds with the created Image record.",
							},
							{
								name: "terrainFetch",
								tone: "success",
								detail:
									"Request action: a player asks the DM for a terrainId; the DM responds with the voxel payload served from IndexedDB.",
							},
							{
								name: "actorPose",
								tone: "accent",
								detail:
									"Ephemeral live token pose packets for smooth drag previews before authoritative movement lands.",
							},
							{
								name: "userUpdate / userReq",
								tone: "info",
								detail:
									"Runtime user metadata repair. Used for selected character changes and missing peer details.",
							},
						]}
					/>
					<WikiCallout tone="warning" title="Channel naming">
						<p>
							Trystero action names are constrained by byte length. Keep new
							channel names short and stable; domain action keys can be descriptive
							because they travel inside <WikiCode>actionReq</WikiCode> payloads.
						</p>
					</WikiCallout>
				</div>
			),
		},
		{
			id: "action-requests",
			title: "Action Requests",
			body: (
				<div className="space-y-4">
					<p>
						UI code should call <WikiCode>ActionService.execute</WikiCode> instead
						of mutating campaign state directly. The service chooses the DM path or
						player path based on the local user role.
					</p>
					<WikiDiagram title="Player mutation path">
						<div className="grid gap-3 lg:grid-cols-[1fr_auto_1fr_auto_1fr]">
							<WikiDiagramNode title="Player UI" tone="secondary">
								Runs the action optimistically with{" "}
								<WikiCode>Context.IsOptimistic</WikiCode> set.
							</WikiDiagramNode>
							<div className="flex items-center justify-center font-mono text-2xl font-black opacity-70">
								-&gt;
							</div>
							<WikiDiagramNode title="DM handler" tone="primary">
								Receives <WikiCode>actionReq</WikiCode>, impersonates the
								requesting player, and runs domain validation.
							</WikiDiagramNode>
							<div className="flex items-center justify-center font-mono text-2xl font-black opacity-70">
								-&gt;
							</div>
							<WikiDiagramNode title="Authoritative sync" tone="success">
								Broadcasts the accepted campaign state, which replaces or corrects
								the player's optimistic copy.
							</WikiDiagramNode>
						</div>
					</WikiDiagram>
					<WikiCallout tone="error" title="Secret mode">
						<p>
							When <WikiCode>Context.SecretModes[campaign.Id]</WikiCode> is active,
							the DM suppresses state broadcasts and drops incoming player
							requests. Turning secret mode off should be paired with a full sync
							so players reconcile to the DM's prep state.
						</p>
					</WikiCallout>
				</div>
			),
		},
		{
			id: "state-sync",
			title: "State Sync",
			body: (
				<div className="space-y-4">
					<p>
						<WikiCode>StateSync</WikiCode> sends sanitized campaign state from the
						DM to players. It prefers delta patches after an initial full snapshot,
						but it can request or force full snapshots when baselines drift.
					</p>
					<WikiFlow>
						<WikiFlowStep number="1" title="Sanitize for players" tone="primary">
							The DM clones the campaign, replaces <WikiCode>Campaign.Id</WikiCode>{" "}
							with <WikiCode>RoomCode</WikiCode>, and rewrites terrain storage keys
							to use the public identifier.
						</WikiFlowStep>
						<WikiFlowStep number="2" title="Choose full or delta" tone="secondary">
							The first update is full. Later updates compare the last broadcast
							baseline with the new campaign using <WikiCode>fast-json-patch</WikiCode>.
						</WikiFlowStep>
						<WikiFlowStep number="3" title="Compress when useful" tone="accent">
							Full updates are gzip-compressed when browser compression streams are
							available. Delta updates compress after 64 patches.
						</WikiFlowStep>
						<WikiFlowStep number="4" title="Apply by version" tone="success">
							Players apply deltas only when <WikiCode>baseVersion</WikiCode>{" "}
							matches their local version. A mismatch logs{" "}
							<WikiCode>/REQUEST_FULL_SYNC</WikiCode> back to the DM.
						</WikiFlowStep>
					</WikiFlow>
					<WikiCallout tone="info" title="Player apply path">
						<p>
							Incoming campaign state is cloned before being put into React state.
							The player path hydrates the active terrain, rebuilds{" "}
							<WikiCode>CampaignInfo</WikiCode>, assigns{" "}
							<WikiCode>Context.ActiveCampaign</WikiCode>, and clears live actor
							pose overlays.
						</p>
					</WikiCallout>
				</div>
			),
		},
		{
			id: "side-channels",
			title: "Side Channels",
			body: (
				<div className="space-y-4">
					<p>
						Not every network payload belongs in campaign JSON. Large binary data
						and short-lived interaction previews move through specialized services.
					</p>
					<WikiCardGrid
						items={[
							{
								title: "Images",
								tone: "success",
								body: (
									<>
										Image metadata lives in the campaign, but binary image blobs
										live in IndexedDB. Players fetch missing blobs from the DM
										with the <WikiCode>imgFetch</WikiCode> request action.
									</>
								),
							},
							{
								title: "Uploads",
								tone: "warning",
								body: (
									<>
										Player uploads are compressed before transfer and must stay
										under 1 MB. The <WikiCode>imgUpload</WikiCode> request resolves
										with the created Image record once the DM stores the blob.
									</>
								),
							},
							{
								title: "Actor poses",
								tone: "accent",
								body: (
									<>
										<WikiCode>actorPose</WikiCode> packets last about 800 ms and
										are validated against terrain, actor existence, and peer
										control permissions.
									</>
								),
							},
						]}
					/>
				</div>
			),
		},
		{
			id: "presence-recovery",
			title: "Presence And Recovery",
			body: (
				<div className="space-y-4">
					<p>
						Peer presence combines Trystero transport presence with Quest-Net user
						metadata. <WikiCode>ActionService</WikiCode> tracks connected peer IDs,
						user payloads, and periodic ping results for UI display.
					</p>
					<WikiFieldGrid
						items={[
							{
								name: "Handshake",
								tone: "primary",
								detail:
									"Initial User payload exchange happens before the peer is visible to getPeers or action receivers.",
							},
							{
								name: "Runtime metadata",
								tone: "info",
								detail:
									"userUpdate rebroadcasts local User changes; userReq repairs missing metadata for peers that connected before details arrived.",
							},
							{
								name: "Auto reconnect",
								tone: "warning",
								detail:
									"useAutoReconnect recycles the room after peer loss, browser sleep drift, focus, online, or pageshow recovery signals.",
							},
							{
								name: "Relay watchdog",
								tone: "error",
								detail:
									"DM-only. Forces a leave + rejoin when a Nostr relay socket closes, rebuilding subscriptions so new players can still discover the DM after relay churn.",
							},
							{
								name: "Phantom eviction",
								tone: "info",
								detail:
									"Repeated ping failures force-close a peer's RTCPeerConnection so Trystero reaps a silently-dead peer that never fired a close event.",
							},
						]}
					/>
					<WikiCallout tone="warning" title="Important distinction">
						<p>
							Existing WebRTC peer connections keep working after relay signaling
							degrades — they are fully peer-to-peer after ICE negotiation. The
							relay watchdog exists because new joiners still need the DM's relay
							subscription alive, and Trystero only auto-recovers a relay socket
							that actually fires a close event.
						</p>
					</WikiCallout>
				</div>
			),
		},
		{
			id: "developer-checklist",
			title: "Developer Checklist",
			body: (
				<div className="space-y-4">
					<p>
						Use this checklist when adding or changing networked behavior.
					</p>
					<WikiFieldGrid
						columns={1}
						items={[
							{
								name: "Prefer domain actions for campaign mutations",
								tone: "primary",
								detail:
									"Register the handler in ACTION_REGISTRY so permissions, optimistic updates, DM validation, and sync all share the same path.",
							},
							{
								name: "Do not leak private campaign IDs",
								tone: "error",
								detail:
									"Anything sent to players must preserve the RoomCode sanitization model used by StateSync.",
							},
							{
								name: "Keep large or binary payloads out of campaign sync",
								tone: "success",
								detail:
									"Use IndexedDB-backed side channels for image bytes and terrain voxel payloads instead of embedding them in frequent JSON updates.",
							},
							{
								name: "Make optimistic behavior reversible",
								tone: "warning",
								detail:
									"Players can predict locally, but the next DM broadcast must be able to correct the local copy without special-case cleanup.",
							},
						]}
					/>
				</div>
			),
		},
	],
	searchText:
		"networking trystero webrtc nostr state sync delta patch full state action request user metadata relay room code dm authority actionReq stateSync imgFetch imgUpload terrainFetch actorPose userUpdate userReq request response compression version mismatch optimistic secret mode handshake reconnect",
};

export default networkingPage;
