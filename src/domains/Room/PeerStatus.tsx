// domains/Room/PeerStatus.tsx
import { useState, useRef, useEffect } from "react";
import { PeerInfo } from "../../hooks/usePeerTracking";
import { useQuestContext } from "../Context/ContextProvider";
import { CampaignActions } from "../Campaign/CampaignActions";

interface PeerStatusProps {
	connectionStatus: "online" | "connected";
	peers: PeerInfo[];
	selfPeer: PeerInfo;
	totalInRoom: number;
}

export function PeerStatus({ connectionStatus, peers, selfPeer, totalInRoom }: PeerStatusProps) {
	const [isOpen, setIsOpen] = useState(false);
	const context = useQuestContext();
	const windowRef = useRef<HTMLDivElement>(null);
	const badgeRef = useRef<HTMLButtonElement>(null);

	const campaign = CampaignActions.getActiveCampaign(context);

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

	const getBadgeColorClass = () => {
		return connectionStatus === "online" ? "badge-warning" : "badge-success";
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

	return (
		<div className="relative">
			<button
				ref={badgeRef}
				onClick={() => setIsOpen(!isOpen)}
				className={`badge badge-lg ${getBadgeColorClass()} gap-2 cursor-pointer transition-all hover:brightness-95`}
				aria-label="Peer connection status"
			>
				{connectionStatus === "online" ? (
					<span className="icon-[eos-icons--compass] w-5 h-5"></span>
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

						<div className="space-y-2">
							{/* Local user always shown first */}
							{renderPeerRow(selfPeer, true)}
							{peers.map((peer) => renderPeerRow(peer, false))}
						</div>

						{peers.length === 0 && (
							<p className="text-center text-sm opacity-70 mt-3">
								No other peers connected
							</p>
						)}

						<div className="mt-3 pt-3 border-t border-base-300">
							<div className="flex items-center gap-2 text-sm">
								<div
									className={`w-2 h-2 rounded-full ${
										connectionStatus === "online" ? "bg-warning" : "bg-success"
									}`}
								></div>
								<span className="opacity-70">
									Status:{" "}
									<span className="font-semibold capitalize">
										{connectionStatus}
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
