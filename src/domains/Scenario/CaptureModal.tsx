// domains/Scenario/CaptureModal.tsx
//
// The DM's "capture current state as a scenario" dialog, opened from the map
// toolbar (next to the X-ray button). It previews exactly what will be stored
// using the same builder the capture action runs, so the preview never drifts
// from reality, and offers a name field with inline auto-completion of existing
// scenario names (type "Castl" -> ghost-completes to "Castle Siege" and hints
// that capturing will overwrite it). First Enter accepts the suggestion; a
// second Enter captures.

import { useRef, useState } from "react";
import { useQuestContext } from "../Context/ContextProvider";
import { useActionService } from "../../services/Actions/ActionServiceProvider";
import { CampaignUtils } from "../Campaign/CampaignUtils";
import { buildCapturePlacements } from "./ScenarioUtils";
import { countPlacements } from "./Scenario";
import { Modal } from "../../components/ui/Modal";

interface CaptureModalProps {
	isOpen: boolean;
	onClose: () => void;
}

const OVERWRITE_HINT = " (save over this scenario?)";

export function CaptureModal({ isOpen, onClose }: CaptureModalProps) {
	const context = useQuestContext();
	const { actionService } = useActionService();
	const campaign = CampaignUtils.getActiveCampaign(context);

	const [name, setName] = useState("");
	const inputRef = useRef<HTMLInputElement>(null);

	// Preview the snapshot from live state (same builder the action uses).
	// Computed every render (cheap) rather than memoized — the campaign object is
	// mutated in place, so a memo keyed on it could go stale between opens.
	const placements = buildCapturePlacements(campaign);
	const counts = countPlacements(placements);

	const terrainName = (id: string): string =>
		campaign.VoxelTerrains.find((t) => t.Id === id)?.Name ?? "Unknown terrain";

	// Terrains the party occupies — these are what the snapshot revolves around
	// (entities/items are only captured where they share a terrain with the
	// party). Shown so the DM can see at a glance which places will be reset.
	const partyTerrainNames = [
		...new Set(
			placements
				.filter((p) => p.Type === "character")
				.map((p) => p.Position.terrainId)
		),
	]
		.map(terrainName)
		.sort((a, b) => a.localeCompare(b));

	const sceneCount =
		(campaign.GameState.Scene.EnvironmentImageId ? 1 : 0) +
		(campaign.GameState.Scene.FocusImageId ? 1 : 0);
	const audioCount = campaign.GameState.Audio.length;

	// --- Name auto-completion ----------------------------------------------
	// Exact (case-insensitive) match => capturing overwrites it. A longer
	// prefix match => offer a ghost completion. Use the raw typed string for
	// both the prefix test and the slice so the ghost overlay aligns perfectly
	// with the input text.
	const nameLower = name.toLowerCase();
	const existing = campaign.Scenarios.find(
		(s) => s.Name.toLowerCase() === name.trim().toLowerCase()
	);
	// Suppress the completion once the typed text is itself a complete scenario
	// name, so Enter overwrites that exact match instead of jumping to a longer
	// name that merely shares the prefix.
	const suggestion =
		name.trim() && !existing
			? campaign.Scenarios.find(
					(s) =>
						s.Name.toLowerCase().startsWith(nameLower) &&
						s.Name.length > name.length
			  )
			: undefined;
	const ghostSuffix = suggestion ? suggestion.Name.slice(name.length) : "";

	const handleCapture = () => {
		if (!actionService || !name.trim()) return;
		actionService.execute("scenario:capture", { name: name.trim() });
		setName("");
		onClose();
	};

	const handleClose = () => {
		setName("");
		onClose();
	};

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "Escape") {
			handleClose();
			return;
		}
		// Tab / right-arrow-at-end / Enter all accept a pending suggestion first.
		const acceptKey =
			e.key === "Enter" ||
			e.key === "Tab" ||
			(e.key === "ArrowRight" &&
				inputRef.current?.selectionStart === name.length);
		if (suggestion && acceptKey) {
			e.preventDefault();
			setName(suggestion.Name);
			return;
		}
		if (e.key === "Enter") {
			e.preventDefault();
			handleCapture();
		}
	};

	if (!isOpen) return null;

	const nothingToCapture = placements.length === 0;

	return (
		<Modal
			title={
				<>
					<span className="icon-[mdi--camera] w-5 h-5" />
					Capture Scenario
				</>
			}
			onClose={handleClose}
			actions={
				<>
					<button onClick={handleClose} className="btn btn-ghost">
						Cancel
					</button>
					<button
						onClick={handleCapture}
						disabled={!name.trim()}
						className={`btn ${existing ? "btn-warning" : "btn-primary"}`}
					>
						<span
							className={`w-5 h-5 ${
								existing ? "icon-[mdi--refresh]" : "icon-[mdi--content-save]"
							}`}
						/>
						{existing ? "Overwrite" : "Capture"}
					</button>
				</>
			}
		>
				<p className="text-sm opacity-70">
					Saves the party's positions plus the entities, items, scene, and
					audio around them. Terrains the party isn't on are left untouched.
				</p>

				{/* What will be captured */}
				<div className="bg-base-200 rounded-lg p-3 mt-4 space-y-2 text-sm">
					<div className="flex items-center gap-2">
						<span className="icon-[mdi--account-group] w-4 h-4 opacity-70" />
						<span>
							<strong>{counts.characters}</strong> character
							{counts.characters === 1 ? "" : "s"} (the whole party)
						</span>
					</div>
					<div className="flex items-center gap-2">
						<span className="icon-[mdi--sword-cross] w-4 h-4 opacity-70" />
						<span>
							<strong>{counts.entities}</strong> entit
							{counts.entities === 1 ? "y" : "ies"} and{" "}
							<strong>{counts.items}</strong> item
							{counts.items === 1 ? "" : "s"} near the party
						</span>
					</div>
					<div className="flex items-center gap-2">
						<span className="icon-[mdi--image-multiple] w-4 h-4 opacity-70" />
						<span>
							<strong>{sceneCount}</strong> scene image
							{sceneCount === 1 ? "" : "s"}, <strong>{audioCount}</strong>{" "}
							audio track{audioCount === 1 ? "" : "s"}
						</span>
					</div>
					{partyTerrainNames.length > 0 && (
						<div className="flex items-start gap-2">
							<span className="icon-[mdi--terrain] w-4 h-4 opacity-70 mt-0.5" />
							<span>
								Reset on load:{" "}
								<span className="opacity-70">
									{partyTerrainNames.join(", ")}
								</span>
							</span>
						</div>
					)}
				</div>

				{nothingToCapture && (
					<div className="alert alert-warning mt-3 text-sm">
						<span className="icon-[mdi--alert] w-4 h-4 shrink-0" />
						No party members are on the field, so this scenario would be empty.
					</div>
				)}

				{/* Name input with ghost auto-completion */}
				<div className="form-control mt-4">
					<label className="label">
						<span className="label-text">Scenario name</span>
					</label>
					<div className="relative">
						{/* Ghost overlay: an invisible copy of the typed text reserves
						    space so the muted completion lines up after it. */}
						{ghostSuffix && (
							<div
								aria-hidden
								className="pointer-events-none absolute inset-0 flex items-center px-4 text-base whitespace-pre overflow-hidden"
							>
								<span className="invisible">{name}</span>
								<span className="opacity-70">
									{ghostSuffix}
									{OVERWRITE_HINT}
								</span>
							</div>
						)}
						<input
							ref={inputRef}
							type="text"
							value={name}
							onChange={(e) => setName(e.target.value)}
							onKeyDown={handleKeyDown}
							placeholder="Enter scenario name..."
							className="input input-bordered w-full bg-transparent relative px-4 text-base"
							autoFocus
						/>
					</div>
					{suggestion && (
						<span className="text-xs opacity-70 mt-1">
							Press Enter or Tab to complete "{suggestion.Name}".
						</span>
					)}
					{existing && (
						<span className="text-warning text-xs mt-1 flex items-center gap-1">
							<span className="icon-[mdi--alert] w-3.5 h-3.5" />
							A scenario named "{existing.Name}" already exists — capturing will
							overwrite it.
						</span>
					)}
				</div>

		</Modal>
	);
}
