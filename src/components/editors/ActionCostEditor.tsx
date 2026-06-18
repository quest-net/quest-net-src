import { useQuestContext } from "../../domains/Context/ContextProvider";
import { CampaignUtils } from "../../domains/Campaign/CampaignUtils";
import type { ActionCost } from "../../domains/CampaignSetting/CampaignSetting";
import { EmptyState } from "../ui/EmptyState";

interface ActionCostEditorProps {
	value?: ActionCost;
	onChange: (value?: ActionCost) => void;
}

export function ActionCostEditor({ value, onChange }: ActionCostEditorProps) {
	const context = useQuestContext();
	const campaign = CampaignUtils.getActiveCampaign(context);

	const isEnabled = !!value;
	const actionId = value?.actionId || "";
	const amount = value?.amount || 1;

	const handleToggle = (enabled: boolean) => {
		if (enabled) {
			const firstAction = campaign.Settings.ActionDefinitions[0];
			if (firstAction) {
				onChange({ actionId: firstAction.Id, amount: 1 });
			}
		} else {
			onChange(undefined);
		}
	};

	const handleActionChange = (newActionId: string) => {
		onChange({ actionId: newActionId, amount });
	};

	const handleAmountChange = (newAmount: number) => {
		const clamped = Math.max(0, Math.floor(newAmount));
		onChange({ actionId, amount: clamped });
	};

	if (campaign.Settings.ActionDefinitions.length === 0) {
		return (
			<EmptyState compact>
				No actions defined in campaign settings. Add actions before setting costs.
			</EmptyState>
		);
	}

	return (
		<div className="space-y-3">
			<div className="form-control">
				<label className="label cursor-pointer justify-start gap-3">
					<input
						type="checkbox"
						checked={isEnabled}
						onChange={(e) => handleToggle(e.target.checked)}
						className="toggle toggle-primary"
					/>
					<span className="label-text font-medium">
						Requires action cost to use
					</span>
				</label>
			</div>

			{isEnabled && (
				<div className="grid grid-cols-2 gap-3">
					<div className="form-control">
						<label className="label">
							<span className="label-text">Action</span>
						</label>
						<select
							value={actionId}
							onChange={(e) => handleActionChange(e.target.value)}
							className="select select-bordered w-full"
						>
							{campaign.Settings.ActionDefinitions.map((action) => (
								<option key={action.Id} value={action.Id}>
									{action.Name}
								</option>
							))}
						</select>
					</div>

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

			{isEnabled && (
				<div className="text-sm opacity-70">
					Costs{" "}
					<span className="font-semibold">
						{amount}{" "}
						{campaign.Settings.ActionDefinitions.find((a) => a.Id === actionId)
							?.Name || "Unknown Action"}
					</span>{" "}
					to use
				</div>
			)}
		</div>
	);
}
