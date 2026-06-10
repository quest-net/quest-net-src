// domains/Combat/CombatDisplay.tsx

import { useState } from "react";
import { useQuestContext } from "../Context/ContextProvider";
import { useActionService } from "../../services/Actions/ActionServiceProvider";
import { CampaignActions } from "../Campaign/CampaignActions";
import {
	computeInitiativeOrder,
	getActiveOrder,
	hasInitiativeSourceValue,
} from "../../utils/InitiativeUtils";
import { InitiativeSettingsEditor } from "../../components/inputs/InitiativeSettingsEditor";
import { CampaignSettings } from "../CampaignSetting/CampaignSetting";
import { Modal } from "../../components/ui/Modal";
import { isItemEntity } from "../Item/ItemDropUtils";

export function CombatDisplay() {
	const context = useQuestContext();
	const { actionService } = useActionService();
	const campaign = CampaignActions.getActiveCampaign(context);
	const isDM = context.User.Role === "dm";
	const isInteractive = isDM && !!actionService;
	const [showInitiativeModal, setShowInitiativeModal] = useState(false);

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
		: combatState.initiativeSide === "enemies"
			? campaign.GameState.Entities
			: campaign.GameState.Characters;
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
	const activeActorNames =
		activeOrder !== null
			? initiativeEntries
				.filter((e) => e.Order === activeOrder)
				.map((e) => allActors.find((a) => a.Id === e.ActorId)?.Name ?? "Unknown")
			: [];
	// When many actors share the same initiative order, the "A or B or C or D
	// or E..." banner gets unwieldy. Cap the list at three names and append
	// "etc." to keep the banner readable.
	const ACTIVE_NAME_DISPLAY_LIMIT = 3;
	const activeActorNamesDisplay =
		activeActorNames.length > ACTIVE_NAME_DISPLAY_LIMIT
			? activeActorNames.slice(0, ACTIVE_NAME_DISPLAY_LIMIT).join(" or ") + ", etc."
			: activeActorNames.join(" or ");
	// Banner is shown whenever there's an initiative chain for the current
	// acting pool. In party mode that's the party (party round) or entities
	// (enemy round); in individual mode it's the whole group.
	const showActiveBanner =
		combatState.isActive && initiativeEntries.length > 0;

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
			<div className="h-full flex items-center justify-center">
				<div className="text-center space-y-3">
					<div className="text-3xl font-bold">Round {combatState.currentRound}</div>
					{!isIndividualMode && (
						<div>
							<span
								className={`badge badge-lg ${
									combatState.initiativeSide === "party"
										? "badge-primary"
										: "badge-error"
								}`}
							>
								{combatState.initiativeSide === "party" ? "Party" : "Enemies"} Initiative
							</span>
						</div>
					)}
					{showActiveBanner && activeActorNames.length > 0 && (
						<div className="text-lg">
							It is now <span className="font-semibold">{activeActorNamesDisplay}</span>'s turn
						</div>
					)}
					{showActiveBanner && activeActorNames.length === 0 && (
						<div className="text-sm opacity-70">
							{isIndividualMode
								? "All actors have acted this round."
								: combatState.initiativeSide === "enemies"
									? "All enemies have acted this round."
									: "All party members have acted this round."}
						</div>
					)}
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
	return (
		<div className="h-full flex items-center justify-center relative">
			{/* Floating gear: opens the inline initiative settings modal.
			    Positioned absolutely so it doesn't shift the centered controls. */}
			<button
				onClick={() => setShowInitiativeModal(true)}
				disabled={!isInteractive}
				className="absolute top-2 right-2 btn btn-circle btn-sm btn-ghost"
				title="Initiative settings"
			>
				<span className="icon-[mdi--cog] w-5 h-5" />
			</button>

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
				<div className="text-center space-y-4">
					{/* Round counter with controls on sides */}
					<div className="flex items-center justify-center gap-3">
						<button
							onClick={handleDecrementRound}
							disabled={!isInteractive || combatState.currentRound <= 1}
							className="btn btn-circle btn-sm"
							title="Previous round"
						>
							<span className="icon-[mdi--chevron-left] w-5 h-5" />
						</button>
						<div className="text-4xl font-bold min-w-32">
							Round {combatState.currentRound}
						</div>
						<button
							onClick={handleIncrementRound}
							disabled={!isInteractive}
							className="btn btn-circle btn-sm"
							title="Next round"
						>
							<span className="icon-[mdi--chevron-right] w-5 h-5" />
						</button>
					</div>

					{/* Active actor banner -- lowest-order actor not yet done. */}
					{showActiveBanner && activeActorNames.length > 0 && (
						<div className="text-lg">
							It is now <span className="font-semibold">{activeActorNamesDisplay}</span>'s turn
						</div>
					)}
					{showActiveBanner && activeActorNames.length === 0 && (
						<div className="text-sm opacity-70">
							{isIndividualMode
								? "All actors have acted this round."
								: combatState.initiativeSide === "enemies"
									? "All enemies have acted this round."
									: "All party members have acted this round."}
						</div>
					)}

					{/* Current side and combat controls. The side badge is meaningless
					    in individual mode (no sides) so we hide it there. */}
					<div className="flex gap-2 justify-center items-center">
						{!isIndividualMode && (
							<span
								className={`badge badge-lg gap-1 ${
									combatState.initiativeSide === "party"
										? "badge-primary"
										: "badge-error"
								}`}
							>
								<span
									className={`w-4 h-4 ${
										combatState.initiativeSide === "party"
											? "icon-[mdi--shield-account]"
											: "icon-[mdi--skull]"
									}`}
								/>
								{combatState.initiativeSide === "party" ? "Party" : "Enemies"} Initiative
							</span>
						)}
						<button
							onClick={handleEndCombat}
							className="btn btn-sm btn-neutral gap-1"
							disabled={!isInteractive}
							title="End combat"
						>
							<span className="icon-[mdi--stop] w-4 h-4" />
							End
						</button>
					</div>
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
