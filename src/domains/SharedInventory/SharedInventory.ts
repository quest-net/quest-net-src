// domains/SharedInventory/SharedInventory.ts
import { StatSlot, InventorySlot } from "../Actor/Actor";

/**
 * A shared inventory pool accessible by multiple actors. Instances live on
 * CampaignSettings.SharedInventories; this type is owned by the SharedInventory
 * domain that exposes the actions/UI for managing them.
 */
export interface SharedInventory {
	Id: string;
	Name: string;
	Stats: StatSlot[];
	Inventory: InventorySlot[];
}
