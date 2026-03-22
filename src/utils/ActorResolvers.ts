// domains/Actor/ActorResolvers.ts
// Utilities for resolving actor slots against campaign-level templates.
// These combine template data (Name, Color, etc.) with instance data (Current, Max, etc.)
// so that UI components get a single merged object to render.

import type { StatSlot, ActionSlot, AttributeSlot } from "../domains/Actor/Actor";
import type {
	StatDefinition,
	ActionDefinition,
	AttributeDefinition,
	RestoreRule,
} from "../domains/CampaignSetting/CampaignSetting";

// ---- Resolved types (template + instance merged for UI consumption) ----

export interface ResolvedStat {
	Id: string;
	Name: string;
	Color: string;
	Current: number;
	Max: number;
	RegenRate?: number;
	RestoreRule?: RestoreRule;
	OverflowTarget?: {
		InventoryId: string;
		StatId: string;
	};
}

export interface ResolvedAction {
	Id: string;
	Name: string;
	Color: string;
	Max: number;
	Current: number;
}

export interface ResolvedAttribute {
	Id: string;
	Name: string;
	Value: string;
}

// ---- Resolve functions ----

/**
 * Resolves a single StatSlot against its template.
 * Slot overrides (RegenRate, RestoreRule, OverflowTarget) take precedence
 * over template defaults when defined.
 */
export function resolveStat(
	slot: StatSlot,
	template: StatDefinition
): ResolvedStat {
	return {
		Id: slot.Id,
		Name: template.Name,
		Color: template.Color,
		Current: slot.Current,
		Max: slot.Max,
		RegenRate: slot.RegenRate ?? template.RegenRate,
		RestoreRule: slot.RestoreRule ?? template.RestoreRule,
		OverflowTarget: slot.OverflowTarget ?? template.OverflowTarget,
	};
}

/**
 * Resolves all StatSlots for an actor against campaign templates.
 * Slots with no matching template are dropped (orphaned data).
 */
export function resolveStats(
	slots: StatSlot[],
	templates: StatDefinition[]
): ResolvedStat[] {
	const templateMap = new Map(templates.map((t) => [t.Id, t]));
	return slots
		.map((slot) => {
			const template = templateMap.get(slot.Id);
			if (!template) return null;
			return resolveStat(slot, template);
		})
		.filter((r): r is ResolvedStat => r !== null);
}

/**
 * Resolves a single ActionSlot against its template.
 */
export function resolveAction(
	slot: ActionSlot,
	template: ActionDefinition
): ResolvedAction {
	return {
		Id: slot.Id,
		Name: template.Name,
		Color: template.Color,
		Max: slot.Max,
		Current: slot.Current,
	};
}

/**
 * Resolves all ActionSlots for an actor against campaign templates.
 */
export function resolveActions(
	slots: ActionSlot[],
	templates: ActionDefinition[]
): ResolvedAction[] {
	const templateMap = new Map(templates.map((t) => [t.Id, t]));
	return slots
		.map((slot) => {
			const template = templateMap.get(slot.Id);
			if (!template) return null;
			return resolveAction(slot, template);
		})
		.filter((r): r is ResolvedAction => r !== null);
}

/**
 * Resolves a single AttributeSlot against its template.
 */
export function resolveAttribute(
	slot: AttributeSlot,
	template: AttributeDefinition
): ResolvedAttribute {
	return {
		Id: slot.Id,
		Name: template.Name,
		Value: slot.Value,
	};
}

/**
 * Resolves all AttributeSlots for an actor against campaign templates.
 */
export function resolveAttributes(
	slots: AttributeSlot[],
	templates: AttributeDefinition[]
): ResolvedAttribute[] {
	const templateMap = new Map(templates.map((t) => [t.Id, t]));
	return slots
		.map((slot) => {
			const template = templateMap.get(slot.Id);
			if (!template) return null;
			return resolveAttribute(slot, template);
		})
		.filter((r): r is ResolvedAttribute => r !== null);
}

// ---- Slot creation helpers ----

/**
 * Creates default StatSlots from campaign templates (for new actors).
 */
export function createDefaultStatSlots(templates: StatDefinition[]): StatSlot[] {
	return templates.map((t) => ({
		Id: t.Id,
		Current: t.Max,
		Max: t.Max,
	}));
}

/**
 * Creates default ActionSlots from campaign templates (for new actors).
 */
export function createDefaultActionSlots(templates: ActionDefinition[]): ActionSlot[] {
	return templates.map((t) => ({
		Id: t.Id,
		Max: t.Max,
		Current: t.Max,
	}));
}

/**
 * Creates default AttributeSlots from campaign templates (for new actors).
 */
export function createDefaultAttributeSlots(templates: AttributeDefinition[]): AttributeSlot[] {
	return templates.map((t) => ({
		Id: t.Id,
		Value: "",
	}));
}

// ---- Slot propagation helpers (when templates change) ----

/**
 * Ensures actor stat slots match the current template set.
 * - New templates get default slots added.
 * - Removed templates have their slots dropped.
 * - Existing slots preserve their instance data.
 */
export function syncStatSlots(
	slots: StatSlot[],
	templates: StatDefinition[]
): StatSlot[] {
	const existingMap = new Map(slots.map((s) => [s.Id, s]));

	return templates.map((t) => {
		const existing = existingMap.get(t.Id);
		if (existing) return existing;
		return { Id: t.Id, Current: t.Max, Max: t.Max };
	});
}

/**
 * Ensures actor action slots match the current template set.
 */
export function syncActionSlots(
	slots: ActionSlot[],
	templates: ActionDefinition[]
): ActionSlot[] {
	const existingMap = new Map(slots.map((s) => [s.Id, s]));

	return templates.map((t) => {
		const existing = existingMap.get(t.Id);
		if (existing) return existing;
		return { Id: t.Id, Max: t.Max, Current: t.Max };
	});
}

/**
 * Ensures actor attribute slots match the current template set.
 */
export function syncAttributeSlots(
	slots: AttributeSlot[],
	templates: AttributeDefinition[]
): AttributeSlot[] {
	const existingMap = new Map(slots.map((s) => [s.Id, s]));

	return templates.map((t) => {
		const existing = existingMap.get(t.Id);
		if (existing) return existing;
		return { Id: t.Id, Value: "" };
	});
}
