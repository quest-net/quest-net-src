import { StatDefinition, ActionDefinition } from "../CampaignSetting/CampaignSetting";

export type ActorSize = "extra-small" | "small" | "medium" | "large";

export interface Actor {
	Id: string;
	Name: string;
	Description?: string;
	Image?: string;

	// Stats
	Stats: StatDefinition[];
	Actions: ActionDefinition[];

	//Attributes
	Attributes: Record<string, string>;

	//Position
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
