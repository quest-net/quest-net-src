// components/editors/OwnerEditor.tsx
//
// Controlled editor for Actor.OwnerId (owned actors, see ActorOwnershipUtils).
// Offers only characters allowed to own `actorId`. "" means no owner -- an
// empty string survives every transport, where `undefined` would be dropped.

import { useState } from "react";
import { useQuestContext } from "../../domains/Context/ContextProvider";
import { CampaignUtils } from "../../domains/Campaign/CampaignUtils";
import {
	getOwnerCandidates,
	ownsActors,
} from "../../domains/Actor/ActorOwnershipUtils";
import { ActorPicker } from "../pickers/ActorPicker";

interface OwnerEditorProps {
	/** The actor being owned (spawned actor, roster character, or template). */
	actorId: string;
	value?: string;
	onChange: (ownerId: string) => void;
	disabled?: boolean;
	readOnly?: boolean;
}

export function OwnerEditor({ actorId, value, onChange, disabled, readOnly }: OwnerEditorProps) {
	const context = useQuestContext();
	const campaign = CampaignUtils.getActiveCampaign(context);
	const [isPicking, setIsPicking] = useState(false);

	const owner = [...campaign.GameState.Characters, ...campaign.CharacterRoster].find(
		(c) => c.Id === value
	);
	const blockedReason = ownsActors(campaign, actorId)
		? "This actor owns others, so it can't be owned"
		: null;
	const locked = disabled || readOnly;

	return (
		<div className="flex items-center gap-2">
			<span className={owner ? "font-medium" : "opacity-70"}>
				{owner?.Name ?? (value ? "Unknown character" : "No owner")}
			</span>
			{!locked && (
				<>
					<button
						type="button"
						className="btn btn-sm"
						disabled={!!blockedReason}
						title={blockedReason ?? "Choose the character whose player controls this actor"}
						onClick={() => setIsPicking(true)}
					>
						{owner ? "Change" : "Set owner"}
					</button>
					{value && (
						<button
							type="button"
							className="btn btn-sm btn-ghost"
							onClick={() => onChange("")}
						>
							Clear
						</button>
					)}
				</>
			)}
			{isPicking && (
				<ActorPicker
					isOpen
					title="Choose owner"
					candidates={getOwnerCandidates(campaign, actorId)}
					onConfirm={(ownerId) => {
						setIsPicking(false);
						onChange(ownerId);
					}}
					onCancel={() => setIsPicking(false)}
				/>
			)}
		</div>
	);
}
