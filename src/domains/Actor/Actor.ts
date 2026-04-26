import type { RestoreRule } from "../CampaignSetting/CampaignSetting";

export type ActorSize = "extra-small" | "small" | "medium" | "large";

export interface Actor {
	Id: string;
	Name: string;
	Description?: string;
	Image?: string;

	// Slots referencing campaign-level templates by Id
	Stats: StatSlot[];
	Actions: ActionSlot[];
	Attributes: AttributeSlot[];

	// Position
	Position: Position;
	MoveSpeed: number;
	CanFly: boolean;
	Size?: ActorSize;

	// Collections
	Inventory: InventorySlot[];
	Equipment: EquipmentSlot[]; // Item IDs that are equipped
	Skills: SkillSlot[]; // Skill IDs the character knows
	Statuses: StatusSlot[]; // StatusEffect IDs currently active

	// Optional
	Tags?: string[];
}

// ---- Stat/Action/Attribute Slots (instance data on actors) ----

/**
 * StatSlot stores per-actor stat instance data.
 * Id references a StatDefinition in CampaignSettings.
 *
 * Current: number = stat is set to that value; null = actor does not have
 * this stat (hidden from UI, skipped by regen/restore). Max is retained
 * while unset so re-enabling the stat can restore a sensible cap.
 *
 * RegenRate / RestoreRule / OverflowTarget are optional slot-level overrides.
 *   - undefined  → inherit the value from the StatDefinition template
 *   - a value    → override the template (including RegenRate = 0, etc.)
 *   - null       → (OverflowTarget only) explicitly disable overflow for this
 *                  slot even if the template defines a target
 */
export interface StatSlot {
	Id: string;
	Current: number | null;
	Max: number;
	RegenRate?: number;
	RestoreRule?: RestoreRule;
	OverflowTarget?: {
		InventoryId: string;
		StatId: string;
	} | null;
}

/**
 * ActionSlot stores per-actor action instance data.
 * Id references an ActionDefinition in CampaignSettings.
 * Max is the per-actor "actions per turn" (may differ from template default).
 * Current is the remaining actions this turn.
 */
export interface ActionSlot {
	Id: string;
	Max: number;
	Current: number;
}

/**
 * AttributeSlot stores per-actor attribute value.
 * Id references an AttributeDefinition in CampaignSettings.
 */
export interface AttributeSlot {
	Id: string;
	Value: string;
}

export interface InventorySlot {
	Id: string;
	UsesLeft?: number;
}

export interface EquipmentSlot {
	Id: string;
	UsesLeft?: number;
}

export interface SkillSlot {
	Id: string;
	UsesLeft?: number;
}

/**
 * StatusSlotExpiration tracks the runtime expiration state of an applied status.
 * - permanent: Never expires
 * - turns: Has a turnsLeft counter that decrements each combat turn
 * - shortRest: Expires on next short rest (or long rest)
 * - longRest: Expires on next long rest
 * - days: Has a daysLeft counter that decrements on long rest and calendar advance
 */
export type StatusSlotExpiration =
	| { type: "permanent" }
	| { type: "turns"; turnsLeft: number }
	| { type: "shortRest" }
	| { type: "longRest" }
	| { type: "days"; daysLeft: number };

export interface StatusSlot {
	Id: string;
	expiration: StatusSlotExpiration;
}

export interface Position {
	x: number;
	y: number;
	h: number;
}
