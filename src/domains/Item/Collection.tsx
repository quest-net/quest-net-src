// domains/Item/Collection.tsx

import { CollectionView, CollectionViewItem } from "../../components/CollectionView/CollectionView";
import { useQuestContext } from "../Context/ContextProvider";
import { CampaignUtils } from "../Campaign/CampaignUtils";
import { Actor, InventorySlot, EquipmentSlot } from "../Actor/Actor";
import { Item } from "./Item";
import { ItemSlotDisplay } from "./ItemSlotDisplay";
import { ItemEdit } from "./Edit";
import { FormDrawer } from "../../components/ui/FormDrawer";
import { useAnimatedDrawer } from "../../hooks/useAnimatedDrawer";
import { formatActionCost, formatStatCost } from "../Actor/ActorCostUtils";

interface ItemCollectionProps {
	actor: Actor;
	mode: "inventory" | "equipment";
}

export function ItemCollection({ actor, mode }: ItemCollectionProps) {
	const context = useQuestContext();
	const campaign = CampaignUtils.getActiveCampaign(context);
	const isDm = context.User.Role === "dm";

	// Slot detail drawer (read-only) and DM template-edit drawer.
	const slotDrawer = useAnimatedDrawer<InventorySlot | EquipmentSlot>();
	const editDrawer = useAnimatedDrawer<Item>();

	// Get the appropriate slots based on mode
	const slots = mode === "inventory" ? actor.Inventory : actor.Equipment;

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
            onClick: () => slotDrawer.open(slot),
            ...(isDm ? { onEdit: () => editDrawer.open(item) } : {}),
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
			{slotDrawer.value && (
				<ItemSlotDisplay
					isOpen={slotDrawer.isOpen}
					onClose={slotDrawer.close}
					slot={slotDrawer.value}
					actor={actor}
					mode={mode}
				/>
			)}

			{/* DM Template Edit Drawer */}
			{editDrawer.value && (
				<FormDrawer isOpen={editDrawer.isOpen} onClose={editDrawer.close}>
					<ItemEdit item={editDrawer.value} onClose={editDrawer.close} />
				</FormDrawer>
			)}
		</>
	);
}
