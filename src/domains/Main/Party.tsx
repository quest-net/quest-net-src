// Main/Party.tsx

import { KeyboardEvent, MouseEvent } from "react";
import { useQuestContext } from "../Context/ContextProvider";
import { useActionService } from "../../services/Actions/ActionServiceProvider";
import { CampaignActions } from "../Campaign/CampaignActions";
import { ImageDisplay } from "../Image/ImageDisplay";
import { ActionBubbles } from "../../components/ActionBubbles/ActionBubbles";
import { useMapState } from "../../components/Map/MapStateProvider";
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
import { Character } from "../Character/Character";
import { isItemEntity } from "../Item/ItemDropUtils";

interface PartyProps {
	onInspectActor: () => void;
}

export function Party({ onInspectActor }: PartyProps) {
	const context = useQuestContext();
	const { actionService } = useActionService();
	const { selectActor } = useMapState();
	const campaign = CampaignActions.getActiveCampaign(context);
	const myCharacterId = context.User.SelectedCharacters[campaign.RoomCode];
	const characters = campaign.GameState.Characters;

	const handleActionsChange = (
		characterId: string,
		updatedActions: ResolvedAction[]
	) => {
		if (!actionService) return;

		const actionSlots = updatedActions.map((action) => ({
			Id: action.Id,
			Max: action.Max,
			Current: action.Current,
		}));

		actionService.execute("character:edit", {
			characterId,
			updates: { Actions: actionSlots },
		});
	};

	const combatState = campaign.GameState.CombatState;
	const initiativeSettings = campaign.Settings.InitiativeSettings;
	const initiativeMode = initiativeSettings?.Mode ?? "party";
	const charactersHaveInitiative =
		initiativeMode === "individual" ||
		combatState.initiativeSide === "party";
	const initiativeCandidates =
		combatState.isActive && charactersHaveInitiative
			? initiativeMode === "individual"
				? [
					...characters,
					...campaign.GameState.Entities.filter(
						(entity) => !isItemEntity(entity)
					),
				]
				: characters
			: [];
	const initiativePool = initiativeCandidates.filter((actor) =>
		hasInitiativeSourceValue(actor, initiativeSettings, campaign.Settings)
	);
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
	const characterIndexById = new Map(
		characters.map((character, index) => [character.Id, index])
	);

	const displayCharacters = combatState.isActive
		? [...characters].sort((a, b) => {
			const ao = orderByActorId.get(a.Id);
			const bo = orderByActorId.get(b.Id);
			if (ao !== undefined && bo !== undefined && ao !== bo) return ao - bo;
			if (ao !== undefined && bo === undefined) return -1;
			if (ao === undefined && bo !== undefined) return 1;
			return (
				(characterIndexById.get(a.Id) ?? 0) -
				(characterIndexById.get(b.Id) ?? 0)
			);
		})
		: characters;

	const inspectCharacter = (character: Character) => {
		selectActor({
			id: character.Id,
			kind: "character",
			moveSpeed: character.MoveSpeed,
		});
		onInspectActor();
	};

	const handleCardDoubleClick = (
		event: MouseEvent<HTMLDivElement>,
		character: Character
	) => {
		if (isInteractiveCardTarget(event.target, event.currentTarget)) return;
		inspectCharacter(character);
	};

	const handleCardKeyDown = (
		event: KeyboardEvent<HTMLDivElement>,
		character: Character
	) => {
		if (isInteractiveCardTarget(event.target, event.currentTarget)) return;
		if (event.key !== "Enter" && event.key !== " ") return;
		event.preventDefault();
		inspectCharacter(character);
	};

	const handleBadgeClick = (characterId: string) => {
		if (!actionService || characterId !== myCharacterId) return;
		actionService.execute("combat:markActorTurnDone", {
			actorId: characterId,
		});
	};

	const renderInitiativeBadge = (characterId: string) => {
		const order = orderByActorId.get(characterId);
		if (order === undefined) return null;
		const isDone = roundDoneSet.has(characterId);
		const canToggle = characterId === myCharacterId;

		return (
			<button
				type="button"
				onClick={() => handleBadgeClick(characterId)}
				disabled={!canToggle}
				title={
					isDone
						? "Turn done - click to undo"
						: canToggle
							? "Click to mark turn done"
							: `Initiative ${order}`
				}
				className={`absolute top-0 left-0 w-7 h-7 rounded-tl-md rounded-br-md flex items-center justify-center text-sm font-bold z-10 ${isDone
					? "bg-base-300 text-base-content/40 line-through"
					: "bg-primary text-primary-content"
					} ${canToggle ? "cursor-pointer hover:opacity-80" : "cursor-default"}`}
			>
				{order}
			</button>
		);
	};

	if (characters.length === 0) {
		return (
			<div className="text-center py-12">
				<p className="text-xl mb-2">No characters spawned</p>
				<p className="text-base-content/60">How are you even here?</p>
			</div>
		);
	}

	return (
		<div className="space-y-4">
			<AggregateStatsSummary
				title="Party Stats"
				actors={characters}
				settings={campaign.Settings}
			/>

			<div className="space-y-2">
				{displayCharacters.map((character) => (
					<div
						key={character.Id}
						role="button"
						tabIndex={0}
						onDoubleClick={(event) => handleCardDoubleClick(event, character)}
						onKeyDown={(event) => handleCardKeyDown(event, character)}
						title="Double-click to inspect"
						className="card bg-base-100 border-2 border-base-300 relative transition-all cursor-pointer hover:border-primary focus:outline-none focus:ring-2 focus:ring-primary"
					>
						{renderInitiativeBadge(character.Id)}
						<div className="card-body p-4">
							<div className="flex gap-2 items-center">
								<div className="flex flex-col items-center w-32 shrink-0">
									<h3 className="font-bold text-lg text-center">
										{character.Name}
									</h3>
									<div className="w-32 h-32 bg-base-200 rounded-lg overflow-hidden flex items-center justify-center">
										<ImageDisplay
											imageId={character.Image}
											className="w-full h-full object-cover"
											alt={character.Name}
										/>
									</div>
								</div>

								<div className="flex-1 space-y-2">
									{resolveStats(
										character.Stats,
										campaign.Settings.StatDefinitions
									).map((stat) => {
										if (stat.Current === null) return null;
										const percentage = (stat.Current / stat.Max) * 100;

										return (
											<div key={stat.Id} className="space-y-1">
												<div className="flex items-center justify-between gap-2">
													<span className="text-sm font-medium truncate">{stat.Name}</span>
													<span className="text-sm opacity-70 shrink-0">
														{stat.Current} / {stat.Max}
													</span>
												</div>
												<div className="relative w-full h-6 bg-base-300 rounded overflow-hidden">
													<div
														className="h-full transition-all duration-150"
														style={{
															width: `${Math.max(0, Math.min(100, percentage))}%`,
															backgroundColor: stat.Color,
														}}
													/>
												</div>
											</div>
										);
									})}
								</div>
							</div>

							{character.Actions && character.Actions.length > 0 && (
								<div className="pt-2 border-t border-base-300">
									<ActionBubbles
										actions={resolveActions(
											character.Actions,
											campaign.Settings.ActionDefinitions
										)}
										onChange={(updatedActions) =>
											handleActionsChange(character.Id, updatedActions)
										}
										readonly={character.Id !== myCharacterId}
									/>
								</div>
							)}
						</div>
					</div>
				))}
			</div>
		</div>
	);
}
