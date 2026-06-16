import type { Script, ScriptParam } from "../Script/Script";

/**
 * StatusExpiration determines how/when a status effect expires.
 * - permanent: Never expires (only removed manually)
 * - turns: Expires after a number of combat turns
 * - shortRest: Expires when a short rest (or long rest) is taken
 * - longRest: Expires when a long rest is taken
 * - days: Expires after a number of days
 */
export type StatusExpiration =
	| { type: "permanent" }
	| { type: "turns"; count: number }
	| { type: "shortRest" }
	| { type: "longRest" }
	| { type: "days"; count: number };

export interface Status {
	Id: string;
	Name: string;
	Description?: string;
	Image?: string;
	Tags?: string[];

	Expiration: StatusExpiration;

	// Scripting. Behavior hooks + DM-tunable param declarations (on the template).
	Scripts?: Script[];
	Parameters?: ScriptParam[];
}
