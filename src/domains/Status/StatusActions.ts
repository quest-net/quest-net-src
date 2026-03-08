// domains/Status/StatusActions.ts

import { Context } from "../Context/Context";
import { CampaignActions } from "../Campaign/CampaignActions";
import { LogActions } from "../Log/LogActions";
import { Status, StatusExpiration } from "./Status";
import { Actor, StatusSlotExpiration } from "../Actor/Actor";
import { syncStatusSlotsAfterEdit, getAllActors } from "../../utils/SlotSyncUtils";

/**
 * Converts a template StatusExpiration to a runtime StatusSlotExpiration
 */
function templateToSlotExpiration(expiration: StatusExpiration): StatusSlotExpiration {
	switch (expiration.type) {
		case "permanent":
			return { type: "permanent" };
		case "turns":
			return { type: "turns", turnsLeft: expiration.count };
		case "shortRest":
			return { type: "shortRest" };
		case "longRest":
			return { type: "longRest" };
		case "days":
			return { type: "days", daysLeft: expiration.count };
	}
}

/**
 * Formats a StatusSlotExpiration for display text
 */
export function formatSlotExpiration(exp: StatusSlotExpiration): string {
	switch (exp.type) {
		case "permanent":
			return "Permanent (never expires)";
		case "turns":
			return `${exp.turnsLeft} turn${exp.turnsLeft === 1 ? '' : 's'} remaining`;
		case "shortRest":
			return "Until short rest";
		case "longRest":
			return "Until long rest";
		case "days":
			return `${exp.daysLeft} day${exp.daysLeft === 1 ? '' : 's'} remaining`;
	}
}

/**
 * Formats a template StatusExpiration for display text
 */
export function formatTemplateExpiration(exp: StatusExpiration): string {
	switch (exp.type) {
		case "permanent":
			return "Permanent";
		case "turns":
			return `${exp.count} turn${exp.count === 1 ? '' : 's'}`;
		case "shortRest":
			return "Until short rest";
		case "longRest":
			return "Until long rest";
		case "days":
			return `${exp.count} day${exp.count === 1 ? '' : 's'}`;
	}
}

/**
 * Status action handlers
 * Statuses are templates stored at Campaign.StatusTemplates
 */
export const StatusActions = {
	/**
	 * Creates a default status template
	 */
	createDefault(_context: Context): Status {
		return {
			Id: crypto.randomUUID(),
			Name: "New Status",
			Description: "",
			Image: undefined,
			Tags: [],
			Expiration: { type: "turns", count: 3 }, // Default 3 turns
		};
	},

	/**
	 * Creates a new status and adds to the campaign status templates
	 */
	create(params: { status: Status }, context: Context): void {
		const campaign = CampaignActions.getActiveCampaign(context);
		campaign.StatusTemplates.push(params.status);

		LogActions.create(
			{
				action: "Status created",
				details: `${params.status.Name} added to status templates`,
				category: "combat",
				level: "info",
				visibility: ["dm"],
			},
			context
		);
	},

	/**
	 * Edits an existing status
	 * Syncs all actor slots if Expiration changes
	 */
	edit(
		params: { statusId: string; updates: Partial<Status> },
		context: Context
	): void {
		const campaign = CampaignActions.getActiveCampaign(context);
		const idx = campaign.StatusTemplates.findIndex((s) => s.Id === params.statusId);
		if (idx === -1) {
			console.warn(`Status not found: ${params.statusId}`);
			return;
		}

		const oldExpiration = campaign.StatusTemplates[idx].Expiration;
		const newExpiration = params.updates.Expiration;

		// Apply updates
		campaign.StatusTemplates[idx] = {
			...campaign.StatusTemplates[idx],
			...params.updates,
			Id: campaign.StatusTemplates[idx].Id, // guard against accidental Id overwrite
		};

		// If Expiration changed, sync all actor slots
		if (newExpiration && JSON.stringify(newExpiration) !== JSON.stringify(oldExpiration)) {
			const allActors = getAllActors(campaign);
			syncStatusSlotsAfterEdit(params.statusId, newExpiration, allActors);
		}

		LogActions.create(
			{
				action: "Status edited",
				details: `${campaign.StatusTemplates[idx].Name} updated`,
				category: "combat",
				level: "info",
				visibility: ["dm"],
			},
			context
		);
	},

	/**
	 * Deletes a status template permanently
	 */
	delete(params: { statusId: string }, context: Context): void {
		const campaign = CampaignActions.getActiveCampaign(context);
		const idx = campaign.StatusTemplates.findIndex((s) => s.Id === params.statusId);
		if (idx === -1) {
			console.warn(`Status not found: ${params.statusId}`);
			return;
		}
		const [removed] = campaign.StatusTemplates.splice(idx, 1);

		LogActions.create(
			{
				action: "Status deleted",
				details: `${removed?.Name ?? "Status"} removed from templates`,
				category: "combat",
				level: "important",
				visibility: ["dm"],
			},
			context
		);
	},

	/**
	 * Applies statuses to actors (characters or entities)
	 * Each actor receives `count` copies of each status
	 */
	give(
		params: {
			statusIds: string[];
			actorIds: string[];
			count: number;
		},
		context: Context
	): void {
		const campaign = CampaignActions.getActiveCampaign(context);

		// Validate count
		const count = Math.max(1, Math.floor(params.count));

		// Combine all actors (IDs are unique)
		const actors: Actor[] = getAllActors(campaign);

		let totalApplied = 0;
		const actorNames: string[] = [];

		// For each actor
		params.actorIds.forEach((actorId) => {
			const actor = actors.find((a) => a.Id === actorId);
			if (!actor) {
				console.warn(`Actor not found: ${actorId}`);
				return;
			}

			actorNames.push(actor.Name);

			// For each status
			params.statusIds.forEach((statusId) => {
				const statusTemplate = campaign.StatusTemplates.find((s) => s.Id === statusId);
				if (!statusTemplate) {
					console.warn(`Status template not found: ${statusId}`);
					return;
				}

				// Apply `count` copies of this status to this actor
				for (let i = 0; i < count; i++) {
					actor.Statuses.push({
						Id: statusId,
						expiration: templateToSlotExpiration(statusTemplate.Expiration),
					});
					totalApplied++;
				}
			});
		});

		// Log the action
		if (totalApplied > 0) {
			const statusNames = params.statusIds
				.map((id) => campaign.StatusTemplates.find((s) => s.Id === id)?.Name)
				.filter(Boolean)
				.join(", ");

			LogActions.create(
				{
					action: "Statuses applied",
					details: `${statusNames} (${totalApplied} total) applied to ${actorNames.join(", ")}`,
					category: "combat",
					level: "important",
					visibility: ["all"],
				},
				context
			);
		}
	},

	/**
	 * Bulk edit tags for multiple statuses
	 */
	bulkEditTags(
		params: { updates: Array<{ statusId: string; tags: string[] }> },
		context: Context
	): void {
		const campaign = CampaignActions.getActiveCampaign(context);

		let successCount = 0;
		params.updates.forEach((update) => {
			const status = campaign.StatusTemplates.find((s) => s.Id === update.statusId);
			if (status) {
				status.Tags = update.tags;
				successCount++;
			} else {
				console.warn(`Status not found for bulk update: ${update.statusId}`);
			}
		});

		LogActions.create(
			{
				action: "Statuses organized",
				details: `Updated tags for ${successCount} status(es)`,
				category: "combat",
				level: "info",
				visibility: ["dm"],
			},
			context
		);
	},

	/**
	 * Removes a status from an actor
	 * Works with any actor (characters or entities, in any location)
	 */
	remove(
		params: { actorId: string; statusId: string },
		context: Context
	): void {
		const campaign = CampaignActions.getActiveCampaign(context);

		// Find actor in all possible locations
		const actors: Actor[] = getAllActors(campaign);

		const actor = actors.find((a) => a.Id === params.actorId);
		if (!actor) {
			console.warn(`Actor not found: ${params.actorId}`);
			return;
		}

		// Find the status template for logging
		const statusTemplate = campaign.StatusTemplates.find((s) => s.Id === params.statusId);
		const statusName = statusTemplate?.Name || "Unknown Status";

		// Find and remove the status (removes first instance)
		const statusIndex = actor.Statuses.findIndex((s) => s.Id === params.statusId);
		if (statusIndex !== -1) {
			actor.Statuses.splice(statusIndex, 1);

			LogActions.create(
				{
					action: "Status removed",
					details: `${statusName} removed from ${actor.Name}`,
					category: "combat",
					level: "info",
					visibility: ["all"],
					actorId: params.actorId,
				},
				context
			);
			return;
		}

		console.warn(`Status not found in actor's statuses: ${params.statusId}`);
	},

	/**
	 * Adjusts the expiration of a status on an actor
	 */
	adjustDuration(
		params: { actorId: string; statusId: string; expiration: StatusSlotExpiration },
		context: Context
	): void {
		const campaign = CampaignActions.getActiveCampaign(context);

		// Find actor in all possible locations
		const actors: Actor[] = getAllActors(campaign);

		const actor = actors.find((a) => a.Id === params.actorId);
		if (!actor) {
			console.warn(`Actor not found: ${params.actorId}`);
			return;
		}

		// Find the status slot (first instance)
		const slot = actor.Statuses.find((s) => s.Id === params.statusId);
		if (!slot) {
			console.warn(`Status not found in actor's statuses: ${params.statusId}`);
			return;
		}

		// Update expiration
		slot.expiration = params.expiration;

		// Find the status template for logging
		const statusTemplate = campaign.StatusTemplates.find((s) => s.Id === params.statusId);
		const statusName = statusTemplate?.Name || "Unknown Status";

		const durationText = formatSlotExpiration(params.expiration);

		LogActions.create(
			{
				action: "Status duration adjusted",
				details: `${statusName} on ${actor.Name} set to ${durationText}`,
				category: "combat",
				level: "info",
				visibility: ["dm"],
				actorId: params.actorId,
			},
			context
		);
	},
};
