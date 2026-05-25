// domains/Campaign/DMView.tsx

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuestContext } from "../Context/ContextProvider";
import { ImpersonationPicker } from "../../components/inputs/ImpersonationPicker";
import { SecretModeToggle } from "../../components/inputs/SecretModeToggle";
import { CharacterIndex } from "../Character/Index";
import { CampaignSettingEdit } from "../CampaignSetting/Edit";
import { TerrainIndex } from "../Terrain/Index";
import { ImageIndex } from "../Image/Index";
import { Main } from "../Main/Main";
import { LogAlerts } from "../Log/LogAlerts";
import { PeerStatus } from "../Room/PeerStatus";
import { usePeerTracking } from "../../hooks/usePeerTracking";
import { AppSettingsDisplay } from "../AppSetting/AppSettingsDisplay";
import { ItemIndex } from "../Item/Index";
import { AudioIndex } from "../Audio/Index";
import { AudioPlayer } from "../Audio/AudioPlayer";
import { SkillIndex } from "../Skill/Index";
import { AudioStateProvider } from "../Audio/AudioContext";
import { EntityIndex } from "../Entity/Index";
import { StatusIndex } from "../Status/Index";
import { ScenarioIndex } from "../Scenario/Index";

type TabView =
	| "main"
	| "characters"
	| "entities"
	| "items"
	| "skills"
	| "statuses"
	| "images"
	| "audios"
	| "terrains"
	| "scenarios"
	| "settings";

const menuItems: { id: TabView; label: string; icon: string }[] = [
	{ id: "main", label: "Main", icon: "icon-[mdi--view-dashboard]" },
	{ id: "characters", label: "Characters", icon: "icon-[mdi--account-group]" },
	{ id: "entities", label: "Entities", icon: "icon-[mdi--robot]" },
	{ id: "items", label: "Items", icon: "icon-[mdi--treasure-chest]" },
	{ id: "skills", label: "Skills", icon: "icon-[mdi--lightning-bolt]" },
	{ id: "statuses", label: "Statuses", icon: "icon-[mdi--heart-pulse]" },
	{ id: "images", label: "Images", icon: "icon-[mdi--image-multiple]" },
	{ id: "audios", label: "Audios", icon: "icon-[mdi--music]" },
	{ id: "terrains", label: "Terrains", icon: "icon-[mdi--terrain]" },
	{ id: "scenarios", label: "Scenarios", icon: "icon-[mdi--map-marker-multiple]" },
	{ id: "settings", label: "Settings", icon: "icon-[mdi--cog]" },
];

export function DMView() {
	const context = useQuestContext();
	const navigate = useNavigate();
	const [activeTab, setActiveTab] = useState<TabView>("main");

	// Call usePeerTracking once at the view level
	const { peers, selfPeer, totalInRoom, connectionStatus } = usePeerTracking();

	// CampaignView guarantees ActiveCampaign matches the URL by the time we
	// render — so we read directly from there rather than re-resolving by
	// identifier.
	const campaign = context.ActiveCampaign;

	if (!campaign) {
		return null;
	}

	return (
		<AudioStateProvider>
			<div className="flex flex-col h-screen">
				<AudioPlayer />
				{/* Header */}
				<header className="navbar border-b-2 px-6 justify-between">
					<div className="flex items-center gap-4">
						<button
							className="btn btn-primary h-8 p-2 font-mono"
							onClick={() => navigator.clipboard.writeText(campaign.RoomCode)}
						>
							{campaign.RoomCode}
							<span className="icon-[heroicons-solid--clipboard-copy] h-5 w-5"></span>
						</button>
						<PeerStatus connectionStatus={connectionStatus} peers={peers} selfPeer={selfPeer} totalInRoom={totalInRoom} />
						<AppSettingsDisplay />
					</div>
					<h1 className="text-xl font-bold">{campaign.Name}</h1>
					<div className="flex items-center gap-2">
						<SecretModeToggle />
						<ImpersonationPicker />
						<button
							className="btn btn-neutral"
							onClick={() => navigate("/campaigns")}
						>
							Leave Campaign
						</button>
					</div>
				</header>

				{/* Main Layout */}
				<div className="flex flex-1 overflow-hidden">
					{/* Sidebar - Icon only with tooltips */}
					<aside className="border-r-2 bg-base-200">
						<ul className="menu gap-1 p-1">
							{menuItems.map((item) => (
								<li key={item.id}>
									<button
										className={`tooltip tooltip-right z-50 ${
											activeTab === item.id ? "menu-active" : ""
										}`}
										data-tip={item.label}
										onClick={() => setActiveTab(item.id)}
									>
										<span className={`${item.icon} w-6 h-8`} />
									</button>
								</li>
							))}
						</ul>
					</aside>

					{/* Main Content */}
					<main className="flex-1 overflow-auto">
						{activeTab === "main" && <Main />}
						{activeTab === "characters" && <CharacterIndex />}
						{activeTab === "entities" && <EntityIndex />}
						{activeTab === "items" && <ItemIndex />}
						{activeTab === "skills" && <SkillIndex />}
						{activeTab === "statuses" && <StatusIndex />}
						{activeTab === "images" && <ImageIndex />}
						{activeTab === "audios" && <AudioIndex />}
						{activeTab === "terrains" && <TerrainIndex />}
						{activeTab === "scenarios" && <ScenarioIndex />}
						{activeTab === "settings" && <CampaignSettingEdit />}
					</main>
				</div>
				{/* Log Alerts */}
				<LogAlerts />
			</div>
		</AudioStateProvider>
	);
}
