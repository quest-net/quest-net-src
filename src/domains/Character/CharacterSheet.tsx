// domains/Character/CharacterSheet.tsx

import { useState, useEffect, useRef } from "react";
import { useQuestContext } from "../Context/ContextProvider";
import { useActionService } from "../../services/Actions/ActionServiceProvider";
import { CampaignActions } from "../Campaign/CampaignActions";
import { Character } from "./Character";
import { ImageDisplay } from "../Image/ImageDisplay";
import { ImagePicker } from "../../components/inputs/ImagePicker";
import type { StatDefinition } from "../CampaignSetting/CampaignSetting";

export function CharacterSheet() {
	const context = useQuestContext();
	const { actionService } = useActionService();
	const campaign = CampaignActions.getActiveCampaign(context);

	const [editingMaxStats, setEditingMaxStats] = useState(false);
	const [showImagePicker, setShowImagePicker] = useState(false);

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
	const [localAttributes, setLocalAttributes] = useState<Record<string, string>>({});

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
			setLocalAttributes(character.Attributes);
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

	const handleAttributeChange = (key: string, value: string) => {
		setLocalAttributes((prev) => ({ ...prev, [key]: value }));
		
		if (attrTimer.current) clearTimeout(attrTimer.current);
		attrTimer.current = setTimeout(() => {
			if (!actionService) return;

			const updatedAttributes = { ...character.Attributes, [key]: value };

			actionService.execute("character:edit", {
				characterId: character.Id,
				updates: { Attributes: updatedAttributes },
			});
		}, 500);
	};

	return (
		<div className="space-y-1">
			{/* Image & Name */}
			<div className="flex gap-4 items-start">
				<div
					className="w-50 h-50 bg-base-200 rounded-lg overflow-hidden flex items-center justify-center cursor-pointer hover:opacity-80 transition-opacity shrink-0"
					onClick={() => setShowImagePicker(true)}
				>
					{character.Image ? (
						<ImageDisplay
							imageId={character.Image}
							className="w-full h-full object-cover"
							alt={character.Name}
						/>
					) : (
						<span className="icon-[mdi--account] w-16 h-16 opacity-30"></span>
					)}
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

			{/* Image Picker Modal */}
			{showImagePicker && (
				<dialog className="modal modal-open">
					<div className="modal-box">
						<h3 className="font-bold text-lg mb-4">Select Image</h3>
						<ImagePicker
							value={character.Image}
							onChange={(imageId) => {
								handleFieldChange("Image", imageId);
								setShowImagePicker(false);
							}}
							label=""
						/>
						<div className="modal-action">
							<button
								className="btn"
								onClick={() => setShowImagePicker(false)}
							>
								Close
							</button>
						</div>
					</div>
					<div
						className="modal-backdrop"
						onClick={() => setShowImagePicker(false)}
					/>
				</dialog>
			)}

			{/* Stats */}
			<div className="space-y-2">
				<div className="flex items-center justify-between">
					<div></div>
					<button
						className={`btn btn-sm btn-circle ${
							editingMaxStats ? "btn-primary" : "btn-ghost"
						}`}
						onClick={() => setEditingMaxStats(!editingMaxStats)}
						title={editingMaxStats ? "Hide max stat controls" : "Edit max stats"}
					>
						<span className="icon-[mdi--cog] w-4 h-4" />
					</button>
				</div>

				<div className="space-y-3">
					{character.Stats.map((stat) => (
						<StatBar
							key={stat.Id}
							stat={stat}
							editingMax={editingMaxStats}
							onCurrentChange={(value) =>
								handleStatChange(stat.Id, "Current", value)
							}
							onMaxChange={(value) => handleStatChange(stat.Id, "Max", value)}
						/>
					))}
				</div>
			</div>

			{/* Description */}
			<textarea
				value={localDescription}
				onChange={(e) => handleDescriptionChange(e.target.value)}
				className="textarea textarea-bordered w-full"
				rows={4}
				placeholder="Character description..."
			/>

			{/* Move Speed & Flying */}
			<div className="grid grid-cols-2 gap-4">
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
					<div className="flex items-center h-12">
						<input
							type="checkbox"
							checked={character.CanFly}
							onChange={(e) => handleFieldChange("CanFly", e.target.checked)}
							className="toggle toggle-primary toggle-lg"
						/>
					</div>
				</div>
			</div>

			{/* Attributes */}
			{Object.keys(character.Attributes).length > 0 && (
				<div className="space-y-2">
					{Object.entries(character.Attributes).map(([key, _value]) => (
						<div key={key} className="flex gap-2 items-center">
							<div className="text-sm font-medium flex-1">{key}</div>
							<input
								type="text"
								value={localAttributes[key] ?? ""}
								onChange={(e) => handleAttributeChange(key, e.target.value)}
								className="input input-bordered input-sm flex-2"
								placeholder="Value"
							/>
						</div>
					))}
				</div>
			)}

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
		</div>
	);
}

// ============================================================================
// STAT BAR COMPONENT
// ============================================================================

interface StatBarProps {
	stat: StatDefinition;
	editingMax: boolean;
	onCurrentChange: (value: number) => void;
	onMaxChange: (value: number) => void;
}

function StatBar({
	stat,
	editingMax,
	onCurrentChange,
	onMaxChange,
}: StatBarProps) {
	const current = stat.Current ?? stat.Max;
	const percentage = (current / stat.Max) * 100;
	const barRef = useRef<HTMLDivElement>(null);

	const handleBarClick = (e: React.MouseEvent<HTMLDivElement>) => {
		if (!barRef.current) return;

		const rect = barRef.current.getBoundingClientRect();
		const clickX = e.clientX - rect.left;
		const clickPercentage = (clickX / rect.width) * 100;
		const newValue = Math.round((clickPercentage / 100) * stat.Max);

		onCurrentChange(Math.max(0, Math.min(stat.Max, newValue)));
	};

	return (
		<div className="space-y-1">
			<div className="flex items-center justify-between">
				<label className="text-sm font-medium">{stat.Name}</label>
				
				{/* Current Value Controls - Right side of label */}
				<div className="flex items-center gap-1">
					<button
						className="btn btn-xs btn-ghost"
						onClick={() => onCurrentChange(Math.max(0, current - 1))}
					>
						-
					</button>
					<input
						type="number"
						value={current}
						onChange={(e) => onCurrentChange(Number(e.target.value))}
						className="input input-bordered input-xs w-16 text-center"
						min={0}
						max={stat.Max}
					/>
					<button
						className="btn btn-xs btn-ghost"
						onClick={() => onCurrentChange(Math.min(stat.Max, current + 1))}
					>
						+
					</button>
					<span className="text-xs opacity-70 ml-1">/ {stat.Max}</span>
				</div>
			</div>

			{/* Progress Bar - Clickable/Draggable */}
			<div
				ref={barRef}
				className="relative w-full h-6 bg-base-300 rounded overflow-hidden cursor-pointer"
				onClick={handleBarClick}
			>
				<div
					className="h-full transition-all"
					style={{
						width: `${percentage}%`,
						backgroundColor: stat.Color,
					}}
				/>
			</div>

			{/* Max Value Control (only visible when editingMax) */}
			{editingMax && (
				<div className="flex items-center gap-1 justify-start">
					<span className="text-xs opacity-60">Max:</span>
					<button
						className="btn btn-xs btn-ghost"
						onClick={() => onMaxChange(Math.max(1, stat.Max - 1))}
					>
						-
					</button>
					<input
						type="number"
						value={stat.Max}
						onChange={(e) => onMaxChange(Number(e.target.value))}
						className="input input-bordered input-xs w-16 text-center"
						min={1}
					/>
					<button
						className="btn btn-xs btn-ghost"
						onClick={() => onMaxChange(stat.Max + 1)}
					>
						+
					</button>
				</div>
			)}
		</div>
	);
}