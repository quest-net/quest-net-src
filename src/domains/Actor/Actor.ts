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
 * RegenRate/RestoreRule/OverflowTarget are optional overrides;
 * if undefined, the template's value is used.
 */
export interface StatSlot {
	Id: string;
	Current: number;
	Max: number;
	RegenRate?: number;
	RestoreRule?: RestoreRule;
	OverflowTarget?: {
		InventoryId: string;
		StatId: string;
	};
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
