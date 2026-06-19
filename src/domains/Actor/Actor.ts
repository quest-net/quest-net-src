import type { RestoreRule } from "../CampaignSetting/CampaignSetting";
import type { Script, ScriptParam, ScriptVars } from "../Script/Script";

export type ActorSize = "extra-small" | "small" | "medium" | "large";

export const ACTOR_DEFAULT_COLORS = {
	CHARACTER: "#2563eb",
	ENTITY: "#b45309",
	ITEM_ENTITY: "#f8fafc",
} as const;

export interface Actor {
	Id: string;
	Name: string;
	Description?: string;
	Image?: string;
	Color: string;

	// Slots referencing campaign-level templates by Id
	Stats: StatSlot[];
	Actions: ActionSlot[];
	Attributes: AttributeSlot[];

	// Position
	Position: Position;
	MoveSpeed: number;
	CanFly: boolean;
	Size?: ActorSize;
	/**
	 * Snapshot of the actor's position at the start of their current turn in
	 * combat. Set by CombatActions on combat start and on each side flip
	 * (for actors on the side whose turn is beginning). Cleared when combat
	 * ends. Used to compute remaining movement range during a turn — the
	 * difference between the actor's full move budget and the cheapest path
	 * cost from this snapshot to their current position.
	 *
	 * Not updated by ordinary moves; if forced movement carries the actor
	 * outside their original budget zone, the remaining-range UI is
	 * suppressed rather than re-anchored.
	 */
	TurnStartPosition?: Position;

	// Collections
	Inventory: InventorySlot[];
	Equipment: EquipmentSlot[]; // Item IDs that are equipped
	Skills: SkillSlot[]; // Skill IDs the character knows
	Statuses: StatusSlot[]; // StatusEffect IDs currently active

	// Optional
	Tags?: string[];

	// Scripting. Characters carry their hooks on the object itself; a spawned
	// entity is a structuredClone of its template, so template hooks ride along on
	// the instance. Parameters declare DM-tunable knobs; ScriptVars is actor-level
	// scratch read in scripts as `this.vars`.
	Scripts?: Script[];
	Parameters?: ScriptParam[];
	ScriptVars?: ScriptVars;
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
 * RegenRate / RestoreRule are optional slot-level overrides.
 *   - undefined  → inherit the value from the StatDefinition template
 *   - a value    → override the template (including RegenRate = 0, etc.)
 */
export interface StatSlot {
	Id: string;
	Current: number | null;
	Max: number;
	RegenRate?: number;
	RestoreRule?: RestoreRule;
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
	/** Per-instance script scratch (`this.vars` when this slot is the host). */
	ScriptVars?: ScriptVars;
}

export interface EquipmentSlot {
	Id: string;
	UsesLeft?: number;
	/** Per-instance script scratch (`this.vars` when this slot is the host). */
	ScriptVars?: ScriptVars;
}

export interface SkillSlot {
	Id: string;
	UsesLeft?: number;
	/** Per-instance script scratch (`this.vars` when this slot is the host). */
	ScriptVars?: ScriptVars;
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
	/** Per-instance script scratch (`this.vars` when this slot is the host). */
	ScriptVars?: ScriptVars;
}

export interface Position {
	/**
	 * Which VoxelTerrain this position lives in. The single source of truth for
	 * where an actor is and what terrain renders when it is selected.
	 */
	terrainId: string;
	x: number;
	y: number;
	h: number;
}
