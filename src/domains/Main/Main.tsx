// domains/Main/Main.tsx - Updated

import { useQuestContext, triggerContextUpdate } from "../Context/ContextProvider";
import { CampaignActions } from "../Campaign/CampaignActions";
import { LocalStorageUtilities } from "../../utils/LocalStorageUtilities";
import MapScene, { type CameraPreference } from "../../components/Map/MapScene";
import { useEffect, useMemo, useRef, useState } from "react";
import { MapStateProvider, useMapState } from "../../components/Map/MapStateProvider";
import { useViewedTerrain } from "../../components/Map/useViewedTerrain";
import { DmMapToolbar } from "../../components/Map/DmMapToolbar";
import { Inspector } from "./Inspector";
import CalendarDisplay from "../Calendar/CalendarDisplay";
import TerrainDisplay from "../Terrain/TerrainDisplay";
import { AudioDisplay } from "../Audio/AudioDisplay";
import { SceneDisplay } from "../Scene/SceneDisplay";
import { isDmAccess } from "../../utils/UrlParser";
import { SceneEdit } from "../Scene/Edit";
import { DiceRoller } from "../../components/Dice/DiceRoller";
import { DiceRollerProvider } from "../../components/Dice/DiceRollerContext";
import { LogDisplay } from "../Log/LogDisplay";
import { NoteDisplay } from "../Note/NoteDisplay";
import { CharacterSheet } from "../Character/CharacterSheet";
import { ItemCollection } from "../Item/Collection";
import { Party } from "./Party";
import { Overview } from "./Overview";
import { SkillCollection } from "../Skill/Collection";
import { CombatDisplay } from "../Combat/CombatDisplay";
import { StatusCollection } from "../Status/Collection";
import { StickerPicker } from "../../components/Sticker/StickerPicker";
import { SharedInventoryDisplay } from "../SharedInventory/SharedInventoryDisplay";
import { TerrainStorageService } from "../../services/TerrainStorageService";
import { findFirstPersonActor } from "../../components/Map/FirstPerson/actor";
import { useIsMobile } from "../../hooks/useIsMobile";
import { CameraModeDropdown } from "../../components/Map/CameraModeDropdown";

type TopTab = "music" | "calendar" | "terrain" | "combat";
type MapViewMode = "world" | "first-person";
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
type DMBottomTab =
	| "inspector"
	| "scene"
	| "log"
	| "overview"
	| "shared-inventories";

export function Main({ active = true }: { active?: boolean } = {}) {
	const context = useQuestContext();
	const campaign = CampaignActions.getActiveCampaign(context);
	const isDM = isDmAccess();
	const isMobile = useIsMobile();
	// On mobile the side panel overlays the map: collapsed = icon-only strip,
	// open = slides over the map at full width. Map stays mounted underneath.
	const [panelOpen, setPanelOpen] = useState(false);
	// The top tab section (audio/calendar/terrain/combat) can be collapsed to
	// just its tab row to give the bottom content more room.
	const [topTabsCollapsed, setTopTabsCollapsed] = useState(false);
	const [mapViewMode, setMapViewMode] = useState<MapViewMode>("world");
	const [xRayActors, setXRayActors] = useState(false);
	const [cameraPreference, setCameraPreference] = useState<CameraPreference>(() => {
		const saved = localStorage.getItem("quest-net:cameraPreference");
		if (saved === "perspective") return "perspective";
		if (saved === "freecam" && isDM) return "freecam";
		return "ortho";
	});
	const [mapReady, setMapReady] = useState(false);

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

	// The single terrain this client renders. A player follows their selected
	// character; the DM follows its locally-viewed terrain (default = first
	// terrain in the list). See docs/multi-terrain-world.md §5.4.
	const { viewedTerrainId } = useViewedTerrain();
	const renderedTerrainId = isDM
		? viewedTerrainId
		: selectedCharacter?.Position.terrainId ?? null;

	const renderedTerrain = renderedTerrainId
		? campaign.VoxelTerrains.find((t) => t.Id === renderedTerrainId)
		: undefined;
	const hydratedRenderedTerrain =
		renderedTerrain && TerrainStorageService.isHydrated(renderedTerrain)
			? renderedTerrain
			: undefined;

	// Only render the actors that live on the rendered terrain.
	const visibleCharacters = useMemo(
		() =>
			campaign.GameState.Characters.filter(
				(c) => c.Position.terrainId === renderedTerrainId
			),
		[campaign.GameState.Characters, renderedTerrainId]
	);
	const visibleEntities = useMemo(
		() =>
			campaign.GameState.Entities.filter(
				(e) => e.Position.terrainId === renderedTerrainId
			),
		[campaign.GameState.Entities, renderedTerrainId]
	);
	const firstPersonActor = findFirstPersonActor(
		isDM ? "dm" : "player",
		campaign.RoomCode,
		context.User.SelectedCharacters,
		context.User.ImpersonatedActors,
		campaign.GameState.Characters,
		campaign.GameState.Entities
	);
	const firstPersonActorId = firstPersonActor?.id ?? null;
	const showFirstPersonButton = !isDM || firstPersonActorId !== null;

	// Hide Shared Inventories tab when none are configured. Tracking the count
	// (rather than the array reference) keeps the effect from firing on every
	// state-sync re-render, and bounces the user off the tab if a DM deletes
	// the last shared inventory while it's open.
	const sharedInventoriesCount =
		campaign.Settings.SharedInventories?.length ?? 0;
	const hasSharedInventories = sharedInventoriesCount > 0;
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

	// If the Shared Inventories tab is open and the last shared inventory gets
	// deleted, fall back to a sensible default for the current role rather than
	// leaving the user on a tab whose button has just disappeared.
	useEffect(() => {
		if (activeBottomTab === "shared-inventories" && !hasSharedInventories) {
			setActiveBottomTab(isDM ? "inspector" : "character");
		}
	}, [hasSharedInventories, activeBottomTab, isDM]);

	useEffect(() => {
		if (
			mapViewMode === "first-person" &&
			isDM &&
			!firstPersonActorId
		) {
			setMapViewMode("world");
		}
	}, [firstPersonActorId, isDM, mapViewMode]);

	useEffect(() => {
		LocalStorageUtilities.saveString(
			"quest-net:cameraPreference",
			cameraPreference
		);
	}, [cameraPreference]);

	// Reset map-ready flag whenever the rendered terrain changes so the loading
	// screen re-appears during the WebGL init + shader compile for the new terrain.
	useEffect(() => {
		setMapReady(false);
	}, [renderedTerrainId]);

	// Ensure the rendered terrain is fully hydrated (voxels loaded) so MapScene
	// can build its geometry. Previously this was driven by terrain:setActive;
	// now each client hydrates the terrain it is actually rendering.
	useEffect(() => {
		if (!renderedTerrainId) return;
		const terrain = campaign.VoxelTerrains.find(
			(t) => t.Id === renderedTerrainId
		);
		if (terrain && !TerrainStorageService.isHydrated(terrain)) {
			void TerrainStorageService.hydrateTerrain(campaign, renderedTerrainId).then(
				() => triggerContextUpdate()
			);
		}
	}, [renderedTerrainId, campaign]);

	// Pin the rendered terrain so background packing never unloads the terrain
	// this client is actively displaying. See docs/multi-terrain-world.md §6.3.
	useEffect(() => {
		TerrainStorageService.setPinnedTerrains(
			renderedTerrainId ? [renderedTerrainId] : []
		);
	}, [renderedTerrainId]);

	// DM tactical hydration: keep an index loaded for every terrain that has a
	// player character on it, so cross-terrain moves can be validated without
	// rendering those terrains. See docs/multi-terrain-world.md §6.2.
	const characterTerrainSignature = isDM
		? campaign.GameState.Characters.map((c) => c.Position.terrainId)
				.sort()
				.join(",")
		: "";
	useEffect(() => {
		if (!isDM) return;
		void TerrainStorageService.ensureCharacterTerrainsHydrated(campaign);
		// campaign read at call time; signature gates re-runs.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [isDM, characterTerrainSignature]);

	// Handle tab changes and clear indicators
	const handleBottomTabChange = (tab: PlayerBottomTab | DMBottomTab) => {
		setActiveBottomTab(tab);

		// On mobile, selecting a tab slides the panel open over the map.
		if (isMobile) {
			setPanelOpen(true);
		}

		// Clear indicators when switching to that tab
		if (tab === "inventory") {
			setShowInventoryIndicator(false);
		} else if (tab === "equipment") {
			setShowEquipmentIndicator(false);
		} else if (tab === "skills") {
			setShowSkillsIndicator(false);
		} else if (tab === "statuses") {
			setShowStatusIndicator(false);
		}
	};

	const switchToInspector = () => {
		setActiveBottomTab("inspector");
	};

	// Selecting a top tab also expands the top section if it was collapsed.
	const handleTopTabChange = (tab: TopTab) => {
		setActiveTopTab(tab);
		setTopTabsCollapsed(false);
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
		<DiceRollerProvider>
		<MapStateProvider>
			<ViewTerrainSync />
			<div className="flex h-full relative">
				{/* Left 70%: Map */}
				<div className="flex-1 overflow-hidden relative isolate">
					<SceneDisplay dmToolbar={isDM && mapViewMode === "world"} />
					<MapScene
						characters={visibleCharacters}
						entities={visibleEntities}
						terrain={hydratedRenderedTerrain}
						xRayActors={isDM && xRayActors}
						cameraPreference={cameraPreference}
						viewMode={mapViewMode}
						paused={!active}
						onReady={() => setMapReady(true)}
						onExitFirstPerson={() => setMapViewMode("world")}
					/>
					{renderedTerrain && (!hydratedRenderedTerrain || !mapReady) && (
						<div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 bg-base-200/95 text-base-content">
							<span className="icon-[mdi--compass] w-12 h-12 animate-spin text-primary" />
							<span className="text-base font-medium tracking-wide">
								Travelling to {renderedTerrain.Name}...
							</span>
						</div>
					)}
					{mapViewMode === "world" && isDM && (
						<DmMapToolbar
							campaign={campaign}
							cameraPreference={cameraPreference}
							onCameraPreferenceChange={setCameraPreference}
							xRayActors={xRayActors}
							onToggleXRay={() => setXRayActors((current) => !current)}
							showFirstPersonButton={showFirstPersonButton}
							onEnterFirstPerson={() => setMapViewMode("first-person")}
						/>
					)}
					{mapViewMode === "world" && !isDM && (
						<div className="absolute left-3 top-3 z-20">
							<div className="join shadow-sm">
								{showFirstPersonButton && (
									<button
										className="btn btn-sm btn-neutral join-item tooltip tooltip-right"
										data-tip="First-person mode"
										onClick={() => setMapViewMode("first-person")}
										aria-label="Enter first-person mode"
									>
										<span className="icon-[mdi--camera-control] w-5 h-5" />
									</button>
								)}
								<CameraModeDropdown
									value={cameraPreference}
									onChange={setCameraPreference}
									showFreecam={false}
									joinItem
								/>
							</div>
						</div>
					)}
					<DiceRoller />
					{/* Sticker Picker — shifted left on mobile to clear the collapsed panel strip */}
					<div className="absolute right-14 lg:right-2 bottom-2 z-20">
						<StickerPicker />
					</div>
				</div>

				{/* Right 30%: Side Panel.
				    On mobile this is an overlay: collapsed to the icon strip
				    (w-12) and sliding to full width when a tab is opened. On
				    sm+ it returns to the static side-by-side layout. */}
				<div
					className={`flex bg-base-200 absolute inset-y-0 right-0 z-30 overflow-hidden transition-[width] duration-300 ease-in-out ${
						panelOpen ? "w-full" : "w-12"
					} border-l-2 lg:static lg:w-160 lg:z-auto lg:overflow-visible lg:transition-none`}
				>
					{/* Full-Height Vertical Navbar. The right border only makes sense
					    when there's content beside it — hidden while collapsed on mobile. */}
					<div
						className={`w-12 shrink-0 flex flex-col bg-base-200 ${
							panelOpen ? "border-r-2" : ""
						} lg:border-r-2`}
					>
						{/* Back-to-map control (mobile only, when the panel is open).
						    The whole top strip is the button rather than a nested one. */}
						{panelOpen && (
							<button
								className="w-full shrink-0 flex items-center justify-center bg-primary py-2 text-primary-content hover:brightness-110 lg:hidden"
								onClick={() => setPanelOpen(false)}
								title="Back to map"
								aria-label="Back to map"
							>
								<span className="icon-[mdi--map-outline] w-6 h-6" />
							</button>
						)}

						{/* Top 20%: Vertical Tab Label (hidden on mobile to save space) */}
						<div className="h-60 hidden lg:flex items-center justify-center">
							<div
								className="text-md font-semibold"
								style={{ writingMode: "sideways-lr" }}
							>
								{getTopTabLabel()}
							</div>
						</div>

						{/* Icon Buttons */}
						<div className={`flex-1 min-h-0 overflow-y-auto flex flex-col items-center py-1 gap-1 ${panelOpen ? "border-t-2" : ""} lg:border-t-2`}>
							{isDM ? (
								// DM Tabs
								<>
									<button
										className={`btn btn-square ${activeBottomTab === "inspector" ? "btn-neutral" : ""
											}`}
										onClick={() => handleBottomTabChange("inspector")}
										title="Inspector"
									>
										<span className="icon-[mdi--magnify] w-6 h-6" />
									</button>
									<button
										className={`btn btn-square ${activeBottomTab === "scene" ? "btn-neutral" : ""
											}`}
										onClick={() => handleBottomTabChange("scene")}
										title="Scene"
									>
										<span className="icon-[mdi--image] w-6 h-6" />
									</button>
									<button
										className={`btn btn-square ${activeBottomTab === "log" ? "btn-neutral" : ""
											}`}
										onClick={() => handleBottomTabChange("log")}
										title="Log"
									>
										<span className="icon-[mdi--message-text] w-6 h-6" />
									</button>
									<button
										className={`btn btn-square ${activeBottomTab === "overview" ? "btn-neutral" : ""
											}`}
										onClick={() => handleBottomTabChange("overview")}
										title="Overview"
									>
										<span className="icon-[mdi--account-multiple] w-6 h-6" />
									</button>
									{hasSharedInventories && (
										<button
											className={`btn btn-square ${activeBottomTab === "shared-inventories" ? "btn-neutral" : ""
												}`}
											onClick={() => handleBottomTabChange("shared-inventories")}
											title="Shared Inventories"
										>
											<span className="icon-[mdi--treasure-chest] w-6 h-6" />
										</button>
									)}
								</>
							) : (
								// Player Tabs
								<>
									<button
										className={`btn btn-square ${activeBottomTab === "character" ? "btn-neutral" : ""
											}`}
										onClick={() => handleBottomTabChange("character")}
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
											<span className="icon-[mdi--sack] w-6 h-6" />
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
										onClick={() => handleBottomTabChange("party")}
										title="Party"
									>
										<span className="icon-[mdi--account-group] w-6 h-6" />
									</button>
									{hasSharedInventories && (
										<button
											className={`btn btn-square ${activeBottomTab === "shared-inventories" ? "btn-neutral" : ""
												}`}
											onClick={() => handleBottomTabChange("shared-inventories")}
											title="Shared Inventories"
										>
											<span className="icon-[mdi--treasure-chest] w-6 h-6" />
										</button>
									)}
									<button
										className={`btn btn-square ${activeBottomTab === "inspector" ? "btn-neutral" : ""
											}`}
										onClick={() => handleBottomTabChange("inspector")}
										title="Inspector"
									>
										<span className="icon-[mdi--magnify] w-6 h-6" />
									</button>
									<button
										className={`btn btn-square ${activeBottomTab === "log" ? "btn-neutral" : ""
											}`}
										onClick={() => handleBottomTabChange("log")}
										title="Log"
									>
										<span className="icon-[mdi--message-text] w-6 h-6" />
									</button>
									<button
										className={`btn btn-square ${activeBottomTab === "notes" ? "btn-neutral" : ""
											}`}
										onClick={() => handleBottomTabChange("notes")}
										title="Notes"
									>
										<span className="icon-[mdi--notebook] w-6 h-6" />
									</button>
								</>
							)}
						</div>
					</div>

					{/* Content Area */}
					<div className="flex-1 min-w-0 flex flex-col overflow-x-hidden">
						{/* Top Tab Section (collapsible) */}
						<div className={`${topTabsCollapsed ? "" : "h-60"} shrink-0 flex flex-col`}>
							{/* Icon Tabs */}
							<div className="tabs tabs-lift">
								<button
									className={`flex-auto tab border-l-0 border-t-0 ${activeTopTab === "music" ? "tab-active" : ""
										}`}
									onClick={() => handleTopTabChange("music")}
									title="Music"
								>
									<span className="icon-[mdi--music] w-5 h-5" />
								</button>
								<button
									className={`flex-auto tab border-t-0 ${activeTopTab === "calendar" ? "tab-active" : ""
										}`}
									onClick={() => handleTopTabChange("calendar")}
									title="Calendar"
								>
									<span className="icon-[mdi--calendar] w-5 h-5" />
								</button>
								<button
									className={`flex-auto tab border-t-0 ${activeTopTab === "terrain" ? "tab-active" : ""
										}`}
									onClick={() => handleTopTabChange("terrain")}
									title="Terrain"
								>
									<span className="icon-[mdi--terrain] w-5 h-5" />
								</button>
								<button
									className={`flex-auto tab border-t-0 ${activeTopTab === "combat" ? "tab-active" : ""
										}`}
									onClick={() => handleTopTabChange("combat")}
									title="Combat"
								>
									<span className="icon-[mdi--sword-cross] w-5 h-5" />
								</button>
								{/* Collapse / expand toggle for the top section */}
								<button
									className="tab border-t-0 border-r-0 px-2"
									onClick={() => setTopTabsCollapsed((v) => !v)}
									title={topTabsCollapsed ? "Expand section" : "Collapse section"}
									aria-label={topTabsCollapsed ? "Expand top tabs" : "Collapse top tabs"}
									aria-expanded={!topTabsCollapsed}
								>
									<span
										className={`${topTabsCollapsed ? "icon-[mdi--chevron-down]" : "icon-[mdi--chevron-up]"} w-5 h-5`}
									/>
								</button>
							</div>

							{/* Top Tab Content */}
							{!topTabsCollapsed && (
								<div className="flex-1 overflow-auto p-4 bg-base-100">
									{activeTopTab === "music" && <AudioDisplay />}
									{activeTopTab === "calendar" && <CalendarDisplay />}
									{activeTopTab === "terrain" && (
										<TerrainDisplay terrainId={renderedTerrainId ?? undefined} />
									)}
									{activeTopTab === "combat" && <CombatDisplay />}
								</div>
							)}
						</div>

						{/* Bottom 80%: Bottom Tab Content */}
						<div className={`flex-1 overflow-auto p-4 bg-base-100 ${topTabsCollapsed ? "" : "border-t-2"}`}>
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
							{!isDM && activeBottomTab === "party" && (
								<Party onInspectActor={switchToInspector} />
							)}
							{isDM && activeBottomTab === "overview" && (
								<Overview onInspectActor={switchToInspector} />
							)}
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
		</DiceRollerProvider>
	);
}

/**
 * Bridges actor selection (MapStateProvider) to the DM's viewed terrain:
 * when the DM selects an actor that lives on another terrain, the view follows
 * it. Renders nothing. DM-only — a player's view follows its selected character,
 * not arbitrary actor selection. See docs/multi-terrain-world.md §5.9.
 */
function ViewTerrainSync() {
	const context = useQuestContext();
	const campaign = CampaignActions.getActiveCampaign(context);
	const isDM = isDmAccess();
	const { selectedActor } = useMapState();
	const { setViewedTerrain } = useViewedTerrain();
	const selectedActorId = selectedActor?.id ?? null;

	useEffect(() => {
		if (!isDM || !selectedActorId) return;
		const actor =
			campaign.GameState.Characters.find((c) => c.Id === selectedActorId) ??
			campaign.GameState.Entities.find((e) => e.Id === selectedActorId);
		if (actor) setViewedTerrain(actor.Position.terrainId);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [selectedActorId, isDM]);

	return null;
}
