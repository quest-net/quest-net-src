// domains/Actor/ActorVisibilityUtils.ts
//
// The single player-visibility gate for spawned actors. Visibility is
// DISPLAY-ONLY: every client holds the identical campaign (so any player's copy
// can stand in for the DM's), and each player-facing view filters through here.
// The DM always sees everything.

import type { User } from "../User/User";
import type { Actor } from "./Actor";

/**
 * Whether `user` may see (render, list, select, inspect, target) `actor`.
 * An actor in `outOfSight` (the line-of-sight result from
 * useOutOfSightActorIds) is invisible to players. A player always sees the
 * character they play.
 */
export function isActorVisibleToUser(
	actor: Pick<Actor, "Id">,
	user: Pick<User, "Role" | "SelectedCharacters">,
	roomCode: string,
	outOfSight: ReadonlySet<string>
): boolean {
	if (user.Role === "dm") return true;
	if (user.SelectedCharacters?.[roomCode] === actor.Id) return true;
	return !outOfSight.has(actor.Id);
}

/**
 * What a player reads in place of the name of an actor they can't see. The
 * actor still acts (takes turns, rolls, shows up in the log); only its name is
 * withheld, as a run of blocks of the same length.
 */
export function redactActorName(name: string): string {
	return "█".repeat(name.length);
}
