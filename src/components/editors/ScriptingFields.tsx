// components/editors/ScriptingFields.tsx
//
// Drop-in scripting fields for a scriptable edit form (Item, Skill, Status,
// Entity, Character, Campaign). Renders:
//   1. A friendly "Behavior parameters" panel (visible when params are declared)
//      where a non-technical DM tunes declared knobs by editing their Default.
//   2. An "Advanced" collapse (collapsed by default) with the parameter
//      declarations editor and the raw script editor.
//
// There are no per-instance parameter overrides — a param resolves to its
// declared Default — so editing the Default here IS the tuning surface.

import { useEffect, useState, type MouseEvent } from "react";
import { useFormContext, FormSection } from "../Form/Form";
import { useQuestContext } from "../../domains/Context/ContextProvider";
import type {
	Script,
	ScriptParam,
	ScriptValue,
	ScriptVars,
} from "../../domains/Script/Script";
import { validateScriptSource } from "../../services/Scripting/scriptValidation";
import { ScriptEditor } from "./ScriptEditor";
import {
	ParametersEditor,
	ParamValueInput,
	SCRIPT_PARAM_KEY_PATTERN,
	SCRIPT_PARAM_TYPES,
	type StatRefOption,
} from "./ParametersEditor";

interface Scriptable {
	Scripts?: Script[];
	Parameters?: ScriptParam[];
	ScriptVars?: ScriptVars;
}

interface ScriptingFieldsProps<T extends Scriptable> {
	data: T;
	onChange: (data: T) => void;
}

type ImportStatus = { tone: "success" | "error"; message: string };
type ScriptEnvelopeHostType = "campaign" | "actor" | "item" | "status" | "skill";

interface ParsedScriptEnvelope {
	host: {
		type: ScriptEnvelopeHostType;
		name?: string;
	};
	description?: string;
	parameters: ScriptParam[];
	scripts: Script[];
	vars?: ScriptVars;
}

const SCRIPT_ENVELOPE_HOST_TYPES: ScriptEnvelopeHostType[] = [
	"campaign",
	"actor",
	"item",
	"status",
	"skill",
];

function getScriptLabel(script: Script, index: number): string {
	return script.Name?.trim() || script.Trigger?.trim() || `Script ${index + 1}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isScriptValue(value: unknown): value is ScriptValue {
	return (
		value === null ||
		typeof value === "string" ||
		typeof value === "number" ||
		typeof value === "boolean"
	);
}

function extractClipboardJson(text: string): string {
	const trimmed = text.trim();
	const jsonFence = trimmed.match(/```json\s*([\s\S]*?)```/i);
	if (jsonFence) return jsonFence[1].trim();
	const anyFence = trimmed.match(/```\s*([\s\S]*?)```/);
	return anyFence ? anyFence[1].trim() : trimmed;
}

function parseScriptEnvelopeHost(value: unknown): ParsedScriptEnvelope["host"] {
	if (!isRecord(value)) {
		throw new Error("Clipboard JSON is missing host.");
	}
	const type = value.type;
	if (
		typeof type !== "string" ||
		!SCRIPT_ENVELOPE_HOST_TYPES.includes(type as ScriptEnvelopeHostType)
	) {
		throw new Error("Clipboard host.type is not a supported script host.");
	}
	const name = value.name;
	if (type !== "campaign" && typeof name !== "string") {
		throw new Error("Clipboard host.name is required for this host type.");
	}
	if (name !== undefined && typeof name !== "string") {
		throw new Error("Clipboard host.name must be a string.");
	}
	return { type: type as ScriptEnvelopeHostType, name };
}

function parseImportedParameter(value: unknown, index: number): ScriptParam {
	if (!isRecord(value)) {
		throw new Error(`Parameter ${index + 1} must be an object.`);
	}
	const key = value.Key;
	const label = value.Label;
	const type = value.Type;
	const defaultValue = value.Default;
	const min = value.Min;
	const max = value.Max;
	const rawOptions = value.Options;
	if (typeof key !== "string" || !SCRIPT_PARAM_KEY_PATTERN.test(key)) {
		throw new Error(`Parameter ${index + 1} has an invalid Key.`);
	}
	if (
		typeof type !== "string" ||
		!SCRIPT_PARAM_TYPES.includes(type as ScriptParam["Type"])
	) {
		throw new Error(`Parameter "${key}" has an invalid Type.`);
	}
	if (!("Default" in value) || !isScriptValue(defaultValue)) {
		throw new Error(`Parameter "${key}" has an invalid Default.`);
	}
	if (min !== undefined && typeof min !== "number") {
		throw new Error(`Parameter "${key}" has an invalid Min.`);
	}
	if (max !== undefined && typeof max !== "number") {
		throw new Error(`Parameter "${key}" has an invalid Max.`);
	}

	let options: ScriptParam["Options"];
	if (rawOptions !== undefined) {
		if (!Array.isArray(rawOptions)) {
			throw new Error(`Parameter "${key}" has invalid Options.`);
		}
		options = rawOptions.map((option, optionIndex) => {
			if (
				!isRecord(option) ||
				typeof option.value !== "string" ||
				typeof option.label !== "string"
			) {
				throw new Error(
					`Parameter "${key}" option ${optionIndex + 1} must have string value and label.`
				);
			}
			return { value: option.value, label: option.label };
		});
	}

	return {
		Key: key,
		Label: typeof label === "string" ? label : key,
		Type: type as ScriptParam["Type"],
		Default: defaultValue,
		Min: typeof min === "number" ? min : undefined,
		Max: typeof max === "number" ? max : undefined,
		Options: options,
	};
}

function parseImportedScript(value: unknown, index: number): Script {
	if (!isRecord(value)) {
		throw new Error(`Script ${index + 1} must be an object.`);
	}
	const trigger = value.Trigger;
	const code = value.Code;
	if (typeof trigger !== "string" || trigger.trim() === "") {
		throw new Error(`Script ${index + 1} has an invalid Trigger.`);
	}
	if (typeof code !== "string") {
		throw new Error(`Script ${index + 1} has invalid Code.`);
	}
	if (value.Name !== undefined && typeof value.Name !== "string") {
		throw new Error(`Script ${index + 1} has an invalid Name.`);
	}
	if (
		value.When !== undefined &&
		value.When !== "before" &&
		value.When !== "after"
	) {
		throw new Error(`Script ${index + 1} has an invalid When value.`);
	}
	if (value.Enabled !== undefined && typeof value.Enabled !== "boolean") {
		throw new Error(`Script ${index + 1} has an invalid Enabled value.`);
	}

	const validation = validateScriptSource(code);
	if (!validation.ok) {
		throw new Error(`Script ${index + 1} failed validation. ${validation.error}`);
	}

	return {
		Name: typeof value.Name === "string" ? value.Name : undefined,
		Trigger: trigger,
		When: value.When === "before" || value.When === "after" ? value.When : undefined,
		Enabled: typeof value.Enabled === "boolean" ? value.Enabled : true,
		Code: code,
	};
}

function parseImportedVars(value: unknown): ScriptVars | undefined {
	if (value === undefined) return undefined;
	if (!isRecord(value)) {
		throw new Error("Clipboard vars must be an object.");
	}
	const vars: ScriptVars = {};
	for (const [key, varValue] of Object.entries(value)) {
		if (!isScriptValue(varValue)) {
			throw new Error(`Clipboard vars.${key} must be a primitive value.`);
		}
		vars[key] = varValue;
	}
	return vars;
}

function parseClipboardScriptEnvelope(text: string): ParsedScriptEnvelope {
	let parsed: unknown;
	try {
		parsed = JSON.parse(extractClipboardJson(text));
	} catch {
		throw new Error("Clipboard does not contain valid JSON or a json code block.");
	}
	if (!isRecord(parsed) || parsed.questNetScript !== 1) {
		throw new Error("Clipboard must contain a questNetScript v1 JSON envelope.");
	}
	const rawScripts = parsed.scripts;
	if (!Array.isArray(rawScripts) || rawScripts.length === 0) {
		throw new Error("Clipboard envelope must contain at least one script.");
	}
	const parameters = Array.isArray(parsed.parameters)
		? parsed.parameters.map(parseImportedParameter)
		: [];
	const seenParamKeys = new Set<string>();
	for (const param of parameters) {
		if (seenParamKeys.has(param.Key)) {
			throw new Error(`Clipboard parameter key "${param.Key}" is duplicated.`);
		}
		seenParamKeys.add(param.Key);
	}
	return {
		host: parseScriptEnvelopeHost(parsed.host),
		description:
			typeof parsed.description === "string" ? parsed.description : undefined,
		parameters,
		scripts: rawScripts.map(parseImportedScript),
		vars: parseImportedVars(parsed.vars),
	};
}

function mergeParameters(
	existing: ScriptParam[],
	imported: ScriptParam[]
): ScriptParam[] {
	if (imported.length === 0) return existing;
	const importedByKey = new Map(imported.map((param) => [param.Key, param]));
	const merged = existing.map((param) => importedByKey.get(param.Key) ?? param);
	const existingKeys = new Set(existing.map((param) => param.Key));
	for (const param of imported) {
		if (!existingKeys.has(param.Key)) merged.push(param);
	}
	return merged;
}

function supportsScriptVars(data: Scriptable): boolean {
	return data.ScriptVars !== undefined || "GameState" in data || "Stats" in data;
}

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
	return `${count} ${count === 1 ? singular : plural}`;
}

function validateScriptingSetup(
	scripts: Script[],
	params: ScriptParam[]
): string | null {
	const keyCounts = new Map<string, number>();
	for (const param of params) {
		const key = param.Key.trim();
		if (key) keyCounts.set(key, (keyCounts.get(key) ?? 0) + 1);
	}

	for (const [index, param] of params.entries()) {
		const rawKey = param.Key;
		const key = rawKey.trim();
		const label = param.Label?.trim() || `Parameter ${index + 1}`;
		if (!key) return `Fix scripting before saving: ${label} needs a parameter key.`;
		if (rawKey !== key) {
			return `Fix scripting before saving: parameter "${key}" has leading or trailing spaces.`;
		}
		if (!SCRIPT_PARAM_KEY_PATTERN.test(rawKey)) {
			return `Fix scripting before saving: parameter "${key}" must be a JavaScript identifier.`;
		}
		if ((keyCounts.get(key) ?? 0) > 1) {
			return `Fix scripting before saving: parameter key "${key}" is duplicated.`;
		}
	}

	for (const [index, script] of scripts.entries()) {
		const validation = validateScriptSource(script.Code);
		if (!validation.ok) {
			return `Fix scripting before saving: ${getScriptLabel(script, index)} has invalid code. ${validation.error}`;
		}
	}

	return null;
}

export function ScriptingFields<T extends Scriptable>({
	data,
	onChange,
}: ScriptingFieldsProps<T>) {
	const { readOnly, registerSaveBlocker } = useFormContext();
	const context = useQuestContext();

	const scripts = data.Scripts ?? [];
	const params = data.Parameters ?? [];
	const [importStatus, setImportStatus] = useState<ImportStatus | null>(null);
	const [isImporting, setIsImporting] = useState(false);

	const statRefOptions: StatRefOption[] = (
		context.ActiveCampaign?.Settings.StatDefinitions ?? []
	).map((s) => ({ value: s.Name, label: s.Name }));

	const setScripts = (next: Script[]) =>
		onChange({ ...data, Scripts: next.length ? next : undefined });
	const setParams = (next: ScriptParam[]) =>
		onChange({ ...data, Parameters: next.length ? next : undefined });

	const setParamDefault = (key: string, value: ScriptValue) =>
		setParams(params.map((p) => (p.Key === key ? { ...p, Default: value } : p)));

	const importFromClipboard = async () => {
		setIsImporting(true);
		setImportStatus(null);
		try {
			if (!navigator.clipboard?.readText) {
				throw new Error("Clipboard text access is not available in this browser.");
			}
			const text = await navigator.clipboard.readText();
			const envelope = parseClipboardScriptEnvelope(text);
			const nextScripts = [...scripts, ...envelope.scripts];
			const nextParams = mergeParameters(params, envelope.parameters);
			const nextData: T = {
				...data,
				Scripts: nextScripts.length ? nextScripts : undefined,
				Parameters: nextParams.length ? nextParams : undefined,
			};

			const importedVars = envelope.vars ? Object.keys(envelope.vars).length : 0;
			const varsImported = importedVars > 0 && supportsScriptVars(data);
			if (varsImported) {
				nextData.ScriptVars = {
					...(data.ScriptVars ?? {}),
					...envelope.vars,
				};
			}

			onChange(nextData);

			const parts = [
				`Imported ${pluralize(envelope.scripts.length, "script")}`,
			];
			if (envelope.parameters.length > 0) {
				parts.push(pluralize(envelope.parameters.length, "parameter"));
			}
			if (varsImported) {
				parts.push(pluralize(importedVars, "var"));
			} else if (importedVars > 0) {
				parts.push(`${pluralize(importedVars, "var")} ignored for this host`);
			}
			const hostName = envelope.host.name ? ` "${envelope.host.name}"` : "";
			setImportStatus({
				tone: "success",
				message: `${parts.join(", ")} from ${envelope.host.type}${hostName}.`,
			});
		} catch (error) {
			setImportStatus({
				tone: "error",
				message: String((error as Error)?.message ?? error),
			});
		} finally {
			setIsImporting(false);
		}
	};

	const handleImportButtonClick = (event: MouseEvent<HTMLButtonElement>) => {
		event.preventDefault();
		event.stopPropagation();
		void importFromClipboard();
	};

	useEffect(() => {
		if (readOnly) return;
		return registerSaveBlocker(() => validateScriptingSetup(scripts, params));
	}, [params, readOnly, registerSaveBlocker, scripts]);

	return (
		<>
			{params.length > 0 && (
				<FormSection
					title="Behavior parameters"
					description="Tune this object's scripted behavior without editing code."
				>
					<div className="space-y-3">
						{params.map((param, index) => (
							<div key={`${param.Key}-${index}`} className="flex flex-wrap items-center gap-3">
								<div className="min-w-40">
									<div className="text-sm font-medium">{param.Label || param.Key}</div>
								</div>
								<div className="flex-1 min-w-40">
									<ParamValueInput
										param={param}
										value={param.Default}
										onChange={(v) => setParamDefault(param.Key, v)}
										readOnly={readOnly}
										statRefOptions={statRefOptions}
									/>
								</div>
							</div>
						))}
					</div>
				</FormSection>
			)}

			<FormSection
				title="Advanced: scripting"
				description="Behavior scripts and parameter declarations. Usually machine-authored."
			>
				<details className="group">
					<summary className="cursor-pointer list-none select-none text-sm font-medium [&::-webkit-details-marker]:hidden">
						<div className="flex flex-wrap items-center justify-between gap-2">
							<span className="inline-flex items-center gap-1.5 opacity-80">
								<span className="icon-[mdi--chevron-right] h-4 w-4 transition-transform group-open:rotate-90" />
								<span>
									Show scripting internals
									{scripts.length > 0 && (
										<span className="badge badge-sm badge-neutral ml-2">
											{scripts.length} script{scripts.length === 1 ? "" : "s"}
										</span>
									)}
								</span>
							</span>
							{!readOnly && (
								<button
									type="button"
									onClick={handleImportButtonClick}
									disabled={isImporting}
									className="btn btn-xs btn-outline gap-1"
									title="Import a questNetScript envelope from the clipboard"
									aria-label="Import script from clipboard"
								>
									<span className="icon-[mdi--clipboard-text-outline] h-4 w-4" />
									{isImporting ? "Importing" : "Import from clipboard"}
								</button>
							)}
						</div>
					</summary>

					<div className="mt-4 space-y-6">
						<a
							href="/#/wiki/scripting/"
							target="_blank"
							rel="noopener noreferrer"
							className="link link-primary inline-flex items-center gap-1 text-xs"
						>
							<span className="icon-[mdi--book-open-variant] h-4 w-4" />
							Scripting API reference & test harness
						</a>

						<div>
							<h4 className="mb-2 text-sm font-semibold opacity-80">Parameters</h4>
							<ParametersEditor
								parameters={params}
								onChange={setParams}
								readOnly={readOnly}
								statRefOptions={statRefOptions}
							/>
						</div>

						<div>
							<h4 className="mb-2 text-sm font-semibold opacity-80">Scripts</h4>
							<ScriptEditor scripts={scripts} onChange={setScripts} readOnly={readOnly} />
						</div>
					</div>
				</details>
				{importStatus && (
					<div
						className={`alert mt-3 py-2 text-sm ${
							importStatus.tone === "success" ? "alert-success" : "alert-error"
						}`}
					>
						<span
							className={`h-5 w-5 shrink-0 ${
								importStatus.tone === "success"
									? "icon-[mdi--check-circle-outline]"
									: "icon-[mdi--alert-circle-outline]"
							}`}
						/>
						<span>{importStatus.message}</span>
					</div>
				)}
			</FormSection>
		</>
	);
}
