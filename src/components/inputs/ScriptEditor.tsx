// components/inputs/ScriptEditor.tsx
//
// Raw editor for a scriptable object's behavior scripts (v2 ECA rules). Each
// script is { Trigger, Code, Name?, Enabled? }: it runs when a dispatched action
// matches the Trigger glob, with `game`, `event`, and `this` in scope. Lives
// behind an "Advanced" collapse on edit forms — scripts are usually machine
// written, and debugging happens in the Wiki test harness.

import { useMemo } from "react";
import type { Script } from "../../domains/Script/Script";
import { ACTION_REGISTRY, isScriptableAction } from "../../services/Actions/ActionRegistry";
import { validateScriptSource } from "../../services/Scripting/scriptValidation";

interface ScriptEditorProps {
	scripts: Script[];
	onChange: (scripts: Script[]) => void;
	readOnly?: boolean;
}

export function ScriptEditor({ scripts, onChange, readOnly }: ScriptEditorProps) {
	// Suggest the script-ok action keys as Trigger autocompletion (a script can
	// trigger on any action key, but only script-ok ones can be *called*).
	const scriptableKeys = useMemo(
		() => Object.keys(ACTION_REGISTRY).filter(isScriptableAction).sort(),
		[]
	);

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

	return (
		<div className="space-y-3">
			<datalist id="scriptable-action-keys">
				{scriptableKeys.map((k) => (
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
								className="input input-bordered input-sm sm:w-40"
								placeholder="Name (optional)"
							/>
							<input
								type="text"
								list="scriptable-action-keys"
								value={script.Trigger}
								disabled={readOnly}
								onChange={(e) => update(i, { Trigger: e.target.value })}
								className="input input-bordered input-sm flex-1 font-mono"
								placeholder='Trigger, e.g. "item:use" or "*:move"'
							/>
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
									className="btn btn-sm btn-ghost text-error"
									aria-label="Remove script"
								>
									Remove
								</button>
							)}
						</div>

						<p className="text-xs opacity-60">
							Runs when a dispatched action matches the Trigger glob. In scope:{" "}
							<code>game</code>, <code>event</code>, <code>this</code>. Change the world
							only via <code>await game.action(key, params)</code>.
						</p>

						<textarea
							value={script.Code}
							disabled={readOnly}
							onChange={(e) => update(i, { Code: e.target.value })}
							className="textarea textarea-bordered w-full font-mono text-sm"
							rows={6}
							spellCheck={false}
							placeholder={
								'// e.g. if (event.params.actorId !== this.actor.Id) return;\n' +
								'// await game.action("entity:move", { entityId: stalker.Id, position: this.actor.Position });'
							}
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
