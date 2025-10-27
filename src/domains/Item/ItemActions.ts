// domains/Item/ItemActions.ts

import { Context } from "../Context/Context";
import { CampaignActions } from "../Campaign/CampaignActions";
import { LogActions } from "../Log/LogActions";
import { Item } from "./Item";

/**
 * Item action handlers
 * Items are templates stored at Campaign.ItemTemplates
 */
export const ItemActions = {
  /**
   * Creates a default item template
   */
  createDefault(_context: Context): Item {
    return {
      Id: crypto.randomUUID(),
      Name: "New Item",
      Description: "",
      Image: undefined,
      Tags: [],
      MaxUses: undefined,
      IsEquippable: false,
      DiceRoll: ""
    };
  },

  /**
   * Creates a new item and adds to the campaign item templates
   */
  create(params: { item: Item }, context: Context): void {
    const campaign = CampaignActions.getActiveCampaign(context);
    campaign.ItemTemplates.push(params.item);

    LogActions.create({
      action: "Item created",
      details: `${params.item.Name} added to item templates`,
      category: "item",
      level: "info",
      visibility: ["dm", "owner"]
    }, context);
  },

  /**
   * Edits an existing item
   */
  edit(params: { itemId: string; updates: Partial<Item> }, context: Context): void {
    const campaign = CampaignActions.getActiveCampaign(context);
    const idx = campaign.ItemTemplates.findIndex(i => i.Id === params.itemId);
    if (idx === -1) {
      console.warn(`Item not found: ${params.itemId}`);
      return;
    }
    campaign.ItemTemplates[idx] = {
      ...campaign.ItemTemplates[idx],
      ...params.updates,
      Id: campaign.ItemTemplates[idx].Id // guard against accidental Id overwrite
    };

    LogActions.create({
      action: "Item edited",
      details: `${campaign.ItemTemplates[idx].Name} updated`,
      category: "item",
      level: "info",
      visibility: ["dm"]
    }, context);
  },

  /**
   * Deletes an item template permanently
   */
  delete(params: { itemId: string }, context: Context): void {
    const campaign = CampaignActions.getActiveCampaign(context);
    const idx = campaign.ItemTemplates.findIndex(i => i.Id === params.itemId);
    if (idx === -1) {
      console.warn(`Item not found: ${params.itemId}`);
      return;
    }
    const [removed] = campaign.ItemTemplates.splice(idx, 1);

    LogActions.create({
      action: "Item deleted",
      details: `${removed?.Name ?? 'Item'} removed from templates`,
      category: "item",
      level: "important",
      visibility: ["dm"]
    }, context);
  },

  /**
   * Bulk edit tags for multiple items
   */
  bulkEditTags(
    params: { updates: Array<{ itemId: string; tags: string[] }> },
    context: Context
  ): void {
    const campaign = CampaignActions.getActiveCampaign(context);

    let successCount = 0;
    params.updates.forEach(update => {
      const item = campaign.ItemTemplates.find(i => i.Id === update.itemId);
      if (item) {
        item.Tags = update.tags;
        successCount++;
      } else {
        console.warn(`Item not found for bulk update: ${update.itemId}`);
      }
    });

    LogActions.create({
      action: "Items organized",
      details: `Updated tags for ${successCount} item(s)`,
      category: "item",
      level: "info",
      visibility: ["dm"]
    }, context);
  }
};
