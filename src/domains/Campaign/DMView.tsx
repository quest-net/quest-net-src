// domains/Campaign/DMView.tsx

import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuestContext } from "../Context/ContextProvider";
import { CampaignActions } from "./CampaignActions";
import { CharacterIndex } from "../Character/Index";
import { CampaignSettingEdit } from "../CampaignSetting/Edit";
import { TerrainIndex } from "../Terrain/Index";
import { ImageIndex } from "../Image/Index";
import { Main } from "../Main/Main";
import { LogDisplay } from "../Log/LogDisplay";
import { PeerStatus } from "../Room/PeerStatus";
import { usePeerTracking } from "../../hooks/usePeerTracking";
import { ItemIndex } from "../Item/Index";

type TabView =
	| "main"
	| "characters"
	| "items"
	| "images"
	| "terrains"
	| "settings";

export function DMView() {
	const { identifier } = useParams<{ identifier: string }>();
	const context = useQuestContext();
	const navigate = useNavigate();
	const [activeTab, setActiveTab] = useState<TabView>("main");

	// Call usePeerTracking once at the view level
	const { peers, connectionStatus } = usePeerTracking();

	const campaign = CampaignActions.findCampaignByIdentifier(
		identifier!,
		context
	);

	if (!campaign) {
		return;
	}

	return (
		<div className="flex flex-col h-screen">
			{/* Header */}
			<header className="navbar border-b-2 px-6 justify-between">
				<div className="flex items-center gap-4">
					<button className="btn btn-primary h-8 p-2 font-mono" onClick={() => navigator.clipboard.writeText(campaign.RoomCode)}>
						{campaign.RoomCode}<span className="icon-[heroicons-solid--clipboard-copy] h-5 w-5"></span>
					</button>
					<PeerStatus connectionStatus={connectionStatus} peers={peers} />
				</div>
				<h1 className="text-xl font-bold">{campaign.Name}</h1>
				<button
					className="btn btn-neutral"
					onClick={() => navigate("/campaigns")}
				>
					Leave Campaign
				</button>
			</header>

			{/* Main Layout */}
			<div className="flex flex-1 overflow-hidden">
				{/* Sidebar */}
				<aside className="border-r-2">
					<ul className="menu menu-lg">
						<li>
							<button
								className={activeTab === "main" ? "active" : ""}
								onClick={() => setActiveTab("main")}
							>
								Main
							</button>
						</li>
						<li>
							<button
								className={activeTab === "characters" ? "active" : ""}
								onClick={() => setActiveTab("characters")}
							>
								Characters
							</button>
						</li>
						<li>
							<button
								className={activeTab === "items" ? "active" : ""}
								onClick={() => setActiveTab("items")}
							>
								Items
							</button>
						</li>
						<li>
							<button
								className={activeTab === "characters" ? "active" : ""}
								onClick={() => setActiveTab("characters")}
							>
								Skills
							</button>
						</li>
						<li>
							<button
								className={activeTab === "images" ? "active" : ""}
								onClick={() => setActiveTab("images")}
							>
								Images
							</button>
						</li>
						<li>
							<button
								className={activeTab === "terrains" ? "active" : ""}
								onClick={() => setActiveTab("terrains")}
							>
								Terrains
							</button>
						</li>
						<li>
							<button
								className={activeTab === "settings" ? "active" : ""}
								onClick={() => setActiveTab("settings")}
							>
								Settings
							</button>
						</li>
					</ul>
				</aside>

				{/* Main Content */}
				<main className="flex-1 overflow-auto">
					{activeTab === "main" && <Main />}
					{activeTab === "characters" && <CharacterIndex />}
					{activeTab === "items" && <ItemIndex />}
					{activeTab === "images" && <ImageIndex />}
					{activeTab === "terrains" && <TerrainIndex />}
					{activeTab === "settings" && <CampaignSettingEdit />}
				</main>
				{/* Log Display*/}
				<LogDisplay />
			</div>
		</div>
	);
}
