// domains/Campaign/PlayerView.tsx - Updated

import { useNavigate } from "react-router-dom";
import {
	useQuestContext,
	triggerContextUpdate,
} from "../Context/ContextProvider";
import { UserActions } from "../User/UserActions";
import { LogAlerts } from "../Log/LogAlerts";
import { PeerStatus } from "../Room/PeerStatus";
import { CharacterSelect } from "../Character/CharacterSelect";
import { usePeerTracking } from "../../hooks/usePeerTracking";
import { Main } from "../Main/Main";
import { AudioPlayer } from "../Audio/AudioPlayer";
import { AudioStateProvider } from "../Audio/AudioContext";

export function PlayerView() {
	const context = useQuestContext();
	const navigate = useNavigate();

	// Single source of truth for peer data - call hook once at view level
	const { peers, connectionStatus } = usePeerTracking();

	// CampaignView guarantees ActiveCampaign matches the URL by the time we
	// render — read directly from there.
	const campaign = context.ActiveCampaign;

	if (!campaign) {
		return null;
	}

	// Check if user has selected a character for this campaign
	// Use RoomCode as the key for consistency (players use RoomCode in their sanitized campaigns)
	const selectedCharacterId =
		context.User.SelectedCharacters[campaign.RoomCode];
	const hasSelectedCharacter = !!selectedCharacterId;

	// Find the selected character to display info
	const selectedCharacter = hasSelectedCharacter
		? campaign.GameState.Characters.find((c) => c.Id === selectedCharacterId)
		: null;

	const handleChangeCharacter = () => {
		UserActions.selectCharacter(
			{
				campaignId: campaign.RoomCode, // Use RoomCode for consistency
				characterId: null,
			},
			context
		);
		triggerContextUpdate();
	};

	return (
		<AudioStateProvider>
			<div className="flex flex-col h-screen">
				<AudioPlayer />
				{/* Header - Always Visible */}
				<header className="navbar border-b-2 px-6 justify-between">
					<div className="flex items-center gap-4">
						<PeerStatus connectionStatus={connectionStatus} peers={peers} />
					</div>
					<h1 className="text-xl font-bold">{campaign.Name}</h1>
					<div className="flex items-center gap-2">
						{hasSelectedCharacter && (
							<button
								className="btn btn-neutral btn-sm"
								onClick={handleChangeCharacter}
								title="Change character"
							>
								<span className="icon-[mdi--account-switch] w-5 h-5" />
							</button>
						)}
						<button
							className="btn btn-neutral"
							onClick={() => navigate("/campaigns")}
						>
							Leave Campaign
						</button>
					</div>
				</header>

				{/* Main Content - Conditional */}
				{!hasSelectedCharacter ? (
					<main className="flex-1 overflow-auto p-6">
						<CharacterSelect peers={peers} />
					</main>
				) : selectedCharacter ? (
					<main className="flex-1 overflow-hidden">
						<Main />
					</main>
				) : (
					<main className="flex-1 overflow-auto p-6">
						<p className="text-center">Character not found</p>
					</main>
				)}

				{/* Log Alerts */}
				<LogAlerts />
			</div>
		</AudioStateProvider>
	);
}