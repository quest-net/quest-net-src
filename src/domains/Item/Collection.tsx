// domains/Item/Collection.tsx

import { useState } from "react";
import { CollectionView, CollectionViewItem } from "../../components/CollectionView/CollectionView";
import { useQuestContext } from "../Context/ContextProvider";
import { CampaignUtils } from "../Campaign/CampaignUtils";
import { Actor, InventorySlot, EquipmentSlot } from "../Actor/Actor";
import { ItemSlotDisplay } from "./ItemSlotDisplay";
import { formatActionCost, formatStatCost } from "../../utils/ActorCostUtils";

interface ItemCollectionProps {
	actor: Actor;
	mode: "inventory" | "equipment";
}

export function ItemCollection({ actor, mode }: ItemCollectionProps) {
	const context = useQuestContext();
	const campaign = CampaignUtils.getActiveCampaign(context);

	// Drawer state
	const [isDrawerOpen, setDrawerOpen] = useState(false);
	const [selectedSlot, setSelectedSlot] = useState<InventorySlot | EquipmentSlot | null>(null);

	// Get the appropriate slots based on mode
	const slots = mode === "inventory" ? actor.Inventory : actor.Equipment;

	// Handle item click - open drawer
	const handleItemClick = (slot: InventorySlot | EquipmentSlot) => {
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
        const item = campaign.ItemTemplates.find((t) => t.Id === slot.Id);
        if (!item) return null;

        // Format uses text
        const usesText =
            slot.UsesLeft !== undefined
                ? `${slot.UsesLeft}/${item.MaxUses || "∞"}`
                : "∞";
        const statCostText = item.StatCost
            ? `Costs ${formatStatCost(item.StatCost, campaign.Settings, "")}`
            : "";
        const actionCostText = item.ActionCost
            ? `Costs ${formatActionCost(item.ActionCost, campaign.Settings, "")}`
            : "";
        const details = [
            `${usesText} uses`,
            statCostText,
            actionCostText,
        ].filter(Boolean).join(" • ");

        return {
            id: `${slot.Id}-${index}`,
            label: item.Name,
            details,
            description: item.Description,
            imageId: item.Image,
            badge: item.DiceRoll,
            onClick: () => handleItemClick(slot),
        };
    })
    .filter(Boolean) as CollectionViewItem[];

	return (
		<>
			<CollectionView
				items={items}
				title={mode === "inventory" ? "Inventory" : "Equipment"}
				emptyMessage={
					mode === "inventory"
						? "No items in inventory"
						: "No items equipped"
				}
				viewModeKey={mode === "inventory" ? "inventory-view" : "equipment-view"}
				searchEnabled={true}
				searchPlaceholder="Search items..."
			/>

			{/* Item Slot Display Drawer */}
			{selectedSlot && (
				<ItemSlotDisplay
					isOpen={isDrawerOpen}
					onClose={handleCloseDrawer}
					slot={selectedSlot}
					actor={actor}
					mode={mode}
				/>
			)}
		</>
	);
}
