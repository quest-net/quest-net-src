// domains/Main/Main.tsx

import { useQuestContext } from "../Context/ContextProvider";
import { CampaignActions } from "../Campaign/CampaignActions";
import Map from "../../components/Map/Map";
import { useState } from "react";
import { MapStateProvider } from "../../components/Map/MapStateProvider";
import { Inspector } from "./Inspector";
import CalendarDisplay from "../Calendar/CalendarDisplay";
import TerrainDisplay from "../Terrain/TerrainDisplay";
import { AudioDisplay } from "../Audio/AudioDisplay";
import { SceneDisplay } from "../Scene/SceneDisplay";
import { isDmAccess } from "../../utils/UrlParser";
import { SceneEdit } from "../Scene/Edit";
import { DiceRoller } from "../../components/Dice/DiceRoller";

type TopTab = "music" | "calendar" | "terrain";
type PlayerBottomTab =
	| "character"
	| "inventory"
	| "skills"
	| "party"
	| "inspector";
type DMBottomTab = "inspector" | "scene";

export function Main() {
	const context = useQuestContext();
	const campaign = CampaignActions.getActiveCampaign(context);
	const isDM = isDmAccess();

	// Top tabs state (same for everyone)
	const [activeTopTab, setActiveTopTab] = useState<TopTab>("calendar");


	// Bottom tabs state (different defaults based on role)
	const [activeBottomTab, setActiveBottomTab] = useState<
		PlayerBottomTab | DMBottomTab
	>(isDM ? "inspector" : "character");

	// Get the selected character for players
	const selectedCharacterId =
		context.User.SelectedCharacters[campaign.RoomCode];
	const selectedCharacter = selectedCharacterId
		? campaign.GameState.Characters.find((c) => c.Id === selectedCharacterId)
		: null;

	// Get label for current top tab
	const getTopTabLabel = () => {
		switch (activeTopTab) {
			case "music":
				return "Audio";

			case "calendar":
				return "Calendar";
			case "terrain":
				return "Terrain";
		}
	};

	return (
		<MapStateProvider>
			<div className="flex h-full">
				{/* Left 70%: Map */}
				<div className="flex-1 overflow-hidden relative">
					<SceneDisplay />
					<Map
						characters={campaign.GameState.Characters}
						entities={campaign.GameState.Entities}
						terrain={campaign.Terrains.find(
							(t) => t.Id === campaign.GameState.TerrainId
						)}
					/>
					{/* Dice Roller */}
					<DiceRoller />
				</div>

				{/* Right 30%: Side Panel */}
				<div className="w-160 border-l-2 flex">
					{/* Full-Height Vertical Navbar */}
					<div className="w-12 border-r-2 flex flex-col bg-base-200">
						{/* Top 20%: Vertical Tab Label */}
						<div className="h-60 flex items-center justify-center">
							<div
								className="text-md font-semibold"
								style={{ writingMode: "sideways-lr" }}
							>
								{getTopTabLabel()}
							</div>
						</div>

						{/* Icon Buttons */}
						<div className="flex-1 border-t-2 flex flex-col items-center py-1 gap-1">
							{isDM ? (
								// DM Tabs
								<>
									<button
										className={`btn btn-square ${
											activeBottomTab === "inspector" ? "btn-neutral" : ""
										}`}
										onClick={() => setActiveBottomTab("inspector")}
										title="Inspector"
									>
										<span className="icon-[mdi--magnify] w-6 h-6" />
									</button>
									<button
										className={`btn btn-square ${
											activeBottomTab === "scene" ? "btn-neutral" : ""
										}`}
										onClick={() => setActiveBottomTab("scene")}
										title="Scene"
									>
										<span className="icon-[mdi--image] w-6 h-6" />
									</button>
								</>
							) : (
								// Player Tabs
								<>
									<button
										className={`btn btn-square ${
											activeBottomTab === "character" ? "btn-neutral" : ""
										}`}
										onClick={() => setActiveBottomTab("character")}
										title={
											selectedCharacter
												? `${selectedCharacter.Name}'s info`
												: "Character"
										}
									>
										<span className="icon-[mdi--account] w-6 h-6" />
									</button>
									<button
										className={`btn btn-square ${
											activeBottomTab === "inventory" ? "btn-neutral" : ""
										}`}
										onClick={() => setActiveBottomTab("inventory")}
										title="Inventory"
									>
										<span className="icon-[mdi--bag-personal] w-6 h-6" />
									</button>
									<button
										className={`btn btn-square ${
											activeBottomTab === "skills" ? "btn-neutral" : ""
										}`}
										onClick={() => setActiveBottomTab("skills")}
										title="Skills"
									>
										<span className="icon-[mdi--star] w-6 h-6" />
									</button>
									<button
										className={`btn btn-square ${
											activeBottomTab === "party" ? "btn-neutral" : ""
										}`}
										onClick={() => setActiveBottomTab("party")}
										title="Party"
									>
										<span className="icon-[mdi--account-group] w-6 h-6" />
									</button>
									<button
										className={`btn btn-square ${
											activeBottomTab === "inspector" ? "btn-neutral" : ""
										}`}
										onClick={() => setActiveBottomTab("inspector")}
										title="Inspector"
									>
										<span className="icon-[mdi--magnify] w-6 h-6" />
									</button>
								</>
							)}
						</div>
					</div>

					{/* Content Area */}
					<div className="flex-1 flex flex-col overflow-x-hidden">
						{/* Top 20%: Top Tab Section */}
						<div className="h-60 flex flex-col">
							{/* Icon Tabs */}
							<div className="tabs tabs-lift">
								<button
									className={`flex-auto tab border-l-0 border-t-0 ${
										activeTopTab === "music" ? "tab-active" : ""
									}`}
									onClick={() => setActiveTopTab("music")}
									title="Music"
								>
									<span className="icon-[mdi--music] w-5 h-5" />
								</button>
								<button
									className={`flex-auto tab border-t-0 ${
										activeTopTab === "calendar" ? "tab-active" : ""
									}`}
									onClick={() => setActiveTopTab("calendar")}
									title="Calendar"
								>
									<span className="icon-[mdi--calendar] w-5 h-5" />
								</button>
								<button
									className={`flex-auto tab border-r-0 border-t-0 ${
										activeTopTab === "terrain" ? "tab-active" : ""
									}`}
									onClick={() => setActiveTopTab("terrain")}
									title="Terrain"
								>
									<span className="icon-[mdi--terrain] w-5 h-5" />
								</button>
							</div>

							{/* Top Tab Content */}
							<div className="flex-1 overflow-auto p-4 bg-base-100">
								{activeTopTab === "music" && (
									<AudioDisplay/>
								)}
								{activeTopTab === "calendar" && (
									<CalendarDisplay/>
								)}
								{activeTopTab === "terrain" && (
									<TerrainDisplay/>
								)}
							</div>
						</div>

						{/* Bottom 80%: Bottom Tab Content */}
						<div className="flex-1 overflow-auto p-4 border-t-2 bg-base-100">
							{activeBottomTab === "character" && (
								<div className="text-center text-sm opacity-60">
									Character Info - Coming Soon
								</div>
							)}
							{activeBottomTab === "inventory" && (
								<div className="text-center text-sm opacity-60">
									Inventory - Coming Soon
								</div>
							)}
							{activeBottomTab === "skills" && (
								<div className="text-center text-sm opacity-60">
									Skills - Coming Soon
								</div>
							)}
							{activeBottomTab === "party" && (
								<div className="text-center text-sm opacity-60">
									Party - Coming Soon
								</div>
							)}
							{activeBottomTab === "inspector" && <Inspector/>}
							{activeBottomTab === "scene" && <SceneEdit />}
						</div>
					</div>
				</div>
			</div>
		</MapStateProvider>
	);
}
