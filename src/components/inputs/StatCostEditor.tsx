// components/inputs/StatCostEditor.tsx

import { useQuestContext } from "../../domains/Context/ContextProvider";
import { CampaignUtils } from "../../domains/Campaign/CampaignUtils";
import type { StatCost } from "../../domains/CampaignSetting/CampaignSetting";
import { EmptyState } from "../ui/EmptyState";

interface StatCostEditorProps {
	value?: StatCost;
	onChange: (value?: StatCost) => void;
}

export function StatCostEditor({ value, onChange }: StatCostEditorProps) {
	const context = useQuestContext();
	const campaign = CampaignUtils.getActiveCampaign(context);

	const isEnabled = !!value;
	const statId = value?.statId || "";
	const amount = value?.amount || 1;

	const handleToggle = (enabled: boolean) => {
		if (enabled) {
			// Enable with first available stat
			const firstStat = campaign.Settings.StatDefinitions[0];
			if (firstStat) {
				onChange({ statId: firstStat.Id, amount: 1 });
			}
		} else {
			// Disable
			onChange(undefined);
		}
	};

	const handleStatChange = (newStatId: string) => {
		onChange({ statId: newStatId, amount });
	};

	const handleAmountChange = (newAmount: number) => {
		const clamped = Math.max(0, Math.floor(newAmount));
		onChange({ statId, amount: clamped });
	};

	// No stats defined in campaign settings
	if (campaign.Settings.StatDefinitions.length === 0) {
		return (
			<EmptyState compact>
				No stats defined in campaign settings. Add stats before setting costs.
			</EmptyState>
		);
	}

	return (
		<div className="space-y-3">
			{/* Enable/Disable Toggle */}
			<div className="form-control">
				<label className="label cursor-pointer justify-start gap-3">
					<input
						type="checkbox"
						checked={isEnabled}
						onChange={(e) => handleToggle(e.target.checked)}
						className="toggle toggle-primary"
					/>
					<span className="label-text font-medium">
						Requires stat cost to use
					</span>
				</label>
			</div>

			{/* Stat Selection + Amount */}
			{isEnabled && (
				<div className="grid grid-cols-2 gap-3">
					{/* Stat Dropdown */}
					<div className="form-control">
						<label className="label">
							<span className="label-text">Stat</span>
						</label>
						<select
							value={statId}
							onChange={(e) => handleStatChange(e.target.value)}
							className="select select-bordered w-full"
						>
							{campaign.Settings.StatDefinitions.map((stat) => (
								<option key={stat.Id} value={stat.Id}>
									{stat.Name}
								</option>
							))}
						</select>
					</div>

					{/* Amount Input */}
					<div className="form-control">
						<label className="label">
							<span className="label-text">Cost</span>
						</label>
						<input
							type="number"
							value={amount}
							onChange={(e) => handleAmountChange(Number(e.target.value))}
							className="input input-bordered w-full"
							min={0}
							placeholder="Cost amount"
						/>
					</div>
				</div>
			)}

			{/* Preview Text */}
			{isEnabled && (
				<div className="text-sm opacity-70">
					Costs{" "}
					<span className="font-semibold">
						{amount}{" "}
						{campaign.Settings.StatDefinitions.find((s) => s.Id === statId)
							?.Name || "Unknown Stat"}
					</span>{" "}
					to use
				</div>
			)}
		</div>
	);
}
