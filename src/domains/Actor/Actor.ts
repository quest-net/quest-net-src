import { StatDefinition, ActionDefinition } from "../CampaignSetting/CampaignSetting";

export type ActorSize = "small" | "medium" | "large";

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

export interface StatusSlot {
	Id: string;
	turnsLeft?: number;
}

export interface Position {
	x: number;
	y: number;
	h: number;
}
