/**
 * Light keyword-denylist validation for script source.
 *
 * This is NOT a sandbox. Scripts run unsandboxed via `AsyncFunction` on the DM, so
 * a determined author can obfuscate around any textual check (e.g. building a
 * string at runtime). The denylist exists to (a) stop the obvious escape vectors
 * — network, storage, DOM, the Function/constructor reflection trick — and (b)
 * make a malicious snippet visible to a glancing human review. Combined with the
 * fact that game.action only exposes actions explicitly marked scriptable in the
 * registry, this is a proportionate guard for scripts that only ever touch their
 * own campaign.
 *
 * Run at author time (block save) and again before execution (skip + log).
 */

/**
 * Forbidden identifiers. Matched as whole words (so "important" is fine even
 * though "import" is listed). Case-sensitive — these are JS identifiers.
 */
const FORBIDDEN_TOKENS = [
	// Global scope handles / frame escapes
	"window",
	"document",
	"globalThis",
	"self",
	"top",
	"parent",
	"navigator",
	"location",
	// Reflection escape (Function/constructor can rebuild `Function`)
	"eval",
	"Function",
	"constructor",
	"prototype",
	"__proto__",
	// Module system
	"import",
	"require",
	"module",
	"exports",
	"process",
	// Network
	"fetch",
	"XMLHttpRequest",
	"WebSocket",
	"EventSource",
	// Storage
	"localStorage",
	"sessionStorage",
	"indexedDB",
	// Workers / cross-context messaging
	"Worker",
	"importScripts",
	"postMessage",
] as const;

function escapeRegExp(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const FORBIDDEN_RE = new RegExp(
	"\\b(" + FORBIDDEN_TOKENS.map(escapeRegExp).join("|") + ")\\b"
);

/**
 * Returns the first forbidden token found in the code, or null if clean.
 * Strips line and block comments first so a banned word inside a comment does
 * not trip the check.
 */
export function findForbiddenToken(code: string): string | null {
	const stripped = code
		.replace(/\/\*[\s\S]*?\*\//g, " ") // block comments
		.replace(/\/\/[^\n]*/g, " "); // line comments
	const m = FORBIDDEN_RE.exec(stripped);
	return m ? m[1] : null;
}

export interface ScriptValidationResult {
	ok: boolean;
	/** Human-readable reason when !ok. */
	error?: string;
	/** The offending token when !ok. */
	token?: string;
}

/** Validate a script body. `ok: false` means it must not be saved or executed. */
export function validateScriptSource(code: string): ScriptValidationResult {
	if (typeof code !== "string") {
		return { ok: false, error: "Script code must be a string." };
	}
	const token = findForbiddenToken(code);
	if (token) {
		return {
			ok: false,
			token,
			error: `Disallowed keyword "${token}". Scripts may not use the network, storage, DOM, modules, or reflection escapes — only \`game\`, \`event\`, and \`this\`.`,
		};
	}
	return { ok: true };
}
