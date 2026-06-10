// domains/Character/CharacterSelect.tsx

import { useState } from "react";
import {
	useQuestContext,
	triggerContextUpdate,
} from "../Context/ContextProvider";
import { PeerInfo } from "../../hooks/usePeerTracking";
import { CampaignActions } from "../Campaign/CampaignActions";
import { UserActions } from "../User/UserActions";
import { Character } from "./Character";
import { CharacterEdit } from "./Edit";
import { ImageDisplay } from "../Image/ImageDisplay";
import { EmptyState } from "../../components/ui/EmptyState";

interface CharacterSelectProps {
	peers: PeerInfo[];
}

export function CharacterSelect({ peers }: CharacterSelectProps) {
	const context = useQuestContext();
	const campaign = CampaignActions.getActiveCampaign(context);

	const [isDrawerOpen, setDrawerOpen] = useState(false);
	const [createCounter, setCreateCounter] = useState(0);

	// Collect all character IDs selected by peers for this campaign
	const selectedByPeers = new Set<string>();
	peers.forEach((peer) => {
		const selectedCharId = peer.user?.SelectedCharacters[campaign.RoomCode];
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
				campaignId: campaign.RoomCode,
				characterId: character.Id,
			},
			context
		);
		triggerContextUpdate();
	};

	const handleOpenCreate = () => {
		setCreateCounter((prev) => prev + 1);
		setDrawerOpen(true);
	};

	const handleCloseDrawer = () => {
		setDrawerOpen(false);
	};

	return (
		<div className="drawer">
			<input
				id="character-select-drawer"
				type="checkbox"
				className="drawer-toggle"
				checked={isDrawerOpen}
				onChange={(e) => setDrawerOpen(e.target.checked)}
			/>

			{/* Main Content */}
			<div className="drawer-content">
				<div className="max-w-6xl mx-auto">
					<div className="text-center mb-8">
						<h1 className="text-3xl font-bold mb-2">Select Your Character</h1>
						<p className="opacity-70">
							Choose a character to play in this campaign
						</p>
					</div>

					{/* Create Button - Always Visible */}
					<div className="flex justify-center mb-6">
						<button onClick={handleOpenCreate} className="btn btn-primary">
							<span className="icon-[mdi--plus] w-5 h-5 mr-1" />
							Create New Character
						</button>
					</div>

					{availableCharacters.length === 0 ? (
						<EmptyState icon="icon-[mdi--drama-masks]">
							<div className="text-base font-medium">No characters available</div>
							<div className="mt-1">
								All spawned characters are currently taken by other players.
								Create a new character to get started!
							</div>
						</EmptyState>
					) : (
						<div className="flex flex-wrap gap-4 justify-center">
							{availableCharacters.map((character) => (
								<div
									key={character.Id}
									onClick={() => handleSelectCharacter(character)}
									className="card bg-base-100 border-2 border-base-300 hover:border-primary transition-colors w-64 cursor-pointer"
								>
									<figure className="px-4 pt-4">
										<div className="w-full aspect-square bg-base-200 rounded-lg overflow-hidden flex items-center justify-center">
											{character.Image ? (
												<ImageDisplay
													imageId={character.Image}
													className="w-full h-full object-cover"
													style={{ overflowClipMargin: "unset" }}
													alt={character.Name}
												/>
											) : (
												<span className="icon-[mdi--account] w-24 h-24 opacity-70"></span>
											)}
										</div>
									</figure>
									<div className="card-body p-4">
										<h3 className="card-title text-center justify-center">
											{character.Name}
										</h3>
										<div className="min-h-10">
											{character.Description && (
												<p className="text-sm text-center line-clamp-2">
													{character.Description}
												</p>
											)}
										</div>
									</div>
								</div>
							))}

							{/* Ghost divs to align last row left */}
							{[...Array(10)].map((_, i) => (
								<div key={`ghost-${i}`} className="w-64" aria-hidden="true" />
							))}
						</div>
					)}
				</div>
			</div>

			{/* Drawer */}
			<div className="drawer-side z-50">
				<label
					htmlFor="character-select-drawer"
					aria-label="close sidebar"
					className="drawer-overlay"
					onClick={handleCloseDrawer}
				></label>
				<div className="bg-base-200 min-h-full w-full max-w-4xl p-6 overflow-y-auto">
					{isDrawerOpen && (
						<CharacterEdit
							key={`create-${createCounter}`}
							character={undefined}
							onClose={handleCloseDrawer}
						/>
					)}
				</div>
			</div>
		</div>
	);
}
