// domains/Character/CharacterSheet.tsx

import { useState, useEffect, useRef } from "react";
import { useQuestContext } from "../Context/ContextProvider";
import { useActionService } from "../../services/Actions/ActionServiceProvider";
import { CampaignActions } from "../Campaign/CampaignActions";
import { Character } from "./Character";
import { ImagePicker } from "../../components/inputs/ImagePicker";
import { StatBar } from "../../components/StatBar/StatBar";
import { ActionBubbles } from "../../components/ActionBubbles/ActionBubbles";
import { ActorPicker } from "../../components/inputs/ActorPicker";
import { AttributesSection } from "../../components/AttributesSection/AttributesSection";
import { useDiceRoller } from "../../components/Dice/DiceRollerContext";
import { ACTOR_DEFAULT_COLORS } from "../Actor/Actor";
import {
	ResolvedAction,
	ResolvedStat,
	resolveStats,
	resolveActions,
} from "../../utils/ActorResolvers";

export function CharacterSheet() {
	const context = useQuestContext();
	const { actionService } = useActionService();
	const { requestRoll } = useDiceRoller();
	const campaign = CampaignActions.getActiveCampaign(context);

	const [editingMaxStats, setEditingMaxStats] = useState(false);
	const [transferStat, setTransferStat] = useState<ResolvedStat | null>(null);

	// Get the selected character for this campaign
	const selectedCharacterId =
		context.User.SelectedCharacters[campaign.RoomCode];
	const character = campaign.GameState.Characters.find(
		(c) => c.Id === selectedCharacterId
	);

	// Local state for debounced fields
	const [localName, setLocalName] = useState("");
	const [localDescription, setLocalDescription] = useState("");
	const [localCritMessage, setLocalCritMessage] = useState("");
	const [localAttributes, setLocalAttributes] = useState<Map<string, string>>(
		new Map()
	);

	// Debounce timers
	const nameTimer = useRef<NodeJS.Timeout | null>(null);
	const descTimer = useRef<NodeJS.Timeout | null>(null);
	const critTimer = useRef<NodeJS.Timeout | null>(null);
	const attrTimer = useRef<NodeJS.Timeout | null>(null);

	// Initialize local state when character loads
	useEffect(() => {
		if (character) {
			setLocalName(character.Name);
			setLocalDescription(character.Description || "");
			setLocalCritMessage(character.CritMessage || "");
			setLocalAttributes(
				new Map(character.Attributes.map((attr) => [attr.Id, attr.Value]))
			);
		}
	}, [character?.Id]);

	if (!character) {
		return (
			<div className="text-center text-sm opacity-60">
				No character selected
			</div>
		);
	}

	const handleFieldChange = (field: keyof Character, value: any) => {
		if (!actionService) return;

		actionService.execute("character:edit", {
			characterId: character.Id,
			updates: { [field]: value },
		});
	};

	const handleNameChange = (value: string) => {
		setLocalName(value);

		if (nameTimer.current) clearTimeout(nameTimer.current);
		nameTimer.current = setTimeout(() => {
			handleFieldChange("Name", value);
		}, 500);
	};

	const handleDescriptionChange = (value: string) => {
		setLocalDescription(value);

		if (descTimer.current) clearTimeout(descTimer.current);
		descTimer.current = setTimeout(() => {
			handleFieldChange("Description", value);
		}, 500);
	};

	const handleCritMessageChange = (value: string) => {
		const truncated = value.slice(0, 50);
		setLocalCritMessage(truncated);

		if (critTimer.current) clearTimeout(critTimer.current);
		critTimer.current = setTimeout(() => {
			handleFieldChange("CritMessage", truncated || undefined);
		}, 500);
	};

	const handleStatChange = (statId: string, field: "Current" | "Max", value: number) => {
		if (!actionService) return;

		const updatedStats = character.Stats.map((stat) =>
			stat.Id === statId ? { ...stat, [field]: value } : stat
		);

		actionService.execute("character:edit", {
			characterId: character.Id,
			updates: { Stats: updatedStats },
		});
	};

	const handleAttributeChange = (id: string, value: string) => {
		setLocalAttributes((prev) => new Map(prev).set(id, value));

		if (attrTimer.current) clearTimeout(attrTimer.current);
		attrTimer.current = setTimeout(() => {
			if (!actionService) return;

			const updatedAttributes = character.Attributes.map((attr) =>
				attr.Id === id ? { ...attr, Value: value } : attr
			);

			actionService.execute("character:edit", {
				characterId: character.Id,
				updates: { Attributes: updatedAttributes },
			});
		}, 500);
	};

	const handleActionsChange = (updatedActions: ResolvedAction[]) => {
		if (!actionService) return;

		const actionSlots = updatedActions.map((a) => ({
			Id: a.Id,
			Max: a.Max,
			Current: a.Current,
		}));

		actionService.execute("character:edit", {
			characterId: character.Id,
			updates: { Actions: actionSlots },
		});
	};

	return (
		<div className="space-y-1">
			{/* Image & Name */}
			<div className="flex gap-4 items-start">
				<div className="max-w-60">
					<ImagePicker
						value={character.Image}
						onChange={(imageId) => {
							handleFieldChange("Image", imageId);
						}}></ImagePicker>
				</div>
				<div className="flex-1 space-y-2">
					<input
						type="text"
						value={localName}
						onChange={(e) => handleNameChange(e.target.value)}
						className="input input-bordered text-2xl font-bold w-full"
						placeholder="Character Name"
					/>
					{/* Description */}
					<textarea
						value={localDescription}
						onChange={(e) => handleDescriptionChange(e.target.value)}
						className="textarea textarea-bordered w-full"
						rows={6}
						placeholder="Character description..."
					/>
				</div>
			</div>

			{/* Stats */}
			<div className="space-y-2">
				<div className="flex items-center justify-between">
					<div></div>
					<button
						className={`btn btn-sm btn-circle ${editingMaxStats ? "btn-primary" : "btn-ghost"
							}`}
						onClick={() => setEditingMaxStats(!editingMaxStats)}
						title={editingMaxStats ? "Hide max stat controls" : "Edit max stats"}
					>
						<span className="icon-[mdi--cog] w-4 h-4" />
					</button>
				</div>

				<div className="space-y-3">
					{resolveStats(
						character.Stats,
						campaign.Settings.StatDefinitions
					).map((stat) => (
						<StatBar
							key={stat.Id}
							stat={stat}
							editingMax={editingMaxStats}
							onCurrentChange={(value) =>
								handleStatChange(stat.Id, "Current", value)
							}
							onMaxChange={(value) => handleStatChange(stat.Id, "Max", value)}
							onTransfer={() => setTransferStat(stat)}
						/>
					))}
				</div>
			</div>

			{/* Actions */}
			{character.Actions && character.Actions.length > 0 && (
				<div className="pt-2">
					<ActionBubbles
						actions={resolveActions(
							character.Actions,
							campaign.Settings.ActionDefinitions
						)}
						onChange={handleActionsChange}
					/>
				</div>
			)}

			{/* Token details */}
			<div className="grid grid-cols-1 md:grid-cols-3 gap-4">
				<div>
					<label className="label">
						<span className="label-text">Move Speed</span>
					</label>
					<input
						type="number"
						value={character.MoveSpeed}
						onChange={(e) =>
							handleFieldChange("MoveSpeed", Number(e.target.value))
						}
						className="input input-bordered w-full"
						min={0}
						max={99}
					/>
				</div>
				<div>
					<label className="label">
						<span className="label-text">Can Fly</span>
					</label>
					<div className="flex items-center">
						<input
							type="checkbox"
							checked={character.CanFly}
							onChange={(e) => handleFieldChange("CanFly", e.target.checked)}
							className="toggle toggle-primary toggle-lg"
						/>
					</div>
				</div>
				<div>
					<label className="label">
						<span className="label-text w-24">Token Color</span>
					</label>
					<input
						type="color"
						value={character.Color ?? ACTOR_DEFAULT_COLORS.CHARACTER}
						onChange={(e) => handleFieldChange("Color", e.target.value)}
						className="input input-bordered h-10 p-1"
					/>
				</div>
			</div>

			{/* Attributes */}
			<div className="pt-4 border-t border-base-300">
				<AttributesSection
					slots={character.Attributes}
					definitions={campaign.Settings.AttributeDefinitions ?? []}
					localValues={localAttributes}
					onChange={handleAttributeChange}
					onRoll={requestRoll}
				/>
			</div>

			{/* Critical Success Message - Last and smaller */}
			<div className="pt-4 border-t border-base-300">
				<input
					type="text"
					value={localCritMessage}
					onChange={(e) => handleCritMessageChange(e.target.value)}
					className="input input-bordered input-sm w-full text-xs"
					placeholder="Critical success message (optional)"
					maxLength={50}
				/>
				<p className="text-xs opacity-50 mt-1">
					Displays when you roll a critical success
				</p>
			</div>

			{/* Stat Transfer Picker */}
			{transferStat && (
				<ActorPicker
					isOpen={!!transferStat}
					onConfirm={(targetId, amount) => {
						if (!actionService || !amount) return;
						actionService.execute("actor:transferStat", {
							sourceActorId: character.Id,
							sourceStatId: transferStat.Id,
							targetId,
							targetStatId: transferStat.Id,
							amount,
						});
						setTransferStat(null);
					}}
					onCancel={() => setTransferStat(null)}
					title={`Transfer ${transferStat.Name}`}
					excludeActorId={character.Id}
					includeSharedInventories={true}
					showAmount={true}
					amountMax={transferStat.Current ?? 0}
				/>
			)}
		</div>
	);
}
