// domains/Log/MentionUtils.ts
//
// Name-aware @mention parsing for chat log messages. Character names can
// contain spaces (e.g. "John Smith"), so we can't rely on a naive regex —
// instead we match the text after each "@" against the known list of
// mentionable targets, longest name first, and store resolved IDs.

import { Campaign } from "../Campaign/Campaign";

// Sentinel ID used for the DM, who has no character record.
export const DM_MENTION_ID = "DM";

export interface MentionTarget {
	id: string;
	name: string;
}

export interface MentionMatch {
	start: number; // index of the "@"
	end: number; // index just past the matched name
	id: string;
	name: string; // the canonical target name (as it should display)
}

export interface ParsedMentions {
	mentionedActorIds: string[];
	matches: MentionMatch[];
}

const EMPTY: ParsedMentions = { mentionedActorIds: [], matches: [] };

/**
 * The set of things a chat message can @mention: every active party member
 * plus the DM. Sorted longest-name-first so greedy matching prefers
 * "John Smith" over "John".
 */
export function getMentionTargets(campaign: Campaign): MentionTarget[] {
	const targets: MentionTarget[] = campaign.GameState.Characters.map((c) => ({
		id: c.Id,
		name: c.Name,
	}));
	targets.push({ id: DM_MENTION_ID, name: "DM" });

	return targets
		.filter((t) => t.name && t.name.trim().length > 0)
		.sort((a, b) => b.name.length - a.name.length);
}

// A name match must not be immediately followed by another word character,
// so "@John" does not match the target "Jo" and "@Johnathan" does not match
// "John". Spaces are allowed *inside* names, so the boundary check only looks
// at alphanumerics.
function isWordChar(ch: string | undefined): boolean {
	return !!ch && /[A-Za-z0-9]/.test(ch);
}

/**
 * Parse @mentions out of a message against the given targets.
 * Matching is case-insensitive and deduplicates resolved IDs.
 */
export function parseMentions(
	message: string,
	targets: MentionTarget[]
): ParsedMentions {
	if (!message || targets.length === 0) return EMPTY;

	const matches: MentionMatch[] = [];
	const ids = new Set<string>();
	const lower = message.toLowerCase();

	for (let i = 0; i < message.length; i++) {
		if (message[i] !== "@") continue;
		// "@" must start the message or follow whitespace.
		if (i > 0 && !/\s/.test(message[i - 1])) continue;

		const nameStart = i + 1;
		// Targets are pre-sorted longest-first, so the first hit is the
		// greediest valid match.
		for (const target of targets) {
			const name = target.name;
			const slice = lower.substr(nameStart, name.length);
			if (slice !== name.toLowerCase()) continue;
			// Reject partial-word matches like "@Johnathan" -> "John".
			if (isWordChar(message[nameStart + name.length])) continue;

			matches.push({
				start: i,
				end: nameStart + name.length,
				id: target.id,
				name,
			});
			ids.add(target.id);
			// Skip past the matched name so its interior "@"-free text isn't
			// re-scanned.
			i = nameStart + name.length - 1;
			break;
		}
	}

	return { mentionedActorIds: Array.from(ids), matches };
}
