// components/editors/SecretModeToggle.tsx
// DM-only toggle for secret mode where changes are not broadcasted.

import { useQuestContext, triggerContextUpdate } from "../../domains/Context/ContextProvider";
import { CampaignUtils } from "../../domains/Campaign/CampaignUtils";
import { useActionService } from "../../services/Actions/ActionServiceProvider";

interface SecretModeToggleProps {
	// "compact" (default): the small icon button used in the header.
	// "panel": a larger card that explains what secret mode does, for settings.
	variant?: "compact" | "panel";
}

export function SecretModeToggle({ variant = "compact" }: SecretModeToggleProps = {}) {
	const context = useQuestContext();
	const campaign = CampaignUtils.getActiveCampaign(context);
	const { actionService } = useActionService();

	const isSecret = context.SecretModes?.[campaign.Id] || false;

	const toggleSecretMode = () => {
		if (!context.SecretModes) context.SecretModes = {};
		context.SecretModes[campaign.Id] = !isSecret;

		if (!context.SecretModes[campaign.Id] && actionService) {
			actionService.forceSync();
		}
		triggerContextUpdate();
	};

	if (variant === "panel") {
		return (
			<div className="card bg-base-100 border-2 border-base-300">
				<div className="card-body gap-3">
					<div className="flex items-center justify-between gap-2">
						<h3 className="font-semibold flex items-center gap-2">
							<span
								className={`w-5 h-5 ${
									isSecret ? "icon-[mdi--eye-off]" : "icon-[mdi--eye]"
								}`}
							/>
							Secret Mode
						</h3>
						<input
							type="checkbox"
							className="toggle toggle-error"
							checked={isSecret}
							onChange={toggleSecretMode}
						/>
					</div>
					<p className="text-sm opacity-70">
						While it's on, your players won't see any changes you make. Turn it
						off when you're ready for them to catch up. Great for prepping or
						editing behind the scenes.
					</p>
					{isSecret && (
						<div className="badge badge-error gap-1">
							<span className="icon-[mdi--circle] w-2 h-2" />
							Players can't see your changes
						</div>
					)}
				</div>
			</div>
		);
	}

	return (
		<div className="tooltip tooltip-bottom" data-tip="Secret Mode: When enabled, players will not receive any updates.">
			<button
				className={`btn btn-sm gap-2 ${isSecret ? "btn-error" : "btn-neutral"}`}
				onClick={toggleSecretMode}
			>
				<span className={isSecret ? "icon-[mdi--eye-off] w-5 h-5" : "icon-[mdi--eye] w-5 h-5"} />
			</button>
		</div>
	);
}
