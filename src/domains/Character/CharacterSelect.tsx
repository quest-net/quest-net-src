// domains/Character/CharacterSelect.tsx

import {
	useQuestContext,
	triggerContextUpdate,
} from "../Context/ContextProvider";
import { PeerInfo } from "../../hooks/usePeerTracking";
import { CampaignActions } from "../Campaign/CampaignActions";
import { UserActions } from "../User/UserActions";
import { Character } from "./Character";

interface CharacterSelectProps {
	peers: PeerInfo[];
}

export function CharacterSelect({ peers }: CharacterSelectProps) {
	const context = useQuestContext();
	const campaign = CampaignActions.getActiveCampaign(context);

	// Collect all character IDs selected by peers for this campaign
	// IMPORTANT: Use RoomCode as the key since that's what all users use
	// (players receive sanitized campaigns where Id = RoomCode)
	const selectedByPeers = new Set<string>();
	peers.forEach((peer) => {
		const selectedCharId = peer.user.SelectedCharacters[campaign.RoomCode];
		if (selectedCharId) {
			selectedByPeers.add(selectedCharId);
		}
	});

	// Filter spawned characters to only show available ones
	const availableCharacters = campaign.GameState.Characters.filter(
		(char) => !selectedByPeers.has(char.Id)
	);

	const handleSelectCharacter = (character: Character) => {
		UserActions.selectCharacter(
			{
				campaignId: campaign.RoomCode, // Use RoomCode for consistency
				characterId: character.Id,
			},
			context
		);
		triggerContextUpdate();
	};

	return (
		<div className="max-w-6xl mx-auto">
			<div className="text-center mb-8">
				<h1 className="text-3xl font-bold mb-2">Select Your Character</h1>
				<p className="text-base-content/60">
					Choose a character to play in this campaign
				</p>
			</div>

			{availableCharacters.length === 0 ? (
				<div className="text-center py-12">
					<div className="text-6xl mb-4">🎭</div>
					<p className="text-xl mb-2">No characters available</p>
					<p className="text-base-content/60">
						All spawned characters are currently taken by other players, or no
						characters have been spawned yet.
					</p>
				</div>
			) : (
				<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
					{availableCharacters.map((character) => (
						<button
							key={character.Id}
							onClick={() => handleSelectCharacter(character)}
							className="card bg-base-100 border-2 border-base-300 hover:border-primary hover:shadow-lg transition-all cursor-pointer text-left"
						>
							<figure className="px-4 pt-4">
								{/* TODO: Image handling not implemented yet */}
								<div className="w-full h-32 bg-base-200 rounded-lg flex items-center justify-center">
									<span className="text-4xl">👤</span>
								</div>
							</figure>
							<div className="card-body">
								<h3 className="card-title justify-center">{character.Name}</h3>
								{character.Description && (
									<p className="text-sm text-base-content/60 line-clamp-2">
										{character.Description}
									</p>
								)}

								{/* Stats preview */}
								<div className="mt-2 space-y-1">
									{character.Stats.slice(0, 3).map((stat) => (
										<div key={stat.Id} className="flex items-center gap-2">
											<div
												className="w-3 h-3 rounded-full"
												style={{ backgroundColor: stat.Color }}
											/>
											<span className="text-xs">
												{stat.Name}: {stat.Current ?? stat.Max}/{stat.Max}
											</span>
										</div>
									))}
								</div>
							</div>
						</button>
					))}
				</div>
			)}
		</div>
	);
}
