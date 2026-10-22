// domains/Actor/ActorOwnershipUtils.ts
//
// Owned actors: a Character can own other actors (characters or entities) via
// Actor.OwnerId. The owner's player controls an owned actor like their own
// character (move, edit, use items/skills from the inspector), it always fights
// on the party side, and the owner always sees it. Rules: only a Character can
// own, an owned actor can't own anything, and nothing owns itself -- so
// ownership is exactly one level deep.

import type { Campaign } from "../Campaign/Campaign";
import type { User } from "../User/User";
import type { Actor } from "./Actor";

type OwnershipUser = Pick<User, "Role" | "SelectedCharacters">;

/**
 * Whether `user` controls `actor`: the DM controls everything; a player controls
 * the character they play and every actor that character owns.
 */
export function userControlsActor(
	user: OwnershipUser,
	roomCode: string,
	actor: Pick<Actor, "Id" | "OwnerId">
): boolean {
	if (user.Role === "dm") return true;
	const myCharacterId = user.SelectedCharacters?.[roomCode];
	if (!myCharacterId) return false;
	return actor.Id === myCharacterId || actor.OwnerId === myCharacterId;
}

/** `userControlsActor` by id, resolving the actor among spawned actors. */
export function userControlsActorId(
	user: OwnershipUser,
	campaign: Campaign,
	actorId: string | undefined
): boolean {
	if (user.Role === "dm") return true;
	if (!actorId) return false;
	const actor =
		campaign.GameState.Characters.find((a) => a.Id === actorId) ??
		campaign.GameState.Entities.find((a) => a.Id === actorId);
	return userControlsActor(user, campaign.RoomCode, actor ?? { Id: actorId });
}

/** Owned actors fight on their owner's side: the party. */
export function isPartyActor(
	actor: Pick<Actor, "OwnerId">,
	kind: "character" | "entity"
): boolean {
	return kind === "character" || !!actor.OwnerId;
}

function everyActor(campaign: Campaign): Actor[] {
	return [
		...campaign.GameState.Characters,
		...campaign.GameState.Entities,
		...campaign.CharacterRoster,
		...campaign.EntityTemplates,
	];
}

/**
 * Why `ownerId` may not own `actorId`, or null when it may. `actorId` can be a
 * spawned actor, a roster character, an entity template, or a not-yet-created id.
 */
export function getOwnerError(
	campaign: Campaign,
	actorId: string,
	ownerId: string
): string | null {
	if (ownerId === actorId) return "An actor can't own itself.";
	const owner = [...campaign.GameState.Characters, ...campaign.CharacterRoster].find(
		(c) => c.Id === ownerId
	);
	if (!owner) return "Only characters can own actors.";
	if (owner.OwnerId) return `${owner.Name} is owned, so it can't own others.`;
	if (ownsActors(campaign, actorId)) return "This actor owns others, so it can't be owned.";
	return null;
}

/** Characters that may own `actorId` (for the owner picker). */
export function getOwnerCandidates(campaign: Campaign, actorId: string): Actor[] {
	return [...campaign.GameState.Characters, ...campaign.CharacterRoster].filter(
		(c) => getOwnerError(campaign, actorId, c.Id) === null
	);
}

/** Whether `actorId` owns any actor (an owner can't itself be owned). */
export function ownsActors(campaign: Campaign, actorId: string): boolean {
	return everyActor(campaign).some((a) => a.OwnerId === actorId);
}

/**
 * Drops an invalid OwnerId from `actor` in place (and empty strings). Used at
 * every write so a bad request can never build a chain or point at a non-character.
 */
export function sanitizeOwner(campaign: Campaign, actor: Pick<Actor, "Id" | "OwnerId">): void {
	if (!actor.OwnerId) {
		delete actor.OwnerId;
		return;
	}
	const error = getOwnerError(campaign, actor.Id, actor.OwnerId);
	if (error) {
		console.warn(`[Ownership] Ignoring owner for ${actor.Id}: ${error}`);
		delete actor.OwnerId;
	}
}

/** Clears OwnerId on everything owned by the given (deleted) characters. */
export function releaseOwnedActors(campaign: Campaign, ownerIds: string[]): void {
	if (ownerIds.length === 0) return;
	const owners = new Set(ownerIds);
	for (const actor of everyActor(campaign)) {
		if (actor.OwnerId && owners.has(actor.OwnerId)) delete actor.OwnerId;
	}
}
