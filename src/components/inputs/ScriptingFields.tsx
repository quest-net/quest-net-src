// components/inputs/ScriptingFields.tsx
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

import { useFormContext, FormSection } from "../Form/Form";
import { useQuestContext } from "../../domains/Context/ContextProvider";
import type { Script, ScriptParam, ScriptValue } from "../../domains/Script/Script";
import { ScriptEditor } from "./ScriptEditor";
import { ParametersEditor, ParamValueInput, type StatRefOption } from "./ParametersEditor";

interface Scriptable {
	Scripts?: Script[];
	Parameters?: ScriptParam[];
}

interface ScriptingFieldsProps<T extends Scriptable> {
	data: T;
	onChange: (data: T) => void;
}

export function ScriptingFields<T extends Scriptable>({
	data,
	onChange,
}: ScriptingFieldsProps<T>) {
	const { readOnly } = useFormContext();
	const context = useQuestContext();

	const scripts = data.Scripts ?? [];
	const params = data.Parameters ?? [];

	const statRefOptions: StatRefOption[] = (
		context.ActiveCampaign?.Settings.StatDefinitions ?? []
	).map((s) => ({ value: s.Name, label: s.Name }));

	const setScripts = (next: Script[]) =>
		onChange({ ...data, Scripts: next.length ? next : undefined });
	const setParams = (next: ScriptParam[]) =>
		onChange({ ...data, Parameters: next.length ? next : undefined });

	const setParamDefault = (key: string, value: ScriptValue) =>
		setParams(params.map((p) => (p.Key === key ? { ...p, Default: value } : p)));

	return (
		<>
			{params.length > 0 && (
				<FormSection
					title="Behavior parameters"
					description="Tune this object's scripted behavior without editing code."
				>
					<div className="space-y-3">
						{params.map((param) => (
							<div key={param.Key} className="flex flex-wrap items-center gap-3">
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
					<summary className="cursor-pointer select-none text-sm font-medium opacity-80">
						Show scripting internals
						{scripts.length > 0 && (
							<span className="badge badge-sm badge-neutral ml-2">
								{scripts.length} script{scripts.length === 1 ? "" : "s"}
							</span>
						)}
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
			</FormSection>
		</>
	);
}
