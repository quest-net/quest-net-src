// domains/Log/Log.ts
export interface LogEntry {
	Id: string;
	Timestamp: number;
	Action: string;
	Details?: string;

	// New fields
	Category: LogCategory;
	Level: LogLevel;
	Visibility: LogVisibility[];
	ActorId?: string; // The actor who performed the action; shown as the row's [label]. Omit for DM-applied actions (they read [DM])
	TargetId?: string; // Who/what was affected (e.g. the actor a DM spawned, created or removed)
	MentionedActorIds?: string[]; // Character IDs @mentioned in a chat message; "DM" sentinel for the DM
	RollOutcome?: RollOutcome; // Structured crit/fumble facts, computed once at roll time (see DiceUtils.getRollOutcome). Absent on legacy entries, which therefore never read as crits.
}

/**
 * The crit/fumble facts of a dice roll, derived structurally from the rolled
 * dice (kept + natural max/min on a d20/d100) at roll time. This is the single
 * source of truth for crit detection; nothing parses roll text, so the roll
 * line's wording can change freely.
 */
export interface RollOutcome {
	crit: boolean; // a kept d20/d100 came up natural max
	fumble: boolean; // a kept d20/d100 came up natural 1
	critValue: 20 | 100 | null; // the natural die that triggered the crit (100 wins if both)
}

export type LogCategory =
	| "combat" // Attacks, damage, status effects
	| "character" // Spawn, remove, death
	| "item" // Transfer, use, equip
	| "skill" // Skill usage
	| "dice" // Dice rolls
	| "movement" // Position changes
	| "scene" // Environment/audio changes
	| "chat" // Messaging
	| "sticker" // Ephemeral emojis
	| "ping" // Ephemeral map tile highlights
	| "system"; // Meta events

export type LogLevel =
	| "critical" // Character death, campaign milestones
	| "important" // Combat start/end, spawns, transfers
	| "info" // Dice rolls, item usage
	| "verbose"; // Movement, minor changes

export type LogVisibility =
	| "dm" // Only DM can see
	| "player" // Only players can see (not DM)
	| "owner" // Only the character owner can see
	| "all"; // Everyone can see
