// domains/Combat/CombatDisplay.tsx

import { useState } from "react";
import { useQuestContext } from "../Context/ContextProvider";
import { useActionService } from "../../services/Actions/ActionServiceProvider";
import { CampaignUtils } from "../Campaign/CampaignUtils";
import {
	computeInitiativeOrder,
	getActiveOrder,
	hasInitiativeSourceValue,
} from "./InitiativeUtils";
import { InitiativeSettingsEditor } from "../../components/editors/InitiativeSettingsEditor";
import { CampaignSettings } from "../CampaignSetting/CampaignSetting";
import { Modal } from "../../components/ui/Modal";
import { isItemEntity } from "../Item/ItemDropUtils";
import { getSideActors } from "./CombatUtils";
import { isActorVisibleToUser, redactActorName } from "../Actor/ActorVisibilityUtils";
import { userControlsActorId } from "../Actor/ActorOwnershipUtils";
import { useOutOfSightActorIds } from "../../components/Map/useOutOfSightActorIds";

export function CombatDisplay() {
	const context = useQuestContext();
	const { actionService } = useActionService();
	const campaign = CampaignUtils.getActiveCampaign(context);
	const isDM = context.User.Role === "dm";
	const isInteractive = isDM && !!actionService;
	const [showInitiativeModal, setShowInitiativeModal] = useState(false);
	const outOfSight = useOutOfSightActorIds();

	const combatState = campaign.GameState.CombatState;
	const initiativeSettings = campaign.Settings.InitiativeSettings;
	const mode = initiativeSettings?.Mode ?? "party";
	const isIndividualMode = mode === "individual";

	// Active-actor banner: lowest-Order actor(s) whose turn isn't done.
	// The pool follows mode + side: in individual mode it's everyone; in party
	// mode it's whichever side currently has initiative. Computed live from
	// the same utility the Party/Overview tabs use so they stay in sync.
	const bannerCandidates = isIndividualMode
		? [...campaign.GameState.Characters, ...campaign.GameState.Entities]
		: getSideActors(campaign, combatState.initiativeSide);
	const bannerPool = bannerCandidates.filter(
		(actor) =>
			!isItemEntity(actor) &&
			hasInitiativeSourceValue(actor, initiativeSettings, campaign.Settings)
	);
	const initiativeEntries = combatState.isActive
		? computeInitiativeOrder(
			bannerPool,
			initiativeSettings,
			campaign.Settings
		)
		: [];
	const activeOrder = getActiveOrder(
		initiativeEntries,
		combatState.RoundCompleted
	);
	const allActors = [
		...campaign.GameState.Characters,
		...campaign.GameState.Entities,
	];
	const activeActorIds =
		activeOrder !== null
			? initiativeEntries
				.filter((e) => e.Order === activeOrder)
				.map((e) => e.ActorId)
			: [];
	const activeActorNames = activeActorIds.map((id) => {
		const actor = allActors.find((a) => a.Id === id);
		if (!actor) return "Unknown";
		// Actors a player can't see (hidden or out of sight) still take
		// turns; players see a redacted name of the same length.
		return isActorVisibleToUser(actor, context.User, campaign.RoomCode, outOfSight)
			? actor.Name
			: redactActorName(actor.Name);
	});
	// Many actors can share an order (a whole party often does): show three
	// names, then "and N more".
	const ACTIVE_NAME_DISPLAY_LIMIT = 3;
	const shownNames =
		activeActorNames.length > ACTIVE_NAME_DISPLAY_LIMIT
			? [
				...activeActorNames.slice(0, ACTIVE_NAME_DISPLAY_LIMIT),
				`${activeActorNames.length - ACTIVE_NAME_DISPLAY_LIMIT} more`,
			]
			: activeActorNames;
	// "A", "A and B", "A, B and C", "A, B, C and 2 more"
	const activeActorNamesDisplay =
		shownNames.length > 1
			? `${shownNames.slice(0, -1).join(", ")} and ${shownNames[shownNames.length - 1]}`
			: (shownNames[0] ?? "");
	// Banner is shown whenever there's an initiative chain for the current
	// acting pool. In party mode that's the party (party round) or entities
	// (enemy round); in individual mode it's the whole group.
	const showActiveBanner =
		combatState.isActive && initiativeEntries.length > 0;
	// The DM controls everyone, so the cue is for players only.
	const isMyTurn =
		!isDM &&
		showActiveBanner &&
		activeActorIds.some((id) => userControlsActorId(context.User, campaign, id));
	const isPartySide = combatState.initiativeSide === "party";

	// Turn card, shared by the DM and player views: a full-width strip whose
	// accent colour and icon carry the side, so no separate side badge is needed.
	const turnHeadline = isIndividualMode
		? activeActorNames.length === 1
			? `${activeActorNamesDisplay}'s turn`
			: "Tied turn"
		: isPartySide
			? "Party's turn"
			: "Enemies' turn";
	const turnDetail = !showActiveBanner
		? "No one has an initiative value yet."
		: activeActorNames.length === 0
			? isIndividualMode
				? "Everyone has acted this round."
				: isPartySide
					? "All party members have acted this round."
					: "All enemies have acted this round."
			: isIndividualMode && activeActorNames.length === 1
				? null
				: `Up now: ${activeActorNamesDisplay}`;
	const accent = isIndividualMode
		? "border-base-content/30"
		: isPartySide
			? "border-primary"
			: "border-error";
	const turnCard = (
		<div
			className={`flex items-center gap-3 rounded-lg border-l-4 bg-base-200 px-4 py-3 text-left ${accent}`}
		>
			<span
				className={`w-7 h-7 shrink-0 ${
					isIndividualMode
						? "icon-[mdi--sword-cross]"
						: isPartySide
							? "icon-[mdi--shield-account] text-primary"
							: "icon-[mdi--skull] text-error"
				}`}
			/>
			<div className="min-w-0 flex-1">
				<div className="text-lg font-semibold leading-tight">{turnHeadline}</div>
				{turnDetail && (
					<div className="text-sm opacity-70 truncate" title={turnDetail}>
						{turnDetail}
					</div>
				)}
			</div>
			{isMyTurn && (
				<span className="badge badge-success gap-1 font-semibold shrink-0">
					<span className="icon-[mdi--account-arrow-right] w-4 h-4" />
					Your turn
				</span>
			)}
		</div>
	);

	const handleSaveInitiative = (
		next: CampaignSettings["InitiativeSettings"]
	) => {
		if (!isInteractive) return;
		actionService.execute("setting:edit", {
			updates: { InitiativeSettings: next },
		});
	};

	const handleStartCombat = (startingSide: "party" | "enemies") => {
		if (!isInteractive) return;
		actionService.execute("combat:start", { startingSide });
	};

	const handleIncrementRound = () => {
		if (!isInteractive) return;
		actionService.execute("combat:incrementRound", {});
	};

	const handleDecrementRound = () => {
		if (!isInteractive) return;
		actionService.execute("combat:decrementRound", {});
	};

	const handleEndCombat = () => {
		if (!isInteractive) return;
		actionService.execute("combat:end", {});
	};

	// =========================================================================
	// PLAYER VIEW
	// =========================================================================
	if (!isDM) {
		if (!combatState.isActive) {
			return (
				<div className="text-center h-full flex items-center justify-center">
					<div>
						<div className="text-4xl mb-2">⚔️</div>
						<p className="text-lg">Not currently in combat</p>
					</div>
				</div>
			);
		}

		return (
			<div className="h-full flex items-center justify-center p-4">
				<div className="w-full max-w-xl space-y-3">
					<div className="text-2xl font-bold">Round {combatState.currentRound}</div>
					{turnCard}
				</div>
			</div>
		);
	}

	// =========================================================================
	// DM VIEW
	// =========================================================================
	// The DM always gets the floating gear + initiative settings modal, even
	// before combat starts, so initiative can be configured up front. The
	// inner content switches between the "not active" prompt and the active
	// combat controls.
	const settingsButton = (
		<button
			onClick={() => setShowInitiativeModal(true)}
			disabled={!isInteractive}
			className="btn btn-circle btn-sm btn-ghost"
			title="Initiative settings"
			aria-label="Initiative settings"
		>
			<span className="icon-[mdi--cog] w-5 h-5" />
		</button>
	);

	return (
		<div className="h-full flex items-center justify-center relative p-4">
			{/* Before combat the gear floats so the centered prompt stays centered;
			    during combat it sits in the header row with End. */}
			{!combatState.isActive && (
				<div className="absolute top-2 right-2">{settingsButton}</div>
			)}

			{!combatState.isActive ? (
				<div className="text-center space-y-4">
					<div className="text-4xl">⚔️</div>
					<p className="text-lg">Combat is not active</p>
					<div className="flex gap-2 justify-center">
						{isIndividualMode ? (
							// Individual mode has no "starting side" — everyone shares the
							// round — so we just offer a single Start button. The handler
							// still records initiativeSide internally on the combat state.
							<button
								onClick={() => handleStartCombat("party")}
								className="btn btn-sm btn-primary gap-1"
								disabled={!isInteractive}
							>
								<span className="icon-[mdi--sword-cross] w-4 h-4" />
								Start Combat
							</button>
						) : (
							<>
								<button
									onClick={() => handleStartCombat("party")}
									className="btn btn-sm btn-primary gap-1"
									disabled={!isInteractive}
								>
									<span className="icon-[mdi--shield-account] w-4 h-4" />
									Start (Party)
								</button>
								<button
									onClick={() => handleStartCombat("enemies")}
									className="btn btn-sm btn-error gap-1"
									disabled={!isInteractive}
								>
									<span className="icon-[mdi--skull] w-4 h-4" />
									Start (Enemies)
								</button>
							</>
						)}
					</div>
				</div>
			) : (
				<div className="w-full max-w-xl space-y-3">
					{/* Header: round stepper left, combat controls right. */}
					<div className="flex items-center justify-between gap-3">
						<div className="flex items-center gap-2">
							<button
								onClick={handleDecrementRound}
								disabled={!isInteractive || combatState.currentRound <= 1}
								className="btn btn-circle btn-sm"
								title="Previous round"
								aria-label="Previous round"
							>
								<span className="icon-[mdi--chevron-left] w-5 h-5" />
							</button>
							<div className="text-2xl font-bold whitespace-nowrap">
								Round {combatState.currentRound}
							</div>
							<button
								onClick={handleIncrementRound}
								disabled={!isInteractive}
								className="btn btn-circle btn-sm"
								title="Next round"
								aria-label="Next round"
							>
								<span className="icon-[mdi--chevron-right] w-5 h-5" />
							</button>
						</div>
						<div className="flex items-center gap-1">
							<button
								onClick={handleEndCombat}
								className="btn btn-sm btn-neutral gap-1"
								disabled={!isInteractive}
								title="End combat"
							>
								<span className="icon-[mdi--stop] w-4 h-4" />
								End
							</button>
							{settingsButton}
						</div>
					</div>

					{turnCard}
				</div>
			)}

			{/* Initiative settings modal -- same data as the global Settings page,
			    just a faster entry point during combat. */}
			{showInitiativeModal && (
				<Modal
					title="Initiative Settings"
					onClose={() => setShowInitiativeModal(false)}
					actions={
						<button
							className="btn"
							onClick={() => setShowInitiativeModal(false)}
						>
							Done
						</button>
					}
				>
					<p className="text-sm opacity-70 mb-4">
						Changes apply immediately and stay saved in Campaign Settings.
					</p>
					<InitiativeSettingsEditor
						value={campaign.Settings.InitiativeSettings}
						statDefinitions={campaign.Settings.StatDefinitions}
						attributeDefinitions={
							campaign.Settings.AttributeDefinitions ?? []
						}
						onChange={handleSaveInitiative}
						readOnly={!isInteractive}
						lockMode={combatState.isActive}
					/>
				</Modal>
			)}
		</div>
	);
}
