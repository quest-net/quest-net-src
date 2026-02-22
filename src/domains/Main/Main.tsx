// domains/Main/Main.tsx - Updated

import { useQuestContext } from "../Context/ContextProvider";
import { CampaignActions } from "../Campaign/CampaignActions";
import Map from "../../components/Map/Map";
import TwoDMap from "../../components/Map/2DMap";
import { useEffect, useRef, useState } from "react";
import { MapStateProvider } from "../../components/Map/MapStateProvider";
import { Inspector } from "./Inspector";
import CalendarDisplay from "../Calendar/CalendarDisplay";
import TerrainDisplay from "../Terrain/TerrainDisplay";
import { AudioDisplay } from "../Audio/AudioDisplay";
import { SceneDisplay } from "../Scene/SceneDisplay";
import { isDmAccess } from "../../utils/UrlParser";
import { SceneEdit } from "../Scene/Edit";
import { DiceRoller } from "../../components/Dice/DiceRoller";
import { LogDisplay } from "../Log/LogDisplay";
import { NoteDisplay } from "../Note/NoteDisplay";
import { CharacterSheet } from "../Character/CharacterSheet";
import { ItemCollection } from "../Item/Collection";
import { Party } from "./Party";
import { SkillCollection } from "../Skill/Collection";
import { CombatDisplay } from "../Combat/CombatDisplay";
import { StatusCollection } from "../Status/Collection";
import { StickerPicker } from "../../components/Sticker/StickerPicker";
import { SharedInventoryDisplay } from "../../components/display/SharedInventoryDisplay";

type TopTab = "music" | "calendar" | "terrain" | "combat";
type PlayerBottomTab =
	| "character"
	| "equipment"
	| "inventory"
	| "skills"
	| "statuses"
	| "party"
	| "shared-inventories"
	| "inspector"
	| "log"
	| "notes";
type DMBottomTab = "inspector" | "scene" | "log" | "party" | "shared-inventories";

export function Main() {
	const context = useQuestContext();
	const campaign = CampaignActions.getActiveCampaign(context);
	const isDM = isDmAccess();

	// 2D/3D mode (persist per browser)
	const [is2D, setIs2D] = useState<boolean>(() => {
		try {
			return (localStorage.getItem("questnet.mapMode") || "3d") === "2d";
		} catch {
			return false;
		}
	});
	useEffect(() => {
		try {
			localStorage.setItem("questnet.mapMode", is2D ? "2d" : "3d");
		} catch { }
	}, [is2D]);

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
	// Track indicators for new items (players only)
	const [showInventoryIndicator, setShowInventoryIndicator] = useState(false);
	const [showEquipmentIndicator, setShowEquipmentIndicator] = useState(false);
	const [showSkillsIndicator, setShowSkillsIndicator] = useState(false);
	const [showStatusIndicator, setShowStatusIndicator] = useState(false);
	// Track previous counts to detect increases
	const prevCountsRef = useRef<{
		equipment: number;
		inventory: number;
		skills: number;
		statuses: number;
	} | null>(null);

	// Detect when item counts increase (only for players)
	useEffect(() => {
		if (isDM || !selectedCharacter) return;

		const currentCounts = {
			equipment: selectedCharacter.Equipment.length,
			inventory: selectedCharacter.Inventory.length,
			skills: selectedCharacter.Skills.length,
			statuses: selectedCharacter.Statuses.length,
		};

		// Initialize on first render
		if (!prevCountsRef.current) {
			prevCountsRef.current = currentCounts;
			return;
		}

		// Check if counts increased while tab is not active
		if (
			currentCounts.inventory > prevCountsRef.current.inventory &&
			activeBottomTab !== "inventory"
		) {
			setShowInventoryIndicator(true);
		}

		if (
			currentCounts.equipment > prevCountsRef.current.equipment &&
			activeBottomTab !== "equipment"
		) {
			setShowEquipmentIndicator(true);
		}

		if (
			currentCounts.skills > prevCountsRef.current.skills &&
			activeBottomTab !== "skills"
		) {
			setShowSkillsIndicator(true);
		}

		if (
			currentCounts.statuses > prevCountsRef.current.statuses &&
			activeBottomTab !== "statuses"
		) {
			setShowStatusIndicator(true);
		}

		// Update ref
		prevCountsRef.current = currentCounts;
	}, [
		selectedCharacter?.Equipment.length,
		selectedCharacter?.Inventory.length,
		selectedCharacter?.Skills.length,
		selectedCharacter?.Statuses.length,
		activeBottomTab,
		isDM,
		selectedCharacter,
	]);

	// Handle tab changes and clear indicators
	const handleBottomTabChange = (tab: PlayerBottomTab | DMBottomTab) => {
		setActiveBottomTab(tab);

		// Clear indicators when switching to that tab
		if (tab === "inventory") {
			setShowInventoryIndicator(false);
		} else if (tab === "skills") {
			setShowSkillsIndicator(false);
		}
	};
	// Get label for current top tab
	const getTopTabLabel = () => {
		switch (activeTopTab) {
			case "music":
				return "Audio";
			case "calendar":
				return "Calendar";
			case "terrain":
				return "Terrain";
			case "combat":
				return "Combat";
		}
	};

	return (
		<MapStateProvider>
			<div className="flex h-full">
				{/* Left 70%: Map */}
				<div className="flex-1 overflow-hidden relative">
					<SceneDisplay />
					{/* 2D / 3D toggle button (placed outside Map.tsx so we can swap components) */}
					<div className="absolute right-2 bottom-2 z-20">
						<button
							className="btn btn-square btn-lg rounded-lg btn-info shadow-lg"
							onClick={() => setIs2D((v) => !v)}
							title={is2D ? "Switch to 3D" : "Switch to 2D"}
						>
							{is2D ? (
								<span className="icon-[mdi--cube-outline] w-6 h-6" />
							) : (
								<span className="icon-[mdi--grid] w-6 h-6" />
							)}
						</button>
					</div>

					{/* Swap the renderer */}
					{is2D ? (
						<TwoDMap
							characters={campaign.GameState.Characters}
							entities={campaign.GameState.Entities}
							terrain={campaign.Terrains.find(
								(t) => t.Id === campaign.GameState.TerrainId
							)}
						/>
					) : (
						<Map
							characters={campaign.GameState.Characters}
							entities={campaign.GameState.Entities}
							terrain={campaign.Terrains.find(
								(t) => t.Id === campaign.GameState.TerrainId
							)}
						/>
					)}
					{/* Dice Roller */}
					<DiceRoller />

					{/* Sticker Picker - Players only */}
					{!isDM && (
						<div className="absolute right-2 bottom-18 z-20">
							<StickerPicker />
						</div>
					)}
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
										className={`btn btn-square ${activeBottomTab === "inspector" ? "btn-neutral" : ""
											}`}
										onClick={() => setActiveBottomTab("inspector")}
										title="Inspector"
									>
										<span className="icon-[mdi--magnify] w-6 h-6" />
									</button>
									<button
										className={`btn btn-square ${activeBottomTab === "scene" ? "btn-neutral" : ""
											}`}
										onClick={() => setActiveBottomTab("scene")}
										title="Scene"
									>
										<span className="icon-[mdi--image] w-6 h-6" />
									</button>
									<button
										className={`btn btn-square ${activeBottomTab === "log" ? "btn-neutral" : ""
											}`}
										onClick={() => setActiveBottomTab("log")}
										title="Log"
									>
										<span className="icon-[mdi--message-text] w-6 h-6" />
									</button>
									<button
										className={`btn btn-square ${activeBottomTab === "party" ? "btn-neutral" : ""
											}`}
										onClick={() => setActiveBottomTab("party")}
										title="Party"
									>
										<span className="icon-[mdi--account-group] w-6 h-6" />
									</button>
									<button
										className={`btn btn-square ${activeBottomTab === "shared-inventories" ? "btn-neutral" : ""
											}`}
										onClick={() => setActiveBottomTab("shared-inventories")}
										title="Shared Inventories"
									>
										<span className="icon-[mdi--treasure-chest] w-6 h-6" />
									</button>
								</>
							) : (
								// Player Tabs
								<>
									<button
										className={`btn btn-square ${activeBottomTab === "character" ? "btn-neutral" : ""
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
									<div className={showEquipmentIndicator ? "indicator" : ""}>
										{showEquipmentIndicator && (
											<span className="indicator-item status status-info"></span>
										)}
										<button
											className={`btn btn-square ${activeBottomTab === "equipment" ? "btn-neutral" : ""
												}`}
											onClick={() => handleBottomTabChange("equipment")}
											title="Equipment"
										>
											<span className="icon-[mdi--sword] w-6 h-6" />
										</button>
									</div>
									<div className={showInventoryIndicator ? "indicator" : ""}>
										{showInventoryIndicator && (
											<span className="indicator-item status status-info"></span>
										)}
										<button
											className={`btn btn-square ${activeBottomTab === "inventory" ? "btn-neutral" : ""
												}`}
											onClick={() => handleBottomTabChange("inventory")}
											title="Inventory"
										>
											<span className="icon-[mdi--bag-personal] w-6 h-6" />
										</button>
									</div>

									<div className={showSkillsIndicator ? "indicator" : ""}>
										{showSkillsIndicator && (
											<span className="indicator-item status status-info"></span>
										)}
										<button
											className={`btn btn-square ${activeBottomTab === "skills" ? "btn-neutral" : ""
												}`}
											onClick={() => handleBottomTabChange("skills")}
											title="Skills"
										>
											<span className="icon-[mdi--star] w-6 h-6" />
										</button>
									</div>
									<div className={showStatusIndicator ? "indicator" : ""}>
										{showStatusIndicator && (
											<span className="indicator-item status status-info"></span>
										)}
										<button
											className={`btn btn-square ${activeBottomTab === "statuses" ? "btn-neutral" : ""
												}`}
											onClick={() => handleBottomTabChange("statuses")}
											title="Statuses"
										>
											<span className="icon-[mdi--heart-pulse] w-6 h-6" />
										</button>
									</div>
									<button
										className={`btn btn-square ${activeBottomTab === "party" ? "btn-neutral" : ""
											}`}
										onClick={() => setActiveBottomTab("party")}
										title="Party"
									>
										<span className="icon-[mdi--account-group] w-6 h-6" />
									</button>
									<button
										className={`btn btn-square ${activeBottomTab === "shared-inventories" ? "btn-neutral" : ""
											}`}
										onClick={() => setActiveBottomTab("shared-inventories")}
										title="Shared Inventories"
									>
										<span className="icon-[mdi--treasure-chest] w-6 h-6" />
									</button>
									<button
										className={`btn btn-square ${activeBottomTab === "inspector" ? "btn-neutral" : ""
											}`}
										onClick={() => setActiveBottomTab("inspector")}
										title="Inspector"
									>
										<span className="icon-[mdi--magnify] w-6 h-6" />
									</button>
									<button
										className={`btn btn-square ${activeBottomTab === "log" ? "btn-neutral" : ""
											}`}
										onClick={() => setActiveBottomTab("log")}
										title="Log"
									>
										<span className="icon-[mdi--message-text] w-6 h-6" />
									</button>
									<button
										className={`btn btn-square ${activeBottomTab === "notes" ? "btn-neutral" : ""
											}`}
										onClick={() => setActiveBottomTab("notes")}
										title="Notes"
									>
										<span className="icon-[mdi--notebook] w-6 h-6" />
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
									className={`flex-auto tab border-l-0 border-t-0 ${activeTopTab === "music" ? "tab-active" : ""
										}`}
									onClick={() => setActiveTopTab("music")}
									title="Music"
								>
									<span className="icon-[mdi--music] w-5 h-5" />
								</button>
								<button
									className={`flex-auto tab border-t-0 ${activeTopTab === "calendar" ? "tab-active" : ""
										}`}
									onClick={() => setActiveTopTab("calendar")}
									title="Calendar"
								>
									<span className="icon-[mdi--calendar] w-5 h-5" />
								</button>
								<button
									className={`flex-auto tab border-t-0 ${activeTopTab === "terrain" ? "tab-active" : ""
										}`}
									onClick={() => setActiveTopTab("terrain")}
									title="Terrain"
								>
									<span className="icon-[mdi--terrain] w-5 h-5" />
								</button>
								<button
									className={`flex-auto tab border-r-0 border-t-0 ${activeTopTab === "combat" ? "tab-active" : ""
										}`}
									onClick={() => setActiveTopTab("combat")}
									title="Combat"
								>
									<span className="icon-[mdi--sword-cross] w-5 h-5" />
								</button>
							</div>

							{/* Top Tab Content */}
							<div className="flex-1 overflow-auto p-4 bg-base-100">
								{activeTopTab === "music" && <AudioDisplay />}
								{activeTopTab === "calendar" && <CalendarDisplay />}
								{activeTopTab === "terrain" && <TerrainDisplay />}
								{activeTopTab === "combat" && <CombatDisplay />}
							</div>
						</div>

						{/* Bottom 80%: Bottom Tab Content */}
						<div className="flex-1 overflow-auto p-4 border-t-2 bg-base-100">
							{activeBottomTab === "character" && <CharacterSheet />}
							{activeBottomTab === "equipment" && selectedCharacter && (
								<ItemCollection actor={selectedCharacter} mode="equipment" />
							)}
							{activeBottomTab === "inventory" && selectedCharacter && (
								<ItemCollection actor={selectedCharacter} mode="inventory" />
							)}
							{activeBottomTab === "skills" && selectedCharacter && (
								<SkillCollection actor={selectedCharacter} />
							)}
							{activeBottomTab === "statuses" && selectedCharacter && (
								<StatusCollection actor={selectedCharacter} />
							)}
							{activeBottomTab === "party" && <Party />}
							{activeBottomTab === "notes" && <NoteDisplay />}
							{activeBottomTab === "inspector" && <Inspector />}
							{activeBottomTab === "scene" && <SceneEdit />}
							{activeBottomTab === "log" && <LogDisplay />}
							{activeBottomTab === "shared-inventories" && (
								<div className="space-y-4">
									{campaign.Settings.SharedInventories?.map(inv => (
										<SharedInventoryDisplay key={inv.Id} inventory={inv} />
									))}
								</div>
							)}
						</div>
					</div>
				</div>
			</div>
		</MapStateProvider>
	);
}
