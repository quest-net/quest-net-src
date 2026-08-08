// domains/Room/PeerStatus.tsx
import { useState, useRef, useEffect } from "react";
import { PeerInfo, usePeerTracking } from "../../hooks/usePeerTracking";
import { useQuestContext } from "../Context/ContextProvider";
import { CampaignUtils } from "../Campaign/CampaignUtils";

/**
 * Room presence badge. Players join passively, so their mesh is a single edge
 * to the DM — there's nothing to list and no headcount worth showing, just
 * "connected or not". The DM is the only peer that sees everyone, so the peer
 * panel is theirs alone.
 */
export function PeerStatus() {
	const [isOpen, setIsOpen] = useState(false);
	const context = useQuestContext();
	const { peers, isDmConnected } = usePeerTracking();
	const windowRef = useRef<HTMLDivElement>(null);
	const badgeRef = useRef<HTMLButtonElement>(null);

	const campaign = CampaignUtils.getActiveCampaign(context);

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

	if (context.User.Role !== "dm") {
		return isDmConnected ? (
			<span className="badge badge-lg badge-success gap-2">
				<span className="icon-[mdi--access-point-network] w-4 h-4"></span>
				Connected
			</span>
		) : (
			<span className="badge badge-lg badge-warning gap-2">
				{/* motion-safe: this pulse is indefinite, not transient. */}
				<span className="icon-[eos-icons--compass] w-4 h-4 motion-safe:animate-pulse"></span>
				Searching for host
			</span>
		);
	}

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

	const renderPeerRow = (peer: PeerInfo) => {
		const characterName = getCharacterName(peer);

		return (
			<div key={peer.peerId} className="p-3 bg-base-200 rounded-lg">
				<div className="flex justify-between items-start mb-2">
					<div className="flex-1 min-w-0">
						<p className="font-semibold truncate">
							{peer.user?.Name ?? "Identifying peer"}
						</p>
						<p className="text-xs opacity-70 truncate font-mono">{peer.peerId}</p>
					</div>
					<div className="ml-2 text-right">
						{peer.ping !== null ? (
							<>
								<p className="text-sm font-mono font-bold">{peer.ping}ms</p>
								<p className="text-xs opacity-70">ping</p>
							</>
						) : (
							<p className="text-xs opacity-70">measuring...</p>
						)}
					</div>
				</div>

				<div className="mt-2 pt-2 border-t border-base-300">
					{!peer.user ? (
						<div className="flex items-center gap-2 opacity-70">
							<span className="icon-[mdi--account-question] w-4 h-4"></span>
							<span className="text-sm italic">Loading peer details</span>
						</div>
					) : characterName ? (
						<div className="flex items-center gap-2">
							<span className="icon-[mdi--account] w-4 h-4 opacity-70"></span>
							<span className="text-sm">
								Playing as: <span className="font-semibold">{characterName}</span>
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

	const playerCount = `${peers.length} ${peers.length === 1 ? "player" : "players"}`;

	return (
		<div className="relative">
			<button
				ref={badgeRef}
				onClick={() => setIsOpen(!isOpen)}
				className="badge badge-lg badge-success gap-2 cursor-pointer transition-all hover:brightness-95"
				// aria-label carries the count: the bare number has no meaning to a
				// screen reader.
				aria-label={`${playerCount} connected`}
				title={`${playerCount} connected`}
			>
				<span className="icon-[mdi--access-point-network] w-4 h-4"></span>
				{peers.length}
			</button>

			{isOpen && (
				<div
					ref={windowRef}
					className="absolute top-full left-0 mt-2 w-80 bg-base-100 border-2 border-base-300 rounded-lg shadow-xl z-50"
				>
					<div className="p-4">
						<div className="flex justify-between items-center mb-3">
							<h3 className="font-bold text-lg">Players</h3>
							<span className="text-sm opacity-70">{playerCount}</span>
						</div>

						{/* Capped so a full table doesn't push the footer off-screen. */}
						<div className="space-y-2 max-h-[50vh] overflow-y-auto pr-1">
							{peers.map((peer) => renderPeerRow(peer))}
						</div>

						{peers.length === 0 && (
							<p className="text-center text-sm opacity-70">
								No players connected
							</p>
						)}
					</div>
				</div>
			)}
		</div>
	);
}
