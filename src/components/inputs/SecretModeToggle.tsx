// components/inputs/SecretModeToggle.tsx
// DM-only toggle for secret mode where changes are not broadcasted.

import { useQuestContext, triggerContextUpdate } from "../../domains/Context/ContextProvider";
import { CampaignUtils } from "../../domains/Campaign/CampaignUtils";
import { useActionService } from "../../services/Actions/ActionServiceProvider";

export function SecretModeToggle() {
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
