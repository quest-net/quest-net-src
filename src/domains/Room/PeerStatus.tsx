// domains/Room/PeerStatus.tsx
import { useState, useRef, useEffect } from "react";
import { ConnectionStatus, PeerInfo } from "../../hooks/usePeerTracking";
import { useQuestContext } from "../Context/ContextProvider";
import { CampaignUtils } from "../Campaign/CampaignUtils";

interface PeerStatusProps {
	connectionStatus: ConnectionStatus;
	peers: PeerInfo[];
	selfPeer: PeerInfo;
	totalInRoom: number;
	/** True when the DM is reachable (always true for the DM themselves). */
	isDmConnected: boolean;
}

const STATUS_LABEL: Record<ConnectionStatus, string> = {
	online: "Searching",
	partial: "No host",
	connected: "Connected",
};

export function PeerStatus({
	connectionStatus,
	peers,
	selfPeer,
	totalInRoom,
	isDmConnected,
}: PeerStatusProps) {
	const [isOpen, setIsOpen] = useState(false);
	const context = useQuestContext();
	const windowRef = useRef<HTMLDivElement>(null);
	const badgeRef = useRef<HTMLButtonElement>(null);

	const campaign = CampaignUtils.getActiveCampaign(context);

	// A peer whose handshake User hasn't landed yet could still be the DM.
	const hasUnidentifiedPeers = peers.some((peer) => !peer.user);

	const sortedPeers = [...peers].sort((a, b) => {
		const rank = (peer: PeerInfo) => (peer.user?.Role === "dm" ? 0 : 1);
		return rank(a) - rank(b);
	});

	useEffect(() => {
		if (!isOpen) return;

		const handleClickOutside = (event: MouseEvent) => {
			if (
				windowRef.current &&
				badgeRef.current &&
				!windowRef.current.contains(event.target as Node) &&
				!badgeRef.current.contains(event.target as Node)
			) {
				setIsOpen(false);
			}
		};

		document.addEventListener("mousedown", handleClickOutside);
		return () => document.removeEventListener("mousedown", handleClickOutside);
	}, [isOpen]);

	// Green is reserved for "actually in the session" — peers without the DM
	// stay amber.
	const getBadgeColorClass = () => {
		return connectionStatus === "connected" ? "badge-success" : "badge-warning";
	};

	const getBadgeTitle = () => {
		if (connectionStatus === "connected") {
			return `Connected to the host — ${totalInRoom} in room`;
		}
		if (connectionStatus === "partial") {
			return hasUnidentifiedPeers
				? "Connected to peers — identifying the host"
				: "Not connected to the host — you're not in the session yet";
		}
		return "Searching for the room";
	};

	// Looks up the character name a peer has selected for this campaign.
	// Takes the PeerInfo directly rather than searching by peerId.
	const getCharacterName = (peer: PeerInfo): string | null => {
		// IMPORTANT: Always use RoomCode as the key — players receive sanitized
		// campaigns where Id has been replaced with RoomCode.
		const selectedCharId = peer.user?.SelectedCharacters[campaign.RoomCode];
		if (!selectedCharId) return null;
		const character = campaign.GameState.Characters.find(
			(c) => c.Id === selectedCharId
		);
		return character ? character.Name : null;
	};

	const renderPeerRow = (peer: PeerInfo, isSelf: boolean) => {
		const isHost = peer.user?.Role === "dm";
		const displayName = peer.user?.Name ?? (isSelf ? "You" : "Identifying peer");
		const characterName = getCharacterName(peer);

		return (
			<div
				key={peer.peerId}
				className="p-3 bg-base-200 rounded-lg"
			>
				<div className="flex justify-between items-start mb-2">
					<div className="flex-1 min-w-0">
						<div className="flex items-center gap-2">
							<p className="font-semibold truncate">{displayName}</p>
							{isSelf && (
								<span className="badge badge-xs badge-neutral shrink-0">You</span>
							)}
						</div>
						<p className="text-xs opacity-70 truncate font-mono">
							{peer.peerId}
						</p>
					</div>
					<div className="ml-2 text-right">
						{isSelf ? (
							<p className="text-xs opacity-70">—</p>
						) : peer.ping !== null ? (
							<>
								<p className="text-sm font-mono font-bold">
									{peer.ping}ms
								</p>
								<p className="text-xs opacity-70">ping</p>
							</>
						) : (
							<p className="text-xs opacity-70">measuring...</p>
						)}
					</div>
				</div>

				{/* Character / Role display */}
				<div className="mt-2 pt-2 border-t border-base-300">
					{!peer.user ? (
						<div className="flex items-center gap-2 opacity-70">
							<span className="icon-[mdi--account-question] w-4 h-4"></span>
							<span className="text-sm italic">Loading peer details</span>
						</div>
					) : isHost ? (
						<div className="flex items-center gap-2">
							<span className="icon-[mdi--shield-crown] w-4 h-4 opacity-70"></span>
							<span className="text-sm font-semibold">Host</span>
						</div>
					) : characterName ? (
						<div className="flex items-center gap-2">
							<span className="icon-[mdi--account] w-4 h-4 opacity-70"></span>
							<span className="text-sm">
								Playing as:{" "}
								<span className="font-semibold">{characterName}</span>
							</span>
						</div>
					) : (
						<div className="flex items-center gap-2 opacity-70">
							<span className="icon-[mdi--account-off] w-4 h-4"></span>
							<span className="text-sm italic">No character selected</span>
						</div>
					)}
				</div>
			</div>
		);
	};

	// aria-label carries the status text: colour and the tooltip are both
	// unavailable to screen readers.
	return (
		<div className="relative">
			<button
				ref={badgeRef}
				onClick={() => setIsOpen(!isOpen)}
				className={`badge badge-lg ${getBadgeColorClass()} gap-2 cursor-pointer transition-all hover:brightness-95`}
				aria-label={getBadgeTitle()}
				title={getBadgeTitle()}
			>
				{connectionStatus === "online" ? (
					<span className="icon-[eos-icons--compass] w-5 h-5"></span>
				) : connectionStatus === "partial" ? (
					<>
						{/* motion-safe: this pulse is indefinite, not transient. */}
						<span className="icon-[mdi--shield-crown-outline] w-4 h-4 motion-safe:animate-pulse"></span>
						{totalInRoom}
					</>
				) : (
					<>
						<span className="icon-[mdi--access-point-network] w-4 h-4"></span>
						{totalInRoom}
					</>
				)}
			</button>

			{isOpen && (
				<div
					ref={windowRef}
					className="absolute top-full left-0 mt-2 w-80 bg-base-100 border-2 border-base-300 rounded-lg shadow-xl z-50"
				>
					<div className="p-4">
						<div className="flex justify-between items-center mb-3">
							<h3 className="font-bold text-lg">People in Room</h3>
							<span className="text-sm opacity-70">
								{totalInRoom} {totalInRoom === 1 ? "person" : "people"}
							</span>
						</div>

						{!isDmConnected && (
							<div className="alert alert-warning mb-3 py-2 text-sm">
								<span className="icon-[mdi--shield-crown-outline] w-4 h-4 shrink-0"></span>
								<div>
									<p className="font-semibold">
										{hasUnidentifiedPeers
											? "Identifying the host"
											: "Not connected to the host"}
									</p>
									{/* Trystero owns discovery and recovery; this status never
									    triggers a room teardown or application retry. */}
									<p className="mt-1 opacity-80">
										{peers.length > 0
											? "You're connected to other players, but nothing you do reaches the game until the host connects. Trystero keeps trying in the background; if this persists, leave and rejoin the room."
											: "You're in the room but haven't reached anyone yet. Trystero is still listening for the host."}
									</p>
								</div>
							</div>
						)}

						{/* Capped so a full table doesn't push the footer off-screen. */}
						<div className="space-y-2 max-h-[50vh] overflow-y-auto pr-1">
							{/* Self first, then the host, then everyone else. */}
							{renderPeerRow(selfPeer, true)}
							{sortedPeers.map((peer) => renderPeerRow(peer, false))}
						</div>

						{/* Suppressed when the banner is up; it says this already. */}
						{peers.length === 0 && isDmConnected && (
							<p className="text-center text-sm opacity-70 mt-3">
								No other peers connected
							</p>
						)}

						<div className="mt-3 pt-3 border-t border-base-300">
							<div className="flex items-center gap-2 text-sm">
								<div
									className={`w-2 h-2 rounded-full ${
										connectionStatus === "connected"
											? "bg-success"
											: "bg-warning"
									}`}
								></div>
								<span className="opacity-70">
									Status:{" "}
									<span className="font-semibold">
										{STATUS_LABEL[connectionStatus]}
									</span>
								</span>
							</div>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
