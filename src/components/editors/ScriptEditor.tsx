// components/editors/ScriptEditor.tsx
//
// Raw editor for a scriptable object's behavior scripts (v2 ECA rules). Each
// script is { Trigger, Code, Name?, Enabled? }: it runs when a dispatched action
// matches the Trigger glob, with `game`, `event`, and `this` in scope. Lives
// behind an "Advanced" collapse on edit forms — scripts are usually machine
// written, and debugging happens in the Wiki test harness.

import { useMemo, type KeyboardEvent } from "react";
import type { Script } from "../../domains/Script/Script";
import { ACTION_REGISTRY } from "../../services/Actions/ActionRegistry";
import { validateScriptSource } from "../../services/Scripting/scriptValidation";

interface ScriptEditorProps {
	scripts: Script[];
	onChange: (scripts: Script[]) => void;
	readOnly?: boolean;
}

export function ScriptEditor({ scripts, onChange, readOnly }: ScriptEditorProps) {
	// A script can trigger on any action key. Script-ok only limits what
	// game.action(...) may call from inside script code.
	const actionKeys = useMemo(() => Object.keys(ACTION_REGISTRY).sort(), []);

	const update = (index: number, patch: Partial<Script>) => {
		onChange(scripts.map((s, i) => (i === index ? { ...s, ...patch } : s)));
	};
	const add = () => {
		onChange([
			...scripts,
			{ Name: "", Trigger: "combat:incrementRound", Code: "", Enabled: true },
		]);
	};
	const remove = (index: number) => {
		onChange(scripts.filter((_, i) => i !== index));
	};

	const updateSelection = (
		target: HTMLTextAreaElement,
		start: number,
		end: number
	) => {
		requestAnimationFrame(() => {
			target.selectionStart = start;
			target.selectionEnd = end;
		});
	};

	const handleCodeKeyDown = (
		event: KeyboardEvent<HTMLTextAreaElement>,
		index: number
	) => {
		if (event.key !== "Tab" || readOnly) return;
		event.preventDefault();

		const target = event.currentTarget;
		const { value, selectionStart, selectionEnd } = target;
		const lineStart = value.lastIndexOf("\n", Math.max(0, selectionStart - 1)) + 1;
		const lineEndIndex = value.indexOf("\n", selectionEnd);
		const lineEnd = lineEndIndex === -1 ? value.length : lineEndIndex;
		const hasMultilineSelection = value.slice(selectionStart, selectionEnd).includes("\n");

		if (!hasMultilineSelection && !event.shiftKey) {
			const nextCode =
				value.slice(0, selectionStart) + "\t" + value.slice(selectionEnd);
			update(index, { Code: nextCode });
			updateSelection(target, selectionStart + 1, selectionStart + 1);
			return;
		}

		const block = value.slice(lineStart, lineEnd);
		const lines = block.split("\n");
		let nextStart = selectionStart;
		let nextEnd = selectionEnd;
		let nextLines: string[];

		if (event.shiftKey) {
			let removedBeforeStart = 0;
			let removedTotal = 0;
			nextLines = lines.map((line, lineIndex) => {
				const removeCount = line.startsWith("\t")
					? 1
					: line.startsWith("  ")
						? 2
						: line.startsWith(" ")
							? 1
							: 0;
				if (lineIndex === 0) {
					removedBeforeStart = Math.min(removeCount, selectionStart - lineStart);
				}
				removedTotal += removeCount;
				return line.slice(removeCount);
			});
			nextStart = Math.max(lineStart, selectionStart - removedBeforeStart);
			nextEnd = Math.max(nextStart, selectionEnd - removedTotal);
		} else {
			nextLines = lines.map((line) => `\t${line}`);
			nextStart = selectionStart + 1;
			nextEnd = selectionEnd + lines.length;
		}

		const nextBlock = nextLines.join("\n");
		const nextCode = value.slice(0, lineStart) + nextBlock + value.slice(lineEnd);
		update(index, { Code: nextCode });
		updateSelection(target, nextStart, nextEnd);
	};

	return (
		<div className="space-y-3">
			<datalist id="script-action-keys">
				{actionKeys.map((k) => (
					<option key={k} value={k} />
				))}
			</datalist>

			{scripts.length === 0 && (
				<p className="text-sm opacity-70">
					No scripts. Add one to give this object a behavior that reacts to an action.
				</p>
			)}

			{scripts.map((script, i) => {
				const validation = validateScriptSource(script.Code);
				const enabled = script.Enabled !== false;
				return (
					<div key={i} className="rounded-lg border-2 border-base-300 p-3 space-y-2">
						<div className="flex flex-col gap-2 sm:flex-row sm:items-center">
							<input
								type="text"
								value={script.Name ?? ""}
								disabled={readOnly}
								onChange={(e) => update(i, { Name: e.target.value })}
								className="input input-bordered input-sm sm:w-40 sm:shrink-0"
								placeholder="Name (optional)"
							/>
							<input
								type="text"
								list="script-action-keys"
								value={script.Trigger}
								disabled={readOnly}
								onChange={(e) => update(i, { Trigger: e.target.value })}
								className="input input-bordered input-sm min-w-0 flex-1 font-mono"
								placeholder='Trigger, e.g. "item:use" or "*:move"'
							/>
							<select
								value={script.When ?? "after"}
								disabled={readOnly}
								onChange={(e) =>
									update(i, { When: e.target.value as "before" | "after" })
								}
								className="select select-bordered select-sm w-24 shrink-0"
								title="When to run: after the action (react) or before it (intercept/cancel)"
							>
								<option value="after">After</option>
								<option value="before">Before</option>
							</select>
							<label className="flex items-center gap-1 text-xs opacity-80">
								<input
									type="checkbox"
									checked={enabled}
									disabled={readOnly}
									onChange={(e) => update(i, { Enabled: e.target.checked })}
									className="toggle toggle-sm"
								/>
								On
							</label>
							{!readOnly && (
								<button
									type="button"
									onClick={() => remove(i)}
									className="btn btn-sm btn-ghost btn-square text-error"
									aria-label="Remove script"
									title="Remove script"
								>
									<span className="icon-[mdi--trash-can-outline] h-4 w-4" />
								</button>
							)}
						</div>

						<textarea
							value={script.Code}
							disabled={readOnly}
							onChange={(e) => update(i, { Code: e.target.value })}
							onKeyDown={(e) => handleCodeKeyDown(e, i)}
							className="textarea textarea-bordered min-h-72 w-full resize-y font-mono text-sm leading-relaxed"
							rows={14}
							spellCheck={false}
							placeholder="Write script code here."
						/>

						{!validation.ok && script.Code.trim() !== "" && (
							<p className="text-xs text-error">⚠ {validation.error}</p>
						)}
					</div>
				);
			})}

			{!readOnly && (
				<button type="button" onClick={add} className="btn btn-sm btn-outline">
					+ Add script
				</button>
			)}
		</div>
	);
}
