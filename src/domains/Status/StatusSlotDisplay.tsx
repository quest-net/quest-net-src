// domains/Status/StatusSlotDisplay.tsx
//
// Builds the SlotDisplay config for a status slot. Uses the shared shell's
// numeric adjuster for the turns/days duration; the onCommit rebuilds the
// structured expiration payload.

import { useQuestContext } from "../Context/ContextProvider";
import { useActionService } from "../../services/Actions/ActionServiceProvider";
import { CampaignUtils } from "../Campaign/CampaignUtils";
import {
	SlotDisplay,
	SlotDisplayConfig,
} from "../../components/SlotDisplay/SlotDisplay";
import { Actor, StatusSlot } from "../Actor/Actor";
import { formatSlotExpiration, formatTemplateExpiration } from "./StatusUtils";

interface StatusSlotDisplayProps {
	isOpen: boolean;
	onClose: () => void;
	slot: StatusSlot;
	actor: Actor;
}

export function StatusSlotDisplay({
	isOpen,
	onClose,
	slot,
	actor,
}: StatusSlotDisplayProps) {
	const context = useQuestContext();
	const { actionService } = useActionService();
	const campaign = CampaignUtils.getActiveCampaign(context);

	const status = campaign.StatusTemplates.find((s) => s.Id === slot.Id);
	if (!status) {
		return null;
	}

	const exp = slot.expiration;
	const showCountAdjuster = exp.type === "turns" || exp.type === "days";
	const countUnit = exp.type === "turns" ? "turns" : "days";
	const countValue =
		exp.type === "turns"
			? exp.turnsLeft
			: exp.type === "days"
			? exp.daysLeft
			: 0;

	const config: SlotDisplayConfig = {
		title: status.Name,
		image: {
			imageId: status.Image,
			alt: status.Name,
			onChange: (imageId) =>
				actionService?.execute("status:edit", {
					statusId: status.Id,
					updates: { Image: imageId },
				}),
		},
		description: status.Description,
		actions: [
			{
				key: slot.Id,
				label: "Remove Status",
				icon: "icon-[mdi--delete]",
				confirm: true,
				confirmLabel: "Confirm Remove?",
				dividerBefore: true,
				closeOnRun: true,
				disabled: !actionService,
				onRun: () =>
					actionService?.execute("status:remove", {
						actorId: actor.Id,
						statusId: slot.Id,
					}),
			},
		],
		adjuster: showCountAdjuster
			? {
					title: "Adjust Duration",
					unit: countUnit,
					value: countValue,
					max: 999,
					onCommit: (value) => {
						if (exp.type === "turns") {
							actionService?.execute("status:adjustDuration", {
								actorId: actor.Id,
								statusId: slot.Id,
								expiration: { type: "turns", turnsLeft: value },
							});
						} else if (exp.type === "days") {
							actionService?.execute("status:adjustDuration", {
								actorId: actor.Id,
								statusId: slot.Id,
								expiration: { type: "days", daysLeft: value },
							});
						}
					},
			  }
			: undefined,
		properties: [
			{
				label: "Current Duration",
				value: formatSlotExpiration(slot.expiration),
				valueClassName:
					exp.type === "permanent" ? "badge badge-primary" : undefined,
			},
			{
				label: "Template Default",
				value: formatTemplateExpiration(status.Expiration),
				valueClassName: "opacity-70",
			},
			{ label: "Applied To", value: actor.Name },
		],
	};

	return <SlotDisplay isOpen={isOpen} onClose={onClose} config={config} />;
}
