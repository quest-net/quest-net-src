import { StatDefinition } from "../CampaignSetting/CampaignSetting";

export interface Actor {
	Id: string;
	Name: string;
	Description?: string;
	Image?: string;

	// Stats
	Stats: StatDefinition[];

	//Attributes
	Attributes: Record<string, string>;

	//Position
	Position: Position;
	MoveSpeed: number;
	CanFly: boolean;

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
