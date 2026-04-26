// domains/Combat/CombatDisplay.tsx

import { useState } from "react";
import { useQuestContext } from "../Context/ContextProvider";
import { useActionService } from "../../services/Actions/ActionServiceProvider";
import { CampaignActions } from "../Campaign/CampaignActions";
import {
	computeInitiativeOrder,
	getActiveOrder,
} from "../../utils/InitiativeUtils";
import { InitiativeSettingsEditor } from "../../components/inputs/InitiativeSettingsEditor";
import { CampaignSettings } from "../CampaignSetting/CampaignSetting";

export function CombatDisplay() {
	const context = useQuestContext();
	const { actionService } = useActionService();
	const campaign = CampaignActions.getActiveCampaign(context);
	const isDM = context.User.Role === "dm";
	const isInteractive = isDM && !!actionService;
	const [showInitiativeModal, setShowInitiativeModal] = useState(false);

	const combatState = campaign.GameState.CombatState;

	// Active-actor banner: lowest-Order party member(s) whose turn isn't done.
	// Computed live from the same utility the Party tab uses, so they stay in
	// sync without a stored snapshot.
	const partyInitiative = combatState.isActive
		? computeInitiativeOrder(
			campaign.GameState.Characters,
			campaign.Settings.InitiativeSettings,
			campaign.Settings
		)
		: [];
	const activeOrder = getActiveOrder(
		partyInitiative,
		combatState.PartyTurnsCompleted
	);
	const activePartyNames =
		activeOrder !== null
			? partyInitiative
				.filter((e) => e.Order === activeOrder)
				.map((e) => {
					const character = campaign.GameState.Characters.find(
						(c) => c.Id === e.ActorId
					);
					return character?.Name ?? "Unknown";
				})
			: [];
	const showPartyTurnBanner =
		combatState.isActive &&
		combatState.initiativeSide === "party" &&
		partyInitiative.length > 0;

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

	const handleEndCombat = () => {
		if (!isInteractive) return;
		actionService.execute("combat:end", {});
	};

	const handleIncrementTurn = () => {
		if (!isInteractive) return;
		actionService.execute("combat:incrementTurn", {});
	};

	const handleDecrementTurn = () => {
		if (!isInteractive) return;
		actionService.execute("combat:decrementTurn", {});
	};

	const handleSetInitiative = (side: "party" | "enemies") => {
		if (!isInteractive) return;
		actionService.execute("combat:setInitiativeSide", { side });
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
					<div className="text-3xl font-bold">Turn {combatState.currentTurn}</div>
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
					{showPartyTurnBanner && activePartyNames.length > 0 && (
						<div className="text-lg">
							It is now <span className="font-semibold">{activePartyNames.join(" or ")}</span>'s turn
						</div>
					)}
					{showPartyTurnBanner && activePartyNames.length === 0 && (
						<div className="text-sm opacity-60">
							All party members have acted this turn.
						</div>
					)}
				</div>
			</div>
		);
	}

	// =========================================================================
	// DM VIEW
	// =========================================================================
	if (!combatState.isActive) {
		return (
			<div className="h-full flex items-center justify-center">
				<div className="text-center space-y-4">
					<div className="text-4xl">⚔️</div>
					<p className="text-lg">Combat is not active</p>
					<div className="flex gap-2 justify-center">
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
					</div>
				</div>
			</div>
		);
	}

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

			<div className="text-center space-y-4">
				{/* Turn Counter with controls on sides */}
				<div className="flex items-center justify-center gap-3">
					<button
						onClick={handleDecrementTurn}
						disabled={!isInteractive || combatState.currentTurn <= 1}
						className="btn btn-circle btn-sm"
						title="Previous turn"
					>
						<span className="icon-[mdi--chevron-left] w-5 h-5" />
					</button>
					<div className="text-4xl font-bold min-w-32">
						Turn {combatState.currentTurn}
					</div>
					<button
						onClick={handleIncrementTurn}
						disabled={!isInteractive}
						className="btn btn-circle btn-sm"
						title="Next turn"
					>
						<span className="icon-[mdi--chevron-right] w-5 h-5" />
					</button>
				</div>

				{/* Active actor banner — lowest-order party member not yet done. */}
				{showPartyTurnBanner && activePartyNames.length > 0 && (
					<div className="text-lg">
						It is now <span className="font-semibold">{activePartyNames.join(" or ")}</span>'s turn
					</div>
				)}
				{showPartyTurnBanner && activePartyNames.length === 0 && (
					<div className="text-sm opacity-60">
						All party members have acted this turn.
					</div>
				)}

				{/* Initiative buttons */}
				<div className="flex gap-2 justify-center">
					<button
						onClick={() => handleSetInitiative("party")}
						className={`btn btn-sm gap-1 ${
							combatState.initiativeSide === "party"
								? "btn-primary"
								: "btn-outline"
						}`}
						disabled={!isInteractive}
					>
						<span className="icon-[mdi--shield-account] w-4 h-4" />
						Party
					</button>
					<button
						onClick={() => handleSetInitiative("enemies")}
						className={`btn btn-sm gap-1 ${
							combatState.initiativeSide === "enemies"
								? "btn-error"
								: "btn-outline"
						}`}
						disabled={!isInteractive}
					>
						<span className="icon-[mdi--skull] w-4 h-4" />
						Enemies
					</button>
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

			{/* Initiative settings modal — same data as the global Settings page,
			    just a faster entry point during combat. */}
			{showInitiativeModal && (
				<div className="modal modal-open">
					<div className="modal-box">
						<h3 className="font-bold text-lg mb-2">Initiative Settings</h3>
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
						/>
						<div className="modal-action">
							<button
								className="btn"
								onClick={() => setShowInitiativeModal(false)}
							>
								Done
							</button>
						</div>
					</div>
					<div
						className="modal-backdrop"
						onClick={() => setShowInitiativeModal(false)}
					/>
				</div>
			)}
		</div>
	);
}
