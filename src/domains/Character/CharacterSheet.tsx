// domains/Character/CharacterSheet.tsx

import { useState, useEffect, useLayoutEffect, useRef } from "react";
import { useQuestContext } from "../Context/ContextProvider";
import { useDebouncedCallback } from "../../hooks/useDebounced";
import { useActionService } from "../../services/Actions/ActionServiceProvider";
import { CampaignUtils } from "../Campaign/CampaignUtils";
import { Character } from "./Character";
import { ImagePicker } from "../../components/pickers/ImagePicker";
import { StatBar } from "../../components/widgets/StatBar";
import { ActionBubbles } from "../../components/widgets/ActionBubbles";
import { ActorPicker } from "../../components/pickers/ActorPicker";
import { AttributesSection } from "../../components/widgets/AttributesSection";
import { useDiceRoller } from "../../components/Dice/DiceRollerContext";
import { ToggleButton } from "../../components/ui/ToggleButton";
import { EmptyState } from "../../components/ui/EmptyState";
import { ACTOR_DEFAULT_COLORS } from "../Actor/Actor";
import {
	ResolvedAction,
	ResolvedStat,
	resolveStats,
	resolveActions,
} from "../Actor/ActorResolvers";

export function CharacterSheet() {
	const context = useQuestContext();
	const { actionService } = useActionService();
	const { requestRoll } = useDiceRoller();
	const campaign = CampaignUtils.getActiveCampaign(context);

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
	const [localColor, setLocalColor] = useState<string>(
		ACTOR_DEFAULT_COLORS.CHARACTER
	);
	const [localAttributes, setLocalAttributes] = useState<Map<string, string>>(
		new Map()
	);
	const [localMoveSpeed, setLocalMoveSpeed] = useState(0);

	// Initialize local state when character loads
	useEffect(() => {
		if (character) {
			setLocalName(character.Name);
			setLocalDescription(character.Description || "");
			setLocalCritMessage(character.CritMessage || "");
			setLocalColor(character.Color ?? ACTOR_DEFAULT_COLORS.CHARACTER);
			setLocalMoveSpeed(character.MoveSpeed);
			setLocalAttributes(
				new Map(character.Attributes.map((attr) => [attr.Id, attr.Value]))
			);
		}
	}, [character?.Id]);

	const handleFieldChange = (field: keyof Character, value: any) => {
		if (!actionService || !character) return;

		actionService.execute("actor:edit", {
			actorId: character.Id,
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
	const commitCritMessage = useDebouncedCallback((v: string | undefined) =>
		handleFieldChange("CritMessage", v)
	);
	const commitColor = useDebouncedCallback((v: string) =>
		handleFieldChange("Color", v)
	);
	const commitMoveSpeed = useDebouncedCallback((v: number) =>
		handleFieldChange("MoveSpeed", v)
	);
	const commitAttributes = useDebouncedCallback(
		(updatedAttributes: Character["Attributes"]) =>
			handleFieldChange("Attributes", updatedAttributes)
	);

	if (!character) {
		return <EmptyState>No character selected</EmptyState>;
	}

	const handleNameChange = (value: string) => {
		setLocalName(value);
		commitName(value);
	};

	const handleDescriptionChange = (value: string) => {
		setLocalDescription(value);
		commitDescription(value);
	};

	const handleCritMessageChange = (value: string) => {
		const truncated = value.slice(0, 50);
		setLocalCritMessage(truncated);
		commitCritMessage(truncated || undefined);
	};

	const handleColorChange = (value: string) => {
		setLocalColor(value);
		commitColor(value);
	};

	const handleMoveSpeedChange = (value: number) => {
		const clamped = Math.max(0, Math.min(99, value));
		setLocalMoveSpeed(clamped);
		commitMoveSpeed(clamped);
	};

	const handleStatChange = (statId: string, field: "Current" | "Max", value: number) => {
		if (!actionService) return;

		const updatedStats = character.Stats.map((stat) =>
			stat.Id === statId ? { ...stat, [field]: value } : stat
		);

		actionService.execute("actor:edit", {
			actorId: character.Id,
			updates: { Stats: updatedStats },
		});
	};

	const handleAttributeChange = (id: string, value: string) => {
		setLocalAttributes((prev) => new Map(prev).set(id, value));

		const updatedAttributes = character.Attributes.map((attr) =>
			attr.Id === id ? { ...attr, Value: value } : attr
		);
		commitAttributes(updatedAttributes);
	};

	const handleActionsChange = (updatedActions: ResolvedAction[]) => {
		if (!actionService) return;

		const actionSlots = updatedActions.map((a) => ({
			Id: a.Id,
			Max: a.Max,
			Current: a.Current,
		}));

		actionService.execute("actor:edit", {
			actorId: character.Id,
			updates: { Actions: actionSlots },
		});
	};

	const resolvedStats = resolveStats(
		character.Stats,
		campaign.Settings.StatDefinitions
	);
	// With 1-2 stats the column beside the art has room to spare, so the
	// description fills it; with more it goes full-width below. Stat count is
	// a campaign setting, so a given campaign's layout never shifts.
	const descriptionBeside = resolvedStats.length <= 2;
	// Short art (square or wide) leaves a gap under it beside the stats; the
	// actions move into that gap when they fit on one line there. Only the art
	// and the name+stats block are compared, neither of which changes when the
	// actions move, so the placement can't flip back and forth.
	const artRef = useRef<HTMLDivElement>(null);
	const statsRef = useRef<HTMLDivElement>(null);
	const actionsRef = useRef<HTMLDivElement>(null);
	const [actionsUnderArt, setActionsUnderArt] = useState(false);
	const hasActions = !!character.Actions && character.Actions.length > 0;
	useLayoutEffect(() => {
		const art = artRef.current;
		const stats = statsRef.current;
		if (!art || !stats) return;
		const update = () => {
			const actions = actionsRef.current;
			if (!actions) return setActionsUnderArt(false);
			const gap = stats.offsetHeight - art.offsetHeight - 8;
			setActionsUnderArt(
				gap >= actions.offsetHeight && actions.offsetWidth <= art.offsetWidth
			);
		};
		const observer = new ResizeObserver(update);
		observer.observe(art);
		observer.observe(stats);
		if (actionsRef.current) observer.observe(actionsRef.current);
		update();
		return () => observer.disconnect();
		// actionsUnderArt: moving the actions remounts them, so re-observe.
	}, [hasActions, actionsUnderArt]);
	const actionBubbles = hasActions && (
		// w-max keeps the row on one line under the art; max-w-full lets it wrap
		// beside the stats. Its offsetWidth is then the natural width in both
		// places unless it wrapped, which only happens in the wider column.
		<div ref={actionsRef} className={actionsUnderArt ? "w-max" : "w-max max-w-full pt-1"}>
			<ActionBubbles
				actions={resolveActions(
					character.Actions!,
					campaign.Settings.ActionDefinitions
				)}
				onChange={handleActionsChange}
			/>
		</div>
	);

	const description = (
		<textarea
			value={localDescription}
			onChange={(e) => handleDescriptionChange(e.target.value)}
			className={`textarea textarea-bordered w-full ${descriptionBeside ? "flex-1 min-h-20" : ""}`}
			rows={3}
			placeholder="Character description..."
		/>
	);

	return (
		<div className="space-y-3">
			{/* Full art beside what players touch every turn (name, stats,
			    actions), so the controls stay near the top of the panel. */}
			<div className={`flex gap-4 ${descriptionBeside ? "items-stretch" : "items-start"}`}>
				{/* Column sizes to the art: up to 320px tall, at most 45% wide, so
				    tall art stays narrow and square/wide art isn't shrunk to a strip. */}
				<div className="shrink-0 max-w-[45%] self-start space-y-2">
					<div ref={artRef} className="[&_img]:max-h-80">
						<ImagePicker
							tall
							value={character.Image}
							onChange={(imageId) => {
								handleFieldChange("Image", imageId);
							}}></ImagePicker>
					</div>
					{actionsUnderArt && actionBubbles}
				</div>
				<div className="flex-1 min-w-0 flex flex-col gap-2">
					<div ref={statsRef} className="flex flex-col gap-2">
					<div className="flex items-center gap-2">
						<input
							type="text"
							value={localName}
							onChange={(e) => handleNameChange(e.target.value)}
							className="input input-bordered text-2xl font-bold flex-1 min-w-0"
							placeholder="Character Name"
						/>
						<ToggleButton
							active={editingMaxStats}
							kind="independent"
							quiet
							className="btn-sm btn-circle shrink-0"
							onClick={() => setEditingMaxStats(!editingMaxStats)}
							title={editingMaxStats ? "Hide max stat controls" : "Edit max stats"}
						>
							<span className="icon-[mdi--cog] w-4 h-4" />
						</ToggleButton>
					</div>

					{/* Stats */}
					<div className="space-y-3">
						{resolvedStats.map((stat) => (
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

					{!actionsUnderArt && actionBubbles}

					{descriptionBeside && description}
				</div>
			</div>

			{/* Description: flavor text, read now and then, rarely edited. */}
			{!descriptionBeside && description}

			{/* Token details */}
			<div className="grid grid-cols-1 md:grid-cols-3 gap-4">
				<div>
					<label className="label">
						<span className="label-text">Move Speed</span>
					</label>
					<input
						type="number"
						value={localMoveSpeed}
						onChange={(e) =>
							handleMoveSpeedChange(Number(e.target.value))
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
						value={localColor}
						onChange={(e) => handleColorChange(e.target.value)}
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
				<p className="text-xs opacity-70 mt-1">
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
