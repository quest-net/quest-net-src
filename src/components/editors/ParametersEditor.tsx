// components/editors/ParametersEditor.tsx
//
// Declares DM-tunable, typed Parameters on a scriptable template. Scripts read
// these as `this.params.<Key>`. Because they
// are typed and constrained, they double as a safety boundary: a DM can adjust
// behavior without reading code, and cannot break a script by typing garbage.
//
// ParamValueInput renders the right control for a param's Type and is reused both
// here (editing the declared Default) and in the friendly tuning panel.

import type { ScriptParam, ScriptValue } from "../../domains/Script/Script";

export const SCRIPT_PARAM_TYPES: ScriptParam["Type"][] = [
	"number",
	"boolean",
	"text",
	"select",
	"statRef",
	"color",
];

export const SCRIPT_PARAM_KEY_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

export interface StatRefOption {
	value: string;
	label: string;
}

function getNextParamKey(parameters: ScriptParam[]): string {
	const used = new Set(parameters.map((p) => p.Key));
	let n = parameters.length + 1;
	while (used.has(`param${n}`)) n++;
	return `param${n}`;
}

function getParamKeyError(
	param: ScriptParam,
	keyCounts: Map<string, number>
): string | null {
	const rawKey = param.Key;
	const trimmedKey = rawKey.trim();
	if (!trimmedKey) return "Key is required.";
	if (rawKey !== trimmedKey) return "Remove leading or trailing spaces.";
	if (!SCRIPT_PARAM_KEY_PATTERN.test(rawKey)) {
		return "Use a JavaScript identifier, e.g. potency or saveDC.";
	}
	if ((keyCounts.get(trimmedKey) ?? 0) > 1) return "Key must be unique.";
	return null;
}

export function ParamValueInput({
	param,
	value,
	onChange,
	readOnly,
	statRefOptions,
}: {
	param: ScriptParam;
	value: ScriptValue;
	onChange: (value: ScriptValue) => void;
	readOnly?: boolean;
	statRefOptions?: StatRefOption[];
}) {
	switch (param.Type) {
		case "boolean":
			return (
				<input
					type="checkbox"
					checked={!!value}
					disabled={readOnly}
					onChange={(e) => onChange(e.target.checked)}
					className="toggle"
				/>
			);
		case "number":
			return (
				<input
					type="number"
					value={value === null || value === undefined ? "" : Number(value)}
					min={param.Min}
					max={param.Max}
					disabled={readOnly}
					onChange={(e) => {
						const n = Number(e.target.value);
						if (!Number.isFinite(n)) return;
						const clamped = Math.min(
							param.Max ?? Infinity,
							Math.max(param.Min ?? -Infinity, n)
						);
						onChange(clamped);
					}}
					className="input input-bordered input-sm w-full"
				/>
			);
		case "select":
			return (
				<select
					value={String(value ?? "")}
					disabled={readOnly}
					onChange={(e) => onChange(e.target.value)}
					className="select select-bordered select-sm w-full"
				>
					{(param.Options ?? []).map((o) => (
						<option key={o.value} value={o.value}>
							{o.label}
						</option>
					))}
				</select>
			);
		case "statRef":
			return (
				<select
					value={String(value ?? "")}
					disabled={readOnly}
					onChange={(e) => onChange(e.target.value)}
					className="select select-bordered select-sm w-full"
				>
					<option value="">— pick a stat —</option>
					{(statRefOptions ?? []).map((o) => (
						<option key={o.value} value={o.value}>
							{o.label}
						</option>
					))}
				</select>
			);
		case "color":
			return (
				<input
					type="color"
					value={String(value ?? "#ffffff")}
					disabled={readOnly}
					onChange={(e) => onChange(e.target.value)}
					className="h-9 w-16 rounded border-2 border-base-300"
				/>
			);
		case "text":
		default:
			return (
				<input
					type="text"
					value={String(value ?? "")}
					disabled={readOnly}
					onChange={(e) => onChange(e.target.value)}
					className="input input-bordered input-sm w-full"
				/>
			);
	}
}

interface ParametersEditorProps {
	parameters: ScriptParam[];
	onChange: (parameters: ScriptParam[]) => void;
	readOnly?: boolean;
	statRefOptions?: StatRefOption[];
}

export function ParametersEditor({
	parameters,
	onChange,
	readOnly,
	statRefOptions,
}: ParametersEditorProps) {
	const update = (index: number, patch: Partial<ScriptParam>) => {
		onChange(parameters.map((p, i) => (i === index ? { ...p, ...patch } : p)));
	};

	const changeType = (index: number, type: ScriptParam["Type"]) => {
		// Reset Default to a sensible value for the new type.
		const def: ScriptValue =
			type === "number" ? 0 : type === "boolean" ? false : type === "color" ? "#ffffff" : "";
		update(index, { Type: type, Default: def });
	};

	const add = () => {
		const key = getNextParamKey(parameters);
		onChange([
			...parameters,
			{ Key: key, Label: "New parameter", Type: "number", Default: 1 },
		]);
	};
	const remove = (index: number) => {
		onChange(parameters.filter((_, i) => i !== index));
	};

	const keyCounts = new Map<string, number>();
	for (const param of parameters) {
		const key = param.Key.trim();
		if (key) keyCounts.set(key, (keyCounts.get(key) ?? 0) + 1);
	}

	return (
		<div className="space-y-3">
			{parameters.length === 0 && (
				<p className="text-sm opacity-70">
					No parameters declared. Add one to expose a tunable knob (read in scripts as{" "}
					<code>this.params.&lt;Key&gt;</code>).
				</p>
			)}

			{parameters.map((param, i) => {
				const keyError = getParamKeyError(param, keyCounts);

				return (
					<div key={i} className="rounded-lg border-2 border-base-300 p-3 space-y-3">
						<div className="grid grid-cols-1 gap-2 md:grid-cols-[minmax(9rem,1fr)_minmax(12rem,2fr)_7rem_auto] md:items-end">
							<label className="text-xs">
								<span className="opacity-60">Key</span>
								<input
									type="text"
									value={param.Key}
									disabled={readOnly}
									onChange={(e) => update(i, { Key: e.target.value })}
									className={`input input-bordered input-sm w-full font-mono ${
										keyError ? "input-error" : ""
									}`}
								/>
								{keyError && (
									<span className="mt-1 block text-error">{keyError}</span>
								)}
							</label>
							<label className="text-xs">
								<span className="opacity-60">Label</span>
								<input
									type="text"
									value={param.Label}
									disabled={readOnly}
									onChange={(e) => update(i, { Label: e.target.value })}
									className="input input-bordered input-sm w-full"
								/>
							</label>
							<label className="text-xs">
								<span className="opacity-60">Type</span>
								<select
									value={param.Type}
									disabled={readOnly}
									onChange={(e) => changeType(i, e.target.value as ScriptParam["Type"])}
									className="select select-bordered select-sm w-full"
								>
									{SCRIPT_PARAM_TYPES.map((t) => (
										<option key={t} value={t}>
											{t}
										</option>
									))}
								</select>
							</label>
							{!readOnly && (
								<button
									type="button"
									onClick={() => remove(i)}
									className="btn btn-sm btn-ghost btn-square text-error md:self-end"
									aria-label="Remove parameter"
									title="Remove parameter"
								>
									<span className="icon-[mdi--trash-can-outline] h-4 w-4" />
								</button>
							)}
						</div>

						<div className="flex flex-wrap items-end gap-2">
							<label className="min-w-48 flex-1 text-xs">
								<span className="opacity-60">Default</span>
								<div>
									<ParamValueInput
										param={param}
										value={param.Default}
										onChange={(v) => update(i, { Default: v })}
										readOnly={readOnly}
										statRefOptions={statRefOptions}
									/>
								</div>
							</label>

							{param.Type === "number" && (
								<>
									<label className="text-xs">
										<span className="mb-1 block opacity-60">Min</span>
										<input
											type="number"
											value={param.Min ?? ""}
											disabled={readOnly}
											onChange={(e) =>
												update(i, { Min: e.target.value === "" ? undefined : Number(e.target.value) })
											}
											className="input input-bordered input-sm w-20"
										/>
									</label>
									<label className="text-xs">
										<span className="mb-1 block opacity-60">Max</span>
										<input
											type="number"
											value={param.Max ?? ""}
											disabled={readOnly}
											onChange={(e) =>
												update(i, { Max: e.target.value === "" ? undefined : Number(e.target.value) })
											}
											className="input input-bordered input-sm w-20"
										/>
									</label>
								</>
							)}
						</div>
					</div>
				);
			})}

			{!readOnly && (
				<button type="button" onClick={add} className="btn btn-sm btn-outline">
					+ Add parameter
				</button>
			)}
		</div>
	);
}
