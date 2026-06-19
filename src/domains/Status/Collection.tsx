// domains/Status/Collection.tsx

import { CollectionView, CollectionViewItem } from "../../components/CollectionView/CollectionView";
import { useQuestContext } from "../Context/ContextProvider";
import { CampaignUtils } from "../Campaign/CampaignUtils";
import { Actor, StatusSlot } from "../Actor/Actor";
import { Status } from "./Status";
import { StatusSlotDisplay } from "./StatusSlotDisplay";
import { StatusEdit } from "./Edit";
import { FormDrawer } from "../../components/ui/FormDrawer";
import { useAnimatedDrawer } from "../../hooks/useAnimatedDrawer";

interface StatusCollectionProps {
	actor: Actor;
}

export function StatusCollection({ actor }: StatusCollectionProps) {
	const context = useQuestContext();
	const campaign = CampaignUtils.getActiveCampaign(context);
	const isDm = context.User.Role === "dm";

	// Slot detail drawer (read-only) and DM template-edit drawer.
	const slotDrawer = useAnimatedDrawer<StatusSlot>();
	const editDrawer = useAnimatedDrawer<Status>();

	// Get the actor's statuses
	const slots = actor.Statuses;

	// Map slots to CollectionViewItem format
	const items: CollectionViewItem[] = slots
    .map((slot, index) => {
        const status = campaign.StatusTemplates.find((t) => t.Id === slot.Id);
        if (!status) return null;

        // Format duration text
        const durationText = (() => {
            const exp = slot.expiration;
            switch (exp.type) {
                case "permanent": return "Permanent";
                case "turns": return `${exp.turnsLeft} turn${exp.turnsLeft === 1 ? '' : 's'} left`;
                case "shortRest": return "Until short rest";
                case "longRest": return "Until long rest";
                case "days": return `${exp.daysLeft} day${exp.daysLeft === 1 ? '' : 's'} left`;
            }
        })();

        return {
            id: `${slot.Id}-${index}`,
            label: status.Name,
            details: durationText,
            description: status.Description,
            imageId: status.Image,
            onClick: () => slotDrawer.open(slot),
            ...(isDm ? { onEdit: () => editDrawer.open(status) } : {}),
        };
    })
    .filter(Boolean) as CollectionViewItem[];

	return (
		<>
			<CollectionView
				items={items}
				title="Statuses"
				emptyMessage="No status effects"
				viewModeKey="statuses-view"
				searchEnabled={true}
				searchPlaceholder="Search statuses..."
			/>

			{/* Status Slot Display Drawer */}
			{slotDrawer.value && (
				<StatusSlotDisplay
					isOpen={slotDrawer.isOpen}
					onClose={slotDrawer.close}
					slot={slotDrawer.value}
					actor={actor}
				/>
			)}

			{/* DM Template Edit Drawer */}
			{editDrawer.value && (
				<FormDrawer isOpen={editDrawer.isOpen} onClose={editDrawer.close}>
					<StatusEdit status={editDrawer.value} onClose={editDrawer.close} />
				</FormDrawer>
			)}
		</>
	);
}
