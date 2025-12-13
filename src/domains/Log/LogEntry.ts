// LogEntry.ts - Updated
export interface LogEntry {
	Id: string;
	Timestamp: number;
	Action: string;
	Details?: string;

	// New fields
	Category: LogCategory;
	Level: LogLevel;
	Visibility: LogVisibility[];
	ActorId?: string; // Who performed the action
	TargetId?: string; // Who/what was affected
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
