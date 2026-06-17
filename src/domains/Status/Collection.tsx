// domains/Status/Collection.tsx

import { useState } from "react";
import { CollectionView, CollectionViewItem } from "../../components/CollectionView/CollectionView";
import { useQuestContext } from "../Context/ContextProvider";
import { CampaignUtils } from "../Campaign/CampaignUtils";
import { Actor, StatusSlot } from "../Actor/Actor";
import { StatusSlotDisplay } from "./StatusSlotDisplay";

interface StatusCollectionProps {
	actor: Actor;
}

export function StatusCollection({ actor }: StatusCollectionProps) {
	const context = useQuestContext();
	const campaign = CampaignUtils.getActiveCampaign(context);

	// Drawer state
	const [isDrawerOpen, setDrawerOpen] = useState(false);
	const [selectedSlot, setSelectedSlot] = useState<StatusSlot | null>(null);

	// Get the actor's statuses
	const slots = actor.Statuses;

	// Handle status click - open drawer
	const handleStatusClick = (slot: StatusSlot) => {
		setSelectedSlot(slot);
		setDrawerOpen(true);
	};

	// Handle drawer close
	const handleCloseDrawer = () => {
		setDrawerOpen(false);
		// Small delay before clearing selected slot to avoid visual flash
		setTimeout(() => setSelectedSlot(null), 300);
	};

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
            onClick: () => handleStatusClick(slot),
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
			{selectedSlot && (
				<StatusSlotDisplay
					isOpen={isDrawerOpen}
					onClose={handleCloseDrawer}
					slot={selectedSlot}
					actor={actor}
				/>
			)}
		</>
	);
}