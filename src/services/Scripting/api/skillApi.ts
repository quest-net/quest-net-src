/**
 * Skill operations.
 *
 * Shape: OPERATION MODULE (skills are slots on an actor, referenced by name). The
 * actor facade's `giveSkill`/`removeSkill`/`useSkill` forwarders delegate here.
 * Verbs normalized to give / remove / use (underlying: skill:give / skill:discard
 * / skill:use). Single-target only: applying to many actors is the author's loop.
 *
 * Resolution contract (every ref is name|id, resolved internally):
 *   - actor: ActorUtils.resolveActorId(campaign, ref) (the shared resolver; reads
 *     `.Id` off a held facade, or resolves a name/Id over active actors).
 *   - skill: SkillUtils.findTemplate (name|id -> template) for give; SkillUtils.findSlot
 *     (template Id matched against the actor's Skills) for remove/use, so we only
 *     dispatch when the actor actually knows the skill and otherwise no-op cleanly.
 *
 * Mutations route through `api.action` so cascades fire. We pass plain ids/values
 * (never a facade object) and never re-do clamping/guards the handlers already own
 * (cost deduction, uses-left checks, MaxUses sync — all live in SkillActions).
 */
import type { ScriptApiContext } from "./apiContext";
import type { ActorRef, RefByNameOrId } from "./actorApi";
import { ActorUtils } from "../../../domains/Actor/ActorUtils";
import { SkillUtils } from "../../../domains/Skill/SkillUtils";

/**
 * Teach a skill (name|id) to an actor. -> skill:give
 *
 * The handler is bulk (`{ skillIds, actorIds, count }`); the facade is single-target,
 * so we pass one-element arrays and count 1. Resolve the template by name|id (give
 * is keyed on the template, not an existing slot — the actor need not already have it).
 */
export function give(
	api: ScriptApiContext,
	actor: ActorRef,
	skill: RefByNameOrId
): Promise<void> {
	const campaign = api.campaign();
	const actorId = ActorUtils.resolveActorId(campaign, actor);
	const template = SkillUtils.findTemplate(campaign, skill);
	if (!actorId || !template) return Promise.resolve();
	return api.action("skill:give", {
		skillIds: [template.Id],
		actorIds: [actorId],
		count: 1,
	});
}

/**
 * Remove a skill (name|id) from an actor. -> skill:discard
 *
 * Drops one slot. Resolve the actor's slot first so a skill the actor doesn't have
 * no-ops cleanly (no doomed dispatch / "not found" warning). A slot's `Id` is its
 * template Id, which is what the handler expects as `skillId`.
 */
export function remove(
	api: ScriptApiContext,
	actor: ActorRef,
	skill: RefByNameOrId
): Promise<void> {
	const campaign = api.campaign();
	const target = ActorUtils.resolveActiveActor(campaign, actor);
	if (!target) return Promise.resolve();
	const slot = SkillUtils.findSlot(target, campaign, skill);
	if (!slot) return Promise.resolve();
	return api.action("skill:discard", { actorId: target.Id, skillId: slot.Id });
}

/**
 * Use a skill the actor knows (name|id). -> skill:use
 *
 * Single-target facade: no targetActorId/targetPosition (those are the targeting-mode
 * UI path). The handler owns cost deduction, uses-left checks, and the dice roll;
 * we only resolve and dispatch. Resolve the slot first so an unknown skill no-ops.
 */
export function use(
	api: ScriptApiContext,
	actor: ActorRef,
	skill: RefByNameOrId
): Promise<void> {
	const campaign = api.campaign();
	const target = ActorUtils.resolveActiveActor(campaign, actor);
	if (!target) return Promise.resolve();
	const slot = SkillUtils.findSlot(target, campaign, skill);
	if (!slot) return Promise.resolve();
	return api.action("skill:use", { actorId: target.Id, skillId: slot.Id });
}

/**
 * Set the remaining uses of a skill the actor knows (name|id). -> skill:adjustUses
 *
 * Absolute set, not a delta: `usesLeft` is the new value, or `undefined` for
 * unlimited (recharge a per-rest skill). Resolves the actor's slot first so a skill
 * the actor doesn't know no-ops cleanly. A slot's `Id` is its template Id, which is
 * what the handler expects as `skillId`.
 */
export function adjustUses(
	api: ScriptApiContext,
	actor: ActorRef,
	skill: RefByNameOrId,
	usesLeft: number | undefined
): Promise<void> {
	const campaign = api.campaign();
	const target = ActorUtils.resolveActiveActor(campaign, actor);
	if (!target) return Promise.resolve();
	const slot = SkillUtils.findSlot(target, campaign, skill);
	if (!slot) return Promise.resolve();
	return api.action("skill:adjustUses", { actorId: target.Id, skillId: slot.Id, usesLeft });
}
