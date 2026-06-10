// domains/Main/Overview.tsx

import { KeyboardEvent, MouseEvent, useState } from "react";
import { useQuestContext } from "../Context/ContextProvider";
import { useActionService } from "../../services/Actions/ActionServiceProvider";
import { CampaignActions } from "../Campaign/CampaignActions";
import { ImageDisplay } from "../Image/ImageDisplay";
import { StatBar } from "../../components/StatBar/StatBar";
import { ObjectPicker, ObjectTypeConfig } from "../../components/inputs/ObjectPicker";
import { TerrainPicker } from "../../components/inputs/TerrainPicker";
import { ActionBubbles } from "../../components/ActionBubbles/ActionBubbles";
import { useMapState } from "../../components/Map/MapStateProvider";
import { useViewedTerrain } from "../../components/Map/useViewedTerrain";
import { Actor } from "../Actor/Actor";
import {
	ResolvedAction,
	resolveActions,
	resolveStats,
} from "../../utils/ActorResolvers";
import {
	computeInitiativeOrder,
	hasInitiativeSourceValue,
} from "../../utils/InitiativeUtils";
import {
	AggregateStatsSummary,
	isInteractiveCardTarget,
} from "./ActorPanelHelpers";
import { isItemEntity } from "../Item/ItemDropUtils";
import { ToggleButton } from "../../components/ui/ToggleButton";
import { EmptyState } from "../../components/ui/EmptyState";

type OverviewFilter = "all" | "party" | "npcs" | "items";
type TerrainScope = "viewed" | "global";

interface OverviewActorEntry {
	actor: Actor;
	kind: "character" | "entity";
}

interface OverviewProps {
	onInspectActor: () => void;
}

export function Overview({ onInspectActor }: OverviewProps) {
	const context = useQuestContext();
	const { actionService } = useActionService();
	const { selectActor } = useMapState();
	const { viewedTerrainId } = useViewedTerrain();
	const campaign = CampaignActions.getActiveCampaign(context);
	const [filter, setFilter] = useState<OverviewFilter>("all");
	const [terrainScope, setTerrainScope] = useState<TerrainScope>("viewed");
	const [search, setSearch] = useState("");
	const [selectedActorIds, setSelectedActorIds] = useState<string[]>([]);
	const [showObjectPicker, setShowObjectPicker] = useState(false);
	const [showTerrainPicker, setShowTerrainPicker] = useState(false);

	const combatState = campaign.GameState.CombatState;
	const initiativeSettings = campaign.Settings.InitiativeSettings;
	const initiativeMode = initiativeSettings?.Mode ?? "party";
	const isIndividualMode = initiativeMode === "individual";
	const allEntries: OverviewActorEntry[] = [
		...campaign.GameState.Characters.map((actor) => ({
			actor,
			kind: "character" as const,
		})),
		...campaign.GameState.Entities.map((actor) => ({
			actor,
			kind: "entity" as const,
		})),
	];
	const isActingEntry = (entry: OverviewActorEntry) => {
		if (!combatState.isActive) return false;
		if (entry.kind === "entity" && isItemEntity(entry.actor)) return false;
		if (isIndividualMode) return true;
		return entry.kind === (
			combatState.initiativeSide === "enemies" ? "entity" : "character"
		);
	};
	const initiativePool = allEntries
		.filter(
			(entry) =>
				isActingEntry(entry) &&
				hasInitiativeSourceValue(
					entry.actor,
					initiativeSettings,
					campaign.Settings
				)
		)
		.map((entry) => entry.actor);
	const initiativeEntries = combatState.isActive
		? computeInitiativeOrder(
			initiativePool,
			initiativeSettings,
			campaign.Settings
		)
		: [];
	const orderByActorId = new Map(
		initiativeEntries.map((entry) => [entry.ActorId, entry.Order])
	);
	const roundDoneSet = new Set(combatState.RoundCompleted ?? []);
	const entryIndexByActorId = new Map(
		allEntries.map((entry, index) => [entry.actor.Id, index])
	);
	const sortEntriesByInitiative = (entries: OverviewActorEntry[]) => {
		if (!combatState.isActive) return entries;
		return [...entries].sort((a, b) => {
			const ao = orderByActorId.get(a.actor.Id);
			const bo = orderByActorId.get(b.actor.Id);
			if (ao !== undefined && bo !== undefined && ao !== bo) return ao - bo;
			if (ao !== undefined && bo === undefined) return -1;
			if (ao === undefined && bo !== undefined) return 1;
			return (
				(entryIndexByActorId.get(a.actor.Id) ?? 0) -
				(entryIndexByActorId.get(b.actor.Id) ?? 0)
			);
		});
	};

	const query = search.trim().toLowerCase();
	const visibleEntries = sortEntriesByInitiative(
		getVisibleEntries(filter, allEntries).filter((entry) => {
			// Terrain scope: limit to the viewed terrain unless viewing globally.
			if (
				terrainScope === "viewed" &&
				viewedTerrainId &&
				entry.actor.Position.terrainId !== viewedTerrainId
			) {
				return false;
			}
			// Name search.
			if (query && !entry.actor.Name.toLowerCase().includes(query)) {
				return false;
			}
			return true;
		})
	);
	const visibleActorIds = new Set(visibleEntries.map((entry) => entry.actor.Id));
	const visibleSelectedCount = selectedActorIds.filter((id) =>
		visibleActorIds.has(id)
	).length;
	const allVisibleSelected =
		visibleEntries.length > 0 && visibleSelectedCount === visibleEntries.length;

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

	const setActiveFilter = (next: OverviewFilter) => {
		setFilter(next);
		setSelectedActorIds([]);
	};

	const setActiveTerrainScope = (next: TerrainScope) => {
		setTerrainScope(next);
		setSelectedActorIds([]);
	};

	const inspectActor = (entry: OverviewActorEntry) => {
		selectActor({
			id: entry.actor.Id,
			kind: entry.kind,
			moveSpeed: entry.actor.MoveSpeed,
		});
		onInspectActor();
	};

	const handleCardDoubleClick = (
		event: MouseEvent<HTMLDivElement>,
		entry: OverviewActorEntry
	) => {
		if (isInteractiveCardTarget(event.target, event.currentTarget)) return;
		inspectActor(entry);
	};

	const handleCardKeyDown = (
		event: KeyboardEvent<HTMLDivElement>,
		entry: OverviewActorEntry
	) => {
		if (isInteractiveCardTarget(event.target, event.currentTarget)) return;
		if (event.key !== "Enter" && event.key !== " ") return;
		event.preventDefault();
		inspectActor(entry);
	};

	const toggleBulkSelection = (actorId: string) => {
		setSelectedActorIds((current) =>
			current.includes(actorId)
				? current.filter((id) => id !== actorId)
				: [...current, actorId]
		);
	};

	const toggleSelectVisible = () => {
		if (allVisibleSelected) {
			setSelectedActorIds([]);
			return;
		}
		setSelectedActorIds(visibleEntries.map((entry) => entry.actor.Id));
	};

	const handleGiveObjects = (
		objectIds: string[],
		objectType: string,
		count: number
	) => {
		if (!actionService || selectedActorIds.length === 0) return;

		actionService.execute(`${objectType}:give`, {
			[`${objectType}Ids`]: objectIds,
			actorIds: selectedActorIds,
			count,
		});

		setShowObjectPicker(false);
		setSelectedActorIds([]);
	};

	const handleDespawnSelected = () => {
		if (!actionService || selectedActorIds.length === 0) return;

		allEntries
			.filter((entry) => selectedActorIds.includes(entry.actor.Id))
			.forEach((entry) => {
				if (entry.kind === "character") {
					actionService.execute("character:remove", {
						characterId: entry.actor.Id,
					});
				} else {
					actionService.execute("entity:remove", { entityId: entry.actor.Id });
				}
			});

		setSelectedActorIds([]);
	};

	const handleMoveSelected = (toTerrainId: string) => {
		if (!actionService || selectedActorIds.length === 0) return;

		actionService.execute("terrain:moveActors", {
			actorIds: selectedActorIds,
			toTerrainId,
		});

		setShowTerrainPicker(false);
		setSelectedActorIds([]);
	};

	const handleStatChange = (
		entry: OverviewActorEntry,
		statId: string,
		field: "Current" | "Max",
		value: number
	) => {
		if (!actionService) return;

		const updatedStats = entry.actor.Stats.map((stat) =>
			stat.Id === statId ? { ...stat, [field]: value } : stat
		);
		const actionKey =
			entry.kind === "character" ? "character:edit" : "entity:edit";
		const idKey = entry.kind === "character" ? "characterId" : "entityId";

		actionService.execute(actionKey, {
			[idKey]: entry.actor.Id,
			updates: { Stats: updatedStats },
		});
	};

	const handleActionsChange = (
		entry: OverviewActorEntry,
		updatedActions: ResolvedAction[]
	) => {
		if (!actionService) return;

		const actionSlots = updatedActions.map((action) => ({
			Id: action.Id,
			Max: action.Max,
			Current: action.Current,
		}));
		const actionKey =
			entry.kind === "character" ? "character:edit" : "entity:edit";
		const idKey = entry.kind === "character" ? "characterId" : "entityId";

		actionService.execute(actionKey, {
			[idKey]: entry.actor.Id,
			updates: { Actions: actionSlots },
		});
	};

	const handleBadgeClick = (entry: OverviewActorEntry) => {
		if (!actionService) return;
		actionService.execute("combat:markActorTurnDone", {
			actorId: entry.actor.Id,
		});
	};

	const renderInitiativeBadge = (entry: OverviewActorEntry) => {
		const order = orderByActorId.get(entry.actor.Id);
		if (order === undefined) return null;
		const isDone = roundDoneSet.has(entry.actor.Id);

		return (
			<button
				type="button"
				onClick={() => handleBadgeClick(entry)}
				title={isDone ? "Turn done - click to undo" : "Click to mark turn done"}
				className={`absolute top-0 left-0 w-7 h-7 rounded-tl-md rounded-br-md flex items-center justify-center text-sm font-bold z-10 ${isDone
					? "bg-base-300 opacity-70 line-through"
					: "bg-primary text-primary-content"
					} cursor-pointer hover:brightness-95`}
			>
				{order}
			</button>
		);
	};

	return (
		<div className="space-y-4">
			<div className="flex flex-wrap items-center gap-2">
				<div className="join">
					{(["all", "party", "npcs", "items"] as OverviewFilter[]).map((value) => (
						<ToggleButton
							key={value}
							active={filter === value}
							onClick={() => setActiveFilter(value)}
							className="btn-sm join-item"
						>
							{getFilterLabel(value)}
						</ToggleButton>
					))}
				</div>
				<div className="join">
					{(["viewed", "global"] as TerrainScope[]).map((value) => (
						<ToggleButton
							key={value}
							active={terrainScope === value}
							onClick={() => setActiveTerrainScope(value)}
							className="btn-sm join-item"
							title={
								value === "viewed"
									? "Show actors on the terrain you are viewing"
									: "Show actors across all terrains"
							}
						>
							{value === "viewed" ? "Here" : "Global"}
						</ToggleButton>
					))}
				</div>
			</div>

			<div className="flex items-center gap-2">
				<label className="input input-sm input-bordered flex flex-1 items-center gap-2">
					<span className="icon-[mdi--magnify] h-4 w-4 opacity-70" />
					<input
						type="text"
						className="grow"
						placeholder="Search actors by name..."
						value={search}
						onChange={(e) => setSearch(e.target.value)}
					/>
					{search && (
						<button
							type="button"
							className="icon-[mdi--close] h-4 w-4 opacity-70 hover:brightness-110"
							onClick={() => setSearch("")}
							aria-label="Clear search"
						/>
					)}
				</label>
				<div className="text-sm opacity-70 shrink-0">
					{visibleEntries.length} shown
				</div>
			</div>

			<div className="card bg-base-200 border-2 border-base-300">
				<div className="card-body p-4">
					<div className="flex justify-between items-center gap-3">
						<div className="flex items-center gap-3">
							<button
								type="button"
								onClick={toggleSelectVisible}
								className="btn btn-sm btn-ghost"
								disabled={visibleEntries.length === 0}
								title={allVisibleSelected ? "Clear selection" : "Select visible actors"}
							>
								{allVisibleSelected ? (
									<span className="icon-[mdi--checkbox-marked] w-5 h-5" />
								) : (
									<span className="icon-[mdi--checkbox-blank-outline] w-5 h-5" />
								)}
							</button>
							<span className="text-sm font-medium">
								{selectedActorIds.length > 0
									? `${selectedActorIds.length} selected`
									: "Select actors"}
							</span>
						</div>
						<div className="flex items-center gap-2">
							<button
								type="button"
								onClick={() => setShowObjectPicker(true)}
								disabled={selectedActorIds.length === 0}
								className="btn btn-primary btn-sm gap-2"
							>
								<span className="icon-[mdi--gift] w-4 h-4" />
								Give Objects
							</button>
							<button
								type="button"
								onClick={handleDespawnSelected}
								disabled={selectedActorIds.length === 0}
								className="btn btn-error btn-sm gap-2"
								title="Despawn selected actors"
							>
								<span className="icon-[mdi--close-circle] w-4 h-4" />
								Despawn
							</button>
							<button
								type="button"
								onClick={() => setShowTerrainPicker(true)}
								disabled={selectedActorIds.length === 0}
								className="btn btn-secondary btn-sm gap-2"
								title="Move selected actors to another terrain"
							>
								<span className="icon-[mdi--account-arrow-right] w-4 h-4" />
								Move
							</button>
						</div>
					</div>
				</div>
			</div>

			<AggregateStatsSummary
				title="Stats"
				actors={visibleEntries.map((entry) => entry.actor)}
				settings={campaign.Settings}
			/>

			{visibleEntries.length === 0 ? (
				<EmptyState>No actors match this filter.</EmptyState>
			) : (
				<div className="space-y-2">
					{visibleEntries.map((entry) => (
						<div
							key={`${entry.kind}:${entry.actor.Id}`}
							role="button"
							tabIndex={0}
							onDoubleClick={(event) => handleCardDoubleClick(event, entry)}
							onKeyDown={(event) => handleCardKeyDown(event, entry)}
							title="Double-click to inspect"
							className={`card bg-base-100 border-2 relative transition-all cursor-pointer hover:border-primary focus:outline-none focus:ring-2 focus:ring-primary ${selectedActorIds.includes(entry.actor.Id)
								? "border-primary ring-2 ring-primary"
								: "border-base-300"
								}`}
						>
							{renderInitiativeBadge(entry)}
							<div className="card-body p-4">
								<div className="flex gap-2 items-center">
									<div className="shrink-0">
										<input
											type="checkbox"
											checked={selectedActorIds.includes(entry.actor.Id)}
											onChange={() => toggleBulkSelection(entry.actor.Id)}
											className="checkbox checkbox-primary"
											aria-label={`Select ${entry.actor.Name}`}
										/>
									</div>

									<div className="flex flex-col items-center w-32 shrink-0">
										<h3 className="font-bold text-lg text-center">
											{entry.actor.Name}
										</h3>
										<div className="w-32 h-32 bg-base-200 rounded-lg overflow-hidden flex items-center justify-center">
											<ImageDisplay
												imageId={entry.actor.Image}
												className="w-full h-full object-cover"
												alt={entry.actor.Name}
											/>
										</div>
									</div>

									<div className="flex-1 space-y-2" data-card-action>
										{resolveStats(
											entry.actor.Stats,
											campaign.Settings.StatDefinitions
										).map((stat) => (
											<StatBar
												key={stat.Id}
												stat={stat}
												editingMax={false}
												onCurrentChange={(value) =>
													handleStatChange(entry, stat.Id, "Current", value)
												}
												onMaxChange={(value) =>
													handleStatChange(entry, stat.Id, "Max", value)
												}
											/>
										))}
									</div>
								</div>

								<div className="pt-2 border-t border-base-300 flex items-center justify-between gap-3">
									{entry.actor.Actions && entry.actor.Actions.length > 0 ? (
										<div className="min-w-0 flex-1" data-card-action>
											<ActionBubbles
												actions={resolveActions(
													entry.actor.Actions,
													campaign.Settings.ActionDefinitions
												)}
												onChange={(updatedActions) =>
													handleActionsChange(entry, updatedActions)
												}
											/>
										</div>
									) : (
										<div />
									)}
									<span
										className={`badge badge-sm shrink-0 ${entry.kind === "character" ? "badge-primary" : "badge-error"}`}
									>
										{entry.kind === "character" ? "Party" : "NPC"}
									</span>
								</div>
							</div>
						</div>
					))}
				</div>
			)}

			<ObjectPicker
				isOpen={showObjectPicker}
				types={objectTypes}
				multiSelect={true}
				showCount={true}
				onConfirm={handleGiveObjects}
				onCancel={() => setShowObjectPicker(false)}
				title="Give Objects to Selected Actors"
			/>

			<TerrainPicker
				isOpen={showTerrainPicker}
				currentTerrainId={viewedTerrainId ?? undefined}
				onConfirm={handleMoveSelected}
				onCancel={() => setShowTerrainPicker(false)}
				title={`Move ${selectedActorIds.length} actor(s) to…`}
			/>
		</div>
	);
}

function getVisibleEntries(
	filter: OverviewFilter,
	entries: OverviewActorEntry[]
): OverviewActorEntry[] {
	const isItemDrop = (entry: OverviewActorEntry) =>
		entry.kind === "entity" && isItemEntity(entry.actor);

	switch (filter) {
		case "party":
			return entries.filter((entry) => entry.kind === "character");
		case "npcs":
			return entries.filter(
				(entry) => entry.kind === "entity" && !isItemDrop(entry)
			);
		case "items":
			return entries.filter((entry) => isItemDrop(entry));
		case "all":
		default:
			// Everything except item drops, which have their own filter.
			return entries.filter((entry) => !isItemDrop(entry));
	}
}

function getFilterLabel(filter: OverviewFilter): string {
	switch (filter) {
		case "all":
			return "All";
		case "party":
			return "Party";
		case "npcs":
			return "NPCs";
		case "items":
			return "Items";
	}
}
