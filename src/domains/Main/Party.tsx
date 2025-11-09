// Main/Party.tsx

import { useState } from "react";
import { useQuestContext } from "../Context/ContextProvider";
import { useActionService } from "../../services/Actions/ActionServiceProvider";
import { CampaignActions } from "../Campaign/CampaignActions";
import { ImageDisplay } from "../Image/ImageDisplay";
import { StatBar } from "../../components/StatBar/StatBar";
import { ObjectPicker, ObjectTypeConfig } from "../../components/inputs/ObjectPicker";

export function Party() {
	const context = useQuestContext();
	const { actionService } = useActionService();
	const campaign = CampaignActions.getActiveCampaign(context);

	const isDM = context.User.Role === "dm";
	const characters = campaign.GameState.Characters;

	// Actor selection state for DM
	const [selectedActorIds, setSelectedActorIds] = useState<string[]>([]);
	const [showObjectPicker, setShowObjectPicker] = useState(false);

	const handleStatChange = (
		characterId: string,
		statId: string,
		field: "Current" | "Max",
		value: number
	) => {
		if (!actionService || !isDM) return;

		const character = characters.find((c) => c.Id === characterId);
		if (!character) return;

		const updatedStats = character.Stats.map((stat) =>
			stat.Id === statId ? { ...stat, [field]: value } : stat
		);

		actionService.execute("character:edit", {
			characterId: characterId,
			updates: { Stats: updatedStats },
		});
	};

	const toggleActorSelection = (actorId: string) => {
		setSelectedActorIds((prev) =>
			prev.includes(actorId)
				? prev.filter((id) => id !== actorId)
				: [...prev, actorId]
		);
	};

	const toggleSelectAll = () => {
		if (selectedActorIds.length === characters.length) {
			setSelectedActorIds([]);
		} else {
			setSelectedActorIds(characters.map((c) => c.Id));
		}
	};

	const handleGiveObjects = (
		objectIds: string[],
		objectType: string,
		count: number
	) => {
		if (!actionService || selectedActorIds.length === 0) return;

		// Call the appropriate give action based on object type
		actionService.execute(`${objectType}:give`, {
			[`${objectType}Ids`]: objectIds,
			actorIds: selectedActorIds,
			count: count,
		});

		// Close picker and clear selection
		setShowObjectPicker(false);
		setSelectedActorIds([]);
	};

	// Calculate party-wide stats
	const calculatePartyStats = () => {
		if (characters.length === 0) return [];

		// Use the first character's stats as a template
		const statTemplate = characters[0].Stats;

		return statTemplate.map((templateStat) => {
			let totalCurrent = 0;
			let totalMax = 0;

			// Sum up this stat across all characters
			characters.forEach((character) => {
				const stat = character.Stats.find((s) => s.Id === templateStat.Id);
				if (stat) {
					totalCurrent += stat.Current ?? stat.Max;
					totalMax += stat.Max;
				}
			});

			const percentage = totalMax > 0 ? (totalCurrent / totalMax) * 100 : 0;

			return {
				id: templateStat.Id,
				name: templateStat.Name,
				color: templateStat.Color,
				totalCurrent,
				totalMax,
				percentage,
			};
		});
	};

	const partyStats = calculatePartyStats();

	// Prepare object types for ObjectPicker
	const objectTypes: ObjectTypeConfig<any>[] = [
		{
			label: "Items",
			items: campaign.ItemTemplates,
			icon: "icon-[mdi--bag-personal]",
			typeKey: "item",
		},
		{
			label: "Skills",
			items: campaign.SkillTemplates,
			icon: "icon-[mdi--star]",
			typeKey: "skill",
		},
	];

	// Empty state
	if (characters.length === 0) {
		return (
			<div className="text-center py-12">
				<div className="text-6xl mb-4">👥</div>
				<p className="text-xl mb-2">No characters spawned</p>
				{isDM ? (
					<p className="text-base-content/60">
						Go to the Characters tab to spawn characters
					</p>
				) : (
					<p className="text-base-content/60">How are you even here?</p>
				)}
			</div>
		);
	}

	return (
		<div className="space-y-4">
			{/* DM Controls */}
			{isDM && (
				<div className="card bg-base-200 border-2 border-base-300">
					<div className="card-body p-4">
						<div className="flex justify-between items-center">
							<div className="flex items-center gap-3">
								<button
									onClick={toggleSelectAll}
									className="btn btn-sm btn-ghost"
								>
									{selectedActorIds.length === characters.length ? (
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
							<button
								onClick={() => setShowObjectPicker(true)}
								disabled={selectedActorIds.length === 0}
								className="btn btn-primary btn-sm gap-2"
							>
								<span className="icon-[mdi--gift] w-4 h-4" />
								Give Objects
							</button>
						</div>
					</div>
				</div>
			)}

			{/* Party Stats Summary */}
			<div className="card bg-base-200 border-2 border-base-300">
				<div className="card-body p-4">
					<h2 className="font-bold text-lg mb-3">Party Stats</h2>
					<div className="space-y-3">
						{partyStats.map((stat) => (
							<div key={stat.id} className="space-y-1">
								<div className="flex items-center justify-between">
									<span className="text-sm font-medium">{stat.name}</span>
									<span className="text-sm opacity-70">
										{stat.totalCurrent} / {stat.totalMax} ({stat.percentage.toFixed(0)}%)
									</span>
								</div>
								<div className="relative w-full h-6 bg-base-300 rounded overflow-hidden">
									<div
										className="h-full transition-all duration-300"
										style={{
											width: `${stat.percentage}%`,
											backgroundColor: stat.color,
										}}
									/>
								</div>
							</div>
						))}
					</div>
				</div>
			</div>

			{/* Individual Characters */}
			<div className="space-y-2">
				{characters.map((character) => (
					<div
						key={character.Id}
						className={`card bg-base-100 border-2 transition-all ${
							isDM && selectedActorIds.includes(character.Id)
								? "border-primary ring-2 ring-primary"
								: "border-base-300"
						}`}
					>
						<div className="card-body p-4">
							<div className="flex gap-2 items-center">
								{/* DM Selection Checkbox */}
								{isDM && (
									<div className="shrink-0">
										<input
											type="checkbox"
											checked={selectedActorIds.includes(character.Id)}
											onChange={() => toggleActorSelection(character.Id)}
											className="checkbox checkbox-primary"
										/>
									</div>
								)}

								{/* Left side: Name and Image */}
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

								{/* Right side: Stats */}
								<div className="flex-1 space-y-2">
									{isDM ? (
										// DM: Interactive stat bars
										character.Stats.map((stat) => (
											<StatBar
												key={stat.Id}
												stat={stat}
												editingMax={false}
												onCurrentChange={(value) =>
													handleStatChange(character.Id, stat.Id, "Current", value)
												}
												onMaxChange={(value) =>
													handleStatChange(character.Id, stat.Id, "Max", value)
												}
											/>
										))
									) : (
										// Player: Readonly stat bars
										character.Stats.map((stat) => {
											const current = stat.Current ?? stat.Max;
											const percentage = (current / stat.Max) * 100;

											return (
												<div key={stat.Id} className="space-y-1">
													<div className="flex items-center justify-between">
														<span className="text-sm font-medium">{stat.Name}</span>
														<span className="text-sm opacity-70">
															{current} / {stat.Max}
														</span>
													</div>
													<div className="relative w-full h-6 bg-base-300 rounded overflow-hidden">
														<div
															className="h-full transition-all duration-150"
															style={{
																width: `${percentage}%`,
																backgroundColor: stat.Color,
															}}
														/>
													</div>
												</div>
											);
										})
									)}
								</div>
							</div>
						</div>
					</div>
				))}
			</div>

			{/* Object Picker Modal */}
			<ObjectPicker
				isOpen={showObjectPicker}
				types={objectTypes}
				multiSelect={true}
				showCount={true}
				onConfirm={handleGiveObjects}
				onCancel={() => setShowObjectPicker(false)}
				title="Give Objects to Selected Actors"
			/>
		</div>
	);
}