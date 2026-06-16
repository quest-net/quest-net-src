// domains/Main/Inspector.tsx

import { useState, useEffect } from "react";
import { useMapState } from "../../components/Map/MapStateProvider";
import { useDebouncedCallback } from "../../hooks/useDebounced";
import { useQuestContext } from "../Context/ContextProvider";
import { useActionService } from "../../services/Actions/ActionServiceProvider";
import { CampaignActions } from "../Campaign/CampaignActions";
import { ImageDisplay } from "../Image/ImageDisplay";
import { ImagePicker } from "../../components/inputs/ImagePicker";
import { StatBar } from "../../components/StatBar/StatBar";
import { Actor } from "../Actor/Actor";
import { ObjectPicker, ObjectTypeConfig } from "../../components/inputs/ObjectPicker";
import { TerrainPicker } from "../../components/inputs/TerrainPicker";
import { ItemCollection } from "../Item/Collection";
import { SkillCollection } from "../Skill/Collection";
import { StatusCollection } from "../Status/Collection";
import { ActionBubbles } from "../../components/ActionBubbles/ActionBubbles";
import { AttributesSection } from "../../components/AttributesSection/AttributesSection";
import { useDiceRoller } from "../../components/Dice/DiceRollerContext";
import { ACTOR_DEFAULT_COLORS } from "../Actor/Actor";
import {
	ResolvedAction,
	resolveStats,
	resolveActions,
} from "../../utils/ActorResolvers";
import { EntityActionBar } from "./EntityActionBar";
import { ToggleButton } from "../../components/ui/ToggleButton";
import { EmptyState } from "../../components/ui/EmptyState";

type InspectorTab = "info" | "inventory" | "equipment" | "skills" | "statuses";

export function Inspector() {
	const { selectedActor } = useMapState();
	const context = useQuestContext();
	const { actionService } = useActionService();
	const campaign = CampaignActions.getActiveCampaign(context);
	const myCharacterId = context.User.SelectedCharacters[campaign.RoomCode];

	const isDM = context.User.Role === "dm";

	if (!selectedActor) {
		return <EmptyState>Select an actor on the map to inspect</EmptyState>;
	}

	// Find the full actor data
	const actor =
		selectedActor.kind === "character"
			? campaign.GameState.Characters.find((c) => c.Id === selectedActor.id)
			: campaign.GameState.Entities.find((e) => e.Id === selectedActor.id);

	if (!actor) {
		return <div>Actor not found</div>;
	}

	return (
		<UnifiedInspector
			actor={actor}
			kind={selectedActor.kind}
			isDM={isDM}
			isMyCharacter={actor.Id === myCharacterId}
			actionService={actionService}
			playersSeeEntityHealth={
				campaign.Settings.VisibilitySettings.playersSeeEntityHealth
			}
		/>
	);
}

// ============================================================================
// UNIFIED INSPECTOR
// ============================================================================

interface UnifiedInspectorProps {
	actor: Actor;
	kind: "character" | "entity";
	isDM: boolean;
	isMyCharacter: boolean;
	actionService: any;
	playersSeeEntityHealth: boolean;
}

function UnifiedInspector({
	actor,
	kind,
	isDM,
	isMyCharacter,
	actionService,
	playersSeeEntityHealth,
}: UnifiedInspectorProps) {
	const context = useQuestContext();
	const campaign = CampaignActions.getActiveCampaign(context);

	// Tab state
	const [activeTab, setActiveTab] = useState<InspectorTab>("info");
	const [editingMaxStats, setEditingMaxStats] = useState(false);

	// Local state for debounced fields
	const [localName, setLocalName] = useState(actor.Name);
	const [localDescription, setLocalDescription] = useState(
		actor.Description || ""
	);
	const [localMoveSpeed, setLocalMoveSpeed] = useState(actor.MoveSpeed);
	const [localColor, setLocalColor] = useState(
		actor.Color ??
			(kind === "character"
				? ACTOR_DEFAULT_COLORS.CHARACTER
				: ACTOR_DEFAULT_COLORS.ENTITY)
	);
	const [localAttributes, setLocalAttributes] = useState<
		Map<string, string>
	>(
		new Map(actor.Attributes.map((attr) => [attr.Id, attr.Value]))
	);

	// Object picker state
	const [showObjectPicker, setShowObjectPicker] = useState(false);
	const [showTerrainPicker, setShowTerrainPicker] = useState(false);

	// Sync local state when actor changes
	useEffect(() => {
		setLocalName(actor.Name);
		setLocalDescription(actor.Description || "");
		setLocalMoveSpeed(actor.MoveSpeed);
		setLocalColor(
			actor.Color ??
				(kind === "character"
					? ACTOR_DEFAULT_COLORS.CHARACTER
					: ACTOR_DEFAULT_COLORS.ENTITY)
		);
		setLocalAttributes(new Map(actor.Attributes.map((attr) => [attr.Id, attr.Value])));
		setActiveTab("info"); // Reset to info tab when actor changes
	}, [actor.Id]);

	const handleFieldChange = (field: keyof Actor, value: any) => {
		if (!actionService || !isDM) return;

		const actionKey = kind === "character" ? "character:edit" : "entity:edit";
		const idKey = kind === "character" ? "characterId" : "entityId";

		actionService.execute(actionKey, {
			[idKey]: actor.Id,
			updates: { [field]: value },
		});
	};

	// One debounced commit per field so distinct fields don't coalesce into a
	// single update and clobber one another.
	const commitName = useDebouncedCallback((v: string) =>
		handleFieldChange("Name", v)
	);
	const commitDescription = useDebouncedCallback((v: string) =>
		handleFieldChange("Description", v)
	);
	const commitMoveSpeed = useDebouncedCallback((v: number) =>
		handleFieldChange("MoveSpeed", v)
	);
	const commitColor = useDebouncedCallback((v: string) =>
		handleFieldChange("Color", v)
	);
	const commitAttributes = useDebouncedCallback(
		(updatedAttributes: Actor["Attributes"]) =>
			handleFieldChange("Attributes", updatedAttributes)
	);

	const handleNameChange = (value: string) => {
		setLocalName(value);
		commitName(value);
	};

	const handleDescriptionChange = (value: string) => {
		setLocalDescription(value);
		commitDescription(value);
	};

	const handleMoveSpeedChange = (value: number) => {
		const clamped = Math.max(0, Math.min(99, value));
		setLocalMoveSpeed(clamped);
		commitMoveSpeed(clamped);
	};

	const handleColorChange = (value: string) => {
		setLocalColor(value);
		commitColor(value);
	};

	const handleAttributeChange = (id: string, value: string) => {
		setLocalAttributes((prev) => new Map(prev).set(id, value));

		const updatedAttributes = actor.Attributes.map((attr) =>
			attr.Id === id ? { ...attr, Value: value } : attr
		);
		commitAttributes(updatedAttributes);
	};

	const handleStatChange = (
		statId: string,
		field: "Current" | "Max",
		value: number
	) => {
		if (!actionService || !isDM) return;

		const updatedStats = actor.Stats.map((stat) =>
			stat.Id === statId ? { ...stat, [field]: value } : stat
		);

		const actionKey = kind === "character" ? "character:edit" : "entity:edit";
		const idKey = kind === "character" ? "characterId" : "entityId";

		actionService.execute(actionKey, {
			[idKey]: actor.Id,
			updates: { Stats: updatedStats },
		});
	};

	const handleActionsChange = (updatedActions: ResolvedAction[]) => {
		if (!actionService) return;

		const actionSlots = updatedActions.map((a) => ({
			Id: a.Id,
			Max: a.Max,
			Current: a.Current,
		}));

		const actionKey = kind === "character" ? "character:edit" : "entity:edit";
		const idKey = kind === "character" ? "characterId" : "entityId";

		actionService.execute(actionKey, {
			[idKey]: actor.Id,
			updates: { Actions: actionSlots },
		});
	};

	const handleDespawn = () => {
		if (!actionService || !isDM) return;

		if (kind === "character") {
			actionService.execute("character:remove", { characterId: actor.Id });
		} else {
			actionService.execute("entity:remove", { entityId: actor.Id });
		}
	};

	const handleMove = (toTerrainId: string) => {
		if (!actionService || !isDM) return;

		actionService.execute("terrain:moveActors", {
			actorIds: [actor.Id],
			toTerrainId,
		});

		setShowTerrainPicker(false);
	};

	const handleGiveObjects = (
		objectIds: string[],
		objectType: string,
		count: number
	) => {
		if (!actionService) return;

		// Call the appropriate give action based on object type
		actionService.execute(`${objectType}:give`, {
			[`${objectType}Ids`]: objectIds,
			actorIds: [actor.Id],
			count: count,
		});

		// Close picker
		setShowObjectPicker(false);
	};

	// Prepare object types for ObjectPicker
	const objectTypes: ObjectTypeConfig<any>[] = [
		{
			label: "Items",
			items: campaign.ItemTemplates,
			icon: "icon-[mdi--sack]",
			typeKey: "item",
		},
		{
			label: "Skills",
			items: campaign.SkillTemplates,
			icon: "icon-[mdi--star]",
			typeKey: "skill",
		},
		{
			label: "Statuses",
			items: campaign.StatusTemplates,
			icon: "icon-[mdi--heart-pulse]",
			typeKey: "status",
		},
	];

	// Only show tabs for DM
	const showTabs = isDM;

	return (
		<>
			<div className="flex flex-col h-full">
				{/* Tabs - DM Only */}
				{showTabs && (
					<div className="tabs tabs-lift mb-2">
						<button
							className={`flex-auto tab ${activeTab === "info" ? "tab-active" : ""
								}`}
							onClick={() => setActiveTab("info")}
							title="Info"
						>
							<span className="icon-[mdi--information] w-5 h-5" />
						</button>
						<button
							className={`flex-auto tab ${activeTab === "inventory" ? "tab-active" : ""
								}`}
							onClick={() => setActiveTab("inventory")}
							title="Inventory"
						>
							<span className="icon-[mdi--sack] w-5 h-5" />
						</button>
						<button
							className={`flex-auto tab ${activeTab === "equipment" ? "tab-active" : ""
								}`}
							onClick={() => setActiveTab("equipment")}
							title="Equipment"
						>
							<span className="icon-[mdi--sword] w-5 h-5" />
						</button>
						<button
							className={`flex-auto tab ${activeTab === "skills" ? "tab-active" : ""
								}`}
							onClick={() => setActiveTab("skills")}
							title="Skills"
						>
							<span className="icon-[mdi--star] w-5 h-5" />
						</button>
						<button
							className={`flex-auto tab ${activeTab === "statuses" ? "tab-active" : ""
								}`}
							onClick={() => setActiveTab("statuses")}
							title="Statuses"
						>
							<span className="icon-[mdi--heart-pulse] w-5 h-5" />
						</button>
					</div>
				)}

				{/* Tab Content */}
				<div className="flex-1 overflow-y-auto">
					{activeTab === "info" && (
						<ActorInfoTab
							actor={actor}
							kind={kind}
							isDM={isDM}
							campaign={campaign}
							localName={localName}
							localDescription={localDescription}
							localMoveSpeed={localMoveSpeed}
							localColor={localColor}
							localAttributes={localAttributes}
							playersSeeEntityHealth={playersSeeEntityHealth}
							editingMaxStats={editingMaxStats}
							setEditingMaxStats={setEditingMaxStats}
							handleNameChange={handleNameChange}
							handleDescriptionChange={handleDescriptionChange}
							handleMoveSpeedChange={handleMoveSpeedChange}
							handleColorChange={handleColorChange}
							handleAttributeChange={handleAttributeChange}
							handleFieldChange={handleFieldChange}
							handleStatChange={handleStatChange}
							handleActionsChange={handleActionsChange}
							handleDespawn={handleDespawn}
							setShowObjectPicker={setShowObjectPicker}
							setShowTerrainPicker={setShowTerrainPicker}
							actionService={actionService}
							isMyCharacter={isMyCharacter}
						/>
					)}

					{activeTab === "inventory" && (
						<ItemCollection
							actor={actor}
							mode="inventory"
						/>
					)}

					{activeTab === "equipment" && (
						<ItemCollection
							actor={actor}
							mode="equipment"
						/>
					)}

					{activeTab === "skills" && (
						<SkillCollection
							actor={actor}
						/>
					)}

					{activeTab === "statuses" && (
						<StatusCollection
							actor={actor}
						/>
					)}
				</div>
			</div>

			{/* Object Picker Modal */}
			{isDM && (
				<ObjectPicker
					isOpen={showObjectPicker}
					types={objectTypes}
					multiSelect={true}
					showCount={true}
					onConfirm={handleGiveObjects}
					onCancel={() => setShowObjectPicker(false)}
					title={`Give Objects to ${actor.Name}`}
				/>
			)}

			{/* Terrain Picker Modal */}
			{isDM && (
				<TerrainPicker
					isOpen={showTerrainPicker}
					currentTerrainId={actor.Position.terrainId}
					onConfirm={handleMove}
					onCancel={() => setShowTerrainPicker(false)}
					title={`Move ${actor.Name} to…`}
				/>
			)}
		</>
	);
}

// ============================================================================
// ACTOR INFO TAB
// ============================================================================

interface ActorInfoTabProps {
	actor: Actor;
	kind: "character" | "entity";
	isDM: boolean;
	campaign: import("../Campaign/Campaign").Campaign;
	localName: string;
	localDescription: string;
	localMoveSpeed: number;
	localColor: string;
	localAttributes: Map<string, string>;
	playersSeeEntityHealth: boolean;
	editingMaxStats: boolean;
	setEditingMaxStats: (value: boolean) => void;
	handleNameChange: (value: string) => void;
	handleDescriptionChange: (value: string) => void;
	handleMoveSpeedChange: (value: number) => void;
	handleColorChange: (value: string) => void;
	handleAttributeChange: (id: string, value: string) => void;
	handleFieldChange: (field: keyof Actor, value: any) => void;
	handleStatChange: (statId: string, field: "Current" | "Max", value: number) => void;
	handleActionsChange: (updatedActions: ResolvedAction[]) => void;
	handleDespawn: () => void;
	setShowObjectPicker: (show: boolean) => void;
	setShowTerrainPicker: (show: boolean) => void;
	actionService: any;
	isMyCharacter: boolean;
}

function ActorInfoTab({
	actor,
	kind,
	isDM,
	campaign,
	isMyCharacter,
	localName,
	localDescription,
	localMoveSpeed,
	localColor,
	localAttributes,
	playersSeeEntityHealth,
	editingMaxStats,
	setEditingMaxStats,
	handleNameChange,
	handleDescriptionChange,
	handleMoveSpeedChange,
	handleColorChange,
	handleAttributeChange,
	handleFieldChange,
	handleStatChange,
	handleActionsChange,
	handleDespawn,
	setShowObjectPicker,
	setShowTerrainPicker,
	actionService,
}: ActorInfoTabProps) {
	const { requestRoll } = useDiceRoller();

	// Player-facing visibility gates apply only when a player inspects an entity
	// (NPC/enemy). DMs, and characters, are never gated. Undefined settings are
	// treated as visible so existing campaigns are unaffected.
	const vis = campaign.Settings.VisibilitySettings;
	const gateEntity = !isDM && kind === "entity";
	const showEntityDescription =
		!gateEntity || vis.playersSeeEntityDescriptions !== false;
	const showEntityAttributes =
		!gateEntity || vis.playersSeeEntityAttributes !== false;
	const showEntityActions =
		!gateEntity || vis.playersSeeEntityActions !== false;

	return (
		<div className="space-y-3">
			{/* Name with optional Despawn/Give buttons for DM */}
			<div className="flex justify-between items-start gap-2">
				{isDM ? (
					<input
						type="text"
						value={localName}
						onChange={(e) => handleNameChange(e.target.value)}
						className="input input-bordered input-sm flex-1 text-xl font-bold"
						placeholder="Actor name"
					/>
				) : (
					<h2 className="text-2xl font-bold">{actor.Name}</h2>
				)}
				{isDM && (
					<div className="flex gap-2 shrink-0">
						<button
							onClick={() => setShowObjectPicker(true)}
							className="btn btn-sm btn-primary gap-1"
							disabled={!actionService}
							title="Give objects"
						>
							<span className="icon-[mdi--gift] w-4 h-4" />
							Give
						</button>
						<button
							onClick={handleDespawn}
							className="btn btn-sm btn-error gap-1"
							disabled={!actionService}
							title="Despawn actor"
						>
							<span className="icon-[mdi--close-circle] w-4 h-4" />
							Despawn
						</button>
						<button
							onClick={() => setShowTerrainPicker(true)}
							className="btn btn-sm btn-secondary gap-1"
							disabled={!actionService}
							title="Move actor to another terrain"
						>
							<span className="icon-[mdi--account-arrow-right] w-4 h-4" />
							Move
						</button>
					</div>
				)}
			</div>

			{/* Entity-specific actions (e.g. Pick Up for item entities) */}
			<EntityActionBar actor={actor} />

			{/* Image*/}
			{isDM ? (
				<div className="flex items-center justify-center">
					<ImagePicker
						value={actor.Image}
						onChange={(imageId) => {
							handleFieldChange("Image", imageId);
						}}
					></ImagePicker>
				</div>
			) : (
				<div className="mx-auto rounded-lg flex items-center justify-center">
					<ImageDisplay
						imageId={actor.Image}
						className="max-h-96 object-contain rounded-lg"
						alt={actor.Name}
					/>
				</div>
			)}

			{/* Stats */}
			{isDM ? (
				// DM: Interactive StatBars for all actors (characters and entities)
				<div className="space-y-2">
					<div className="flex items-center justify-end">
						<ToggleButton
							active={editingMaxStats}
							kind="independent"
							quiet
							className="btn-xs btn-circle"
							onClick={() => setEditingMaxStats(!editingMaxStats)}
							title={editingMaxStats ? "Hide max stat controls" : "Edit max stats"}
						>
							<span className="icon-[mdi--cog] w-3.5 h-3.5" />
						</ToggleButton>
					</div>
					<div className="space-y-3">
						{resolveStats(
							actor.Stats,
							campaign.Settings.StatDefinitions
						).map((stat) => (
							<StatBar
								key={stat.Id}
								stat={stat}
								editingMax={editingMaxStats}
								onCurrentChange={(value) =>
									handleStatChange(stat.Id, "Current", value)
								}
								onMaxChange={(value) =>
									handleStatChange(stat.Id, "Max", value)
								}
							/>
						))}
					</div>
				</div>
			) : kind === "character" || playersSeeEntityHealth ? (
				// Player: Readonly progress bars for characters or entities (if visibility enabled)
				<div className="space-y-3">
					{resolveStats(
						actor.Stats,
						campaign.Settings.StatDefinitions
					).map((stat) => {
						// Hide unset stats (actor doesn't have this stat).
						if (stat.Current === null) return null;
						const current = stat.Current;
						const percentage = (current / stat.Max) * 100;

						return (
							<div key={stat.Id} className="space-y-1">
								<div className="flex items-center justify-between">
									<span className="text-sm font-medium">{stat.Name}</span>
									<span className="text-sm opacity-70">
										{current} / {stat.Max}
									</span>
								</div>
								<div className="relative w-full h-6 bg-base-300 rounded overflow-hidden">
									<div
										className="h-full transition-all duration-150"
										style={{
											width: `${percentage}%`,
											backgroundColor: stat.Color,
										}}
									/>
								</div>
							</div>
						);
					})}
				</div>
			) : (
				// Player viewing entity with visibility disabled: Show only stat loss for damaged stats
				<div className="space-y-2">
					{resolveStats(
						actor.Stats,
						campaign.Settings.StatDefinitions
					).map((stat) => {
						// Hide unset stats (actor doesn't have this stat).
						if (stat.Current === null) return null;
						const current = stat.Current;
						const lost = stat.Max - current;

						// Don't show anything if stat is at max
						if (lost <= 0) return null;

						return (
							<div key={stat.Id} className="text-md text-error font-semibold text-center opacity-70">
								{lost} {stat.Name} lost
							</div>
						);
					})}
				</div>
			)}
			{/* Actions */}
			{actor.Actions && actor.Actions.length > 0 && showEntityActions && (
				<div className="pt-2">
					<ActionBubbles
						actions={resolveActions(
							actor.Actions,
							campaign.Settings.ActionDefinitions
						)}
						onChange={handleActionsChange}
						readonly={!isDM && !isMyCharacter}
					/>
				</div>
			)}
			{/* Description */}
			{isDM ? (
				<textarea
					value={localDescription}
					onChange={(e) => handleDescriptionChange(e.target.value)}
					className="textarea textarea-sm textarea-bordered w-full"
					rows={3}
					placeholder="Description..."
				/>
			) : (
				actor.Description && showEntityDescription && (
					<p className="text-sm opacity-70">{actor.Description}</p>
				)
			)}

			{/* Compact info line */}
			{isDM ? (
				// DM: Editable inline fields
				<div className="space-y-2">
					<div className="grid grid-cols-4 gap-x-8 text-sm justify-items-center">
						{/* Labels row */}
						<div className="font-medium">Pos:</div>
						<div className="font-medium">Size:</div>
						<div className="font-medium">Speed:</div>
						<div className="font-medium">Flying:</div>

						{/* Inputs row */}
						<div className="opacity-70 text-sm mt-1">
							({actor.Position.x}, {actor.Position.y}, {actor.Position.h})
						</div>
						<select
							value={actor.Size || "small"}
							onChange={(e) =>
								handleFieldChange("Size", e.target.value as Actor["Size"])
							}
							className="select select-sm select-bordered"
							disabled={!actionService}
						>
							<option value="extra-small">Extra Small</option>
							<option value="small">Small</option>
							<option value="medium">Medium</option>
							<option value="large">Large</option>
						</select>
						<input
							type="number"
							value={localMoveSpeed}
							onChange={(e) => handleMoveSpeedChange(Number(e.target.value))}
							className="input input-sm input-bordered"
							min={0}
							max={99}
						/>
						<input
							type="checkbox"
							checked={actor.CanFly}
							onChange={(e) => handleFieldChange("CanFly", e.target.checked)}
							className="toggle toggle-sm toggle-primary mt-1"
							disabled={!actionService}
						/>
					</div>
					<div className="flex items-center justify-center gap-3 text-sm mt-4">
						<span className="font-medium">Color</span>
						<input
							type="color"
							value={localColor}
							onChange={(e) => handleColorChange(e.target.value)}
							className="input input-bordered input-sm h-9 w-44 p-1"
							disabled={!actionService}
						/>
					</div>
				</div>
			) : (
				// Player: Compact readonly display
				<div className="text-md opacity-70 text-center">
					<div>
						Position: ({actor.Position.x}, {actor.Position.y},{" "}
						{actor.Position.h}) •{" Size: "}
						{actor.Size || "small"}
					</div>
				</div>
			)}

			{/* Attributes */}
			{showEntityAttributes && (
				<div className="pt-4 border-t border-base-300">
					<AttributesSection
						slots={actor.Attributes}
						definitions={campaign.Settings.AttributeDefinitions ?? []}
						localValues={localAttributes}
						onChange={handleAttributeChange}
						readOnly={!isDM}
						onRoll={requestRoll}
					/>
				</div>
			)}
		</div>
	);
}
