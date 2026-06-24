// utils/ScriptLoader.ts
//
// Generic helper for loading a third-party browser script (e.g. the Google
// Identity Services library) on demand and resolving once it's ready. Caches by
// URL so repeated calls share a single <script> tag and a single load promise.

const inFlight = new Map<string, Promise<void>>();

/**
 * Dynamically injects a <script src=...> into <head> and resolves when it has
 * loaded. Subsequent calls for the same URL return the same promise. A failed
 * load is evicted from the cache so a later call can retry.
 */
export function loadScript(src: string): Promise<void> {
	const existing = inFlight.get(src);
	if (existing) return existing;

	const promise = new Promise<void>((resolve, reject) => {
		// Re-use a script tag that was already added (e.g. across hot reloads).
		const prior = document.querySelector<HTMLScriptElement>(
			`script[src="${src}"]`
		);
		if (prior && prior.dataset.loaded === "true") {
			resolve();
			return;
		}

		const el = prior ?? document.createElement("script");
		el.src = src;
		el.async = true;
		el.defer = true;
		el.addEventListener("load", () => {
			el.dataset.loaded = "true";
			resolve();
		});
		el.addEventListener("error", () =>
			reject(new Error(`Failed to load script: ${src}`))
		);
		if (!prior) document.head.appendChild(el);
	}).catch((err) => {
		inFlight.delete(src);
		throw err;
	});

	inFlight.set(src, promise);
	return promise;
}
