// hooks/useDebounced.ts
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * The standard debounce delay for committing UI edits to game state. Used
 * across the app so that rapid input (typing, dragging, stepping) coalesces
 * into a single state sync instead of one per keystroke/frame. Prefer this
 * constant over inlining a number so the feel stays consistent everywhere.
 *
 * Snappier surfaces (e.g. sliders that want near-live feedback) may pass a
 * shorter delay explicitly, but the default should cover the vast majority.
 */
export const DEBOUNCE_MS = 500;

/**
 * A shorter delay for surfaces whose *committed* value drives immediate
 * audible/visible feedback (e.g. the audio volume slider, where the playing
 * volume reads from the synced value rather than local state). These must stay
 * snappy, so the full {@link DEBOUNCE_MS} would feel laggy. Prefer this sibling
 * constant over inlining a number so "live" surfaces share one value too.
 */
export const LIVE_DEBOUNCE_MS = 150;

export interface DebouncedFn<A extends unknown[]> {
	(...args: A): void;
	/** Immediately invoke the pending call (if any) and clear the timer. */
	flush: () => void;
	/** Drop the pending call (if any) without invoking it. */
	cancel: () => void;
}

/**
 * Wraps a callback so repeated calls within `delay` ms collapse into a single
 * trailing invocation with the latest arguments. The returned function is
 * stable across renders and always sees the latest `callback`/`delay`.
 *
 * On unmount the pending call is flushed by default (so a user's last edit is
 * never silently lost); pass `flushOnUnmount: false` to drop it instead.
 *
 * @example
 *   const commitName = useDebouncedCallback((name: string) =>
 *     actionService.execute("character:edit", { id, name })
 *   );
 *   <input onChange={(e) => commitName(e.target.value)} />
 */
export function useDebouncedCallback<A extends unknown[]>(
	callback: (...args: A) => void,
	delay: number = DEBOUNCE_MS,
	options: { flushOnUnmount?: boolean } = {}
): DebouncedFn<A> {
	const { flushOnUnmount = true } = options;

	// Refs keep the stable debounced fn pointed at the latest values without
	// recreating it (which would reset in-flight timers / break identity).
	const callbackRef = useRef(callback);
	callbackRef.current = callback;
	const delayRef = useRef(delay);
	delayRef.current = delay;

	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const pendingArgs = useRef<A | null>(null);

	const debounced = useMemo<DebouncedFn<A>>(() => {
		const run = (...args: A) => {
			pendingArgs.current = args;
			if (timer.current) clearTimeout(timer.current);
			timer.current = setTimeout(() => {
				timer.current = null;
				const args = pendingArgs.current;
				pendingArgs.current = null;
				if (args) callbackRef.current(...args);
			}, delayRef.current);
		};

		const fn = run as DebouncedFn<A>;

		fn.cancel = () => {
			if (timer.current) {
				clearTimeout(timer.current);
				timer.current = null;
			}
			pendingArgs.current = null;
		};

		fn.flush = () => {
			if (timer.current) {
				clearTimeout(timer.current);
				timer.current = null;
			}
			const args = pendingArgs.current;
			pendingArgs.current = null;
			if (args) callbackRef.current(...args);
		};

		return fn;
	}, []);

	useEffect(() => {
		return () => {
			if (flushOnUnmount) debounced.flush();
			else debounced.cancel();
		};
	}, [debounced, flushOnUnmount]);

	return debounced;
}

/**
 * The app's most common debounce shape: a local mirror of an authoritative
 * value that updates instantly for responsiveness, while changes are committed
 * (synced) on a trailing debounce. The mirror resyncs whenever the external
 * value changes (a commit echo, a long rest, a peer update, etc.).
 *
 * Returns `[localValue, setValue, controls]` where calling `setValue` updates
 * the mirror immediately and schedules a debounced `onCommit`. `controls.flush`
 * commits the pending value now; `controls.cancel` discards it.
 *
 * @example
 *   const [name, setName] = useDebouncedValue(actor.Name, (v) =>
 *     actionService.execute("actor:edit", { id, name: v })
 *   );
 *   <input value={name} onChange={(e) => setName(e.target.value)} />
 */
export function useDebouncedValue<T>(
	external: T,
	onCommit: (value: T) => void,
	delay: number = DEBOUNCE_MS,
	options: { flushOnUnmount?: boolean } = {}
): [T, (value: T) => void, { flush: () => void; cancel: () => void }] {
	const [local, setLocal] = useState(external);
	const commit = useDebouncedCallback(onCommit, delay, options);

	// Resync the mirror when the authoritative value changes out from under us.
	useEffect(() => {
		setLocal(external);
	}, [external]);

	const setValue = useCallback(
		(value: T) => {
			setLocal(value);
			commit(value);
		},
		[commit]
	);

	return [local, setValue, { flush: commit.flush, cancel: commit.cancel }];
}
