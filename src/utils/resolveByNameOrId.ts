// utils/resolveByNameOrId.ts

/**
 * The canonical "name OR Id" resolver for the scripting API facades (and anywhere
 * else a DM-typed reference must collapse to a single record). Every domain agent
 * imports this; keep the signature stable.
 *
 * Resolution order mirrors ScriptEngine.resolveTemplate exactly:
 *   1. Id exact match (Ids are GUIDs, so they never collide with a name)
 *   2. Name exact match, case-insensitive
 *   3. first glob match against Name (so "Gob*" resolves "Goblin")
 *   4. undefined
 *
 * Id is the unambiguous escape hatch: because Ids are GUIDs they can never collide
 * with a name, so checking Id first is always safe.
 */
export function resolveByNameOrId<T extends { Id: string; Name?: string }>(
	list: readonly T[],
	ref: string
): T | undefined {
	if (!Array.isArray(list) || list.length === 0) return undefined;
	if (ref == null) return undefined;

	// 1. Id exact.
	const byId = list.find((t) => t.Id === ref);
	if (byId) return byId;

	const lowered = String(ref).toLowerCase();

	// 2. Name exact (case-insensitive).
	const byName = list.find((t) => t.Name != null && t.Name.toLowerCase() === lowered);
	if (byName) return byName;

	// 3. First glob match against Name.
	return list.find((t) => t.Name != null && globMatches(ref, t.Name));
}

// ---- Glob matching ----------------------------------------------------------
// A small, self-contained glob (the same `*`-wildcard, anchored, case-insensitive
// behavior as ScriptEngine.globToRegExp) so this helper carries no domain deps.

const globCache = new Map<string, RegExp>();

function globToRegExp(glob: string): RegExp {
	let re = globCache.get(glob);
	if (!re) {
		const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
		re = new RegExp("^" + escaped + "$", "i");
		globCache.set(glob, re);
	}
	return re;
}

/** Anchored, case-insensitive glob match (`*` is the only wildcard). */
export function globMatches(glob: string, value: string): boolean {
	return globToRegExp(glob).test(value);
}
