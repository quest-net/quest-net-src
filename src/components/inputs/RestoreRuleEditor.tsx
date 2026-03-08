// components/inputs/RestoreRuleEditor.tsx
import { RestoreRule, RestoreRuleValue } from "../../domains/CampaignSetting/CampaignSetting";
import { useFormReadOnly } from "../Form/Form";

interface RestoreRuleEditorProps {
	value?: RestoreRule;
	onChange: (value: RestoreRule | undefined) => void;
	readOnly?: boolean;
}

type RestType = "shortRest" | "longRest" | "combatEnd";
type Mode = "max" | "restoreBy" | "setTo";

const REST_LABELS: Record<RestType, string> = {
	shortRest: "Short Rest",
	longRest: "Long Rest",
	combatEnd: "Combat End",
};

function getMode(val: RestoreRuleValue | undefined): Mode {
	if (val === "max") return "max";
	if (typeof val === "object" && val !== null && "setTo" in val) return "setTo";
	return "restoreBy";
}

function getNumberValue(val: RestoreRuleValue | undefined): number {
	if (typeof val === "number") return val;
	if (typeof val === "object" && val !== null && "setTo" in val) return val.setTo;
	return 1;
}

export function RestoreRuleEditor({
	value,
	onChange,
	readOnly: readOnlyProp,
}: RestoreRuleEditorProps) {
	const contextReadOnly = useFormReadOnly();
	const readOnly = readOnlyProp ?? contextReadOnly;

	const handleToggleRestType = (restType: RestType, enabled: boolean) => {
		if (enabled) {
			// Enable this rest type with default "max"
			onChange({
				...value,
				[restType]: "max",
			});
		} else {
			// Disable this rest type
			const { [restType]: _, ...remaining } = value || {};
			// If no rules remain, set to undefined
			onChange(Object.keys(remaining).length === 0 ? undefined : remaining);
		}
	};

	const handleChangeValue = (
		restType: RestType,
		newValue: RestoreRuleValue
	) => {
		onChange({
			...value,
			[restType]: newValue,
		});
	};

	const handleChangeMode = (restType: RestType, mode: Mode) => {
		const currentValue = value?.[restType];
		if (currentValue === undefined) return;

		if (mode === "max") {
			handleChangeValue(restType, "max");
		} else if (mode === "restoreBy") {
			// Switch to restoreBy mode with default value of 1
			handleChangeValue(restType, 1);
		} else {
			// Switch to setTo mode with default value of 0
			handleChangeValue(restType, { setTo: 0 });
		}
	};

	const isEnabled = (restType: RestType) => value?.[restType] !== undefined;

	return (
		<div className="space-y-3">
			{(["shortRest", "longRest", "combatEnd"] as RestType[]).map(
				(restType) => {
					const enabled = isEnabled(restType);
					const val = value?.[restType];
					const mode = getMode(val);
					const numValue = getNumberValue(val);

					return (
						<div
							key={restType}
							className="flex items-center gap-3 p-3 rounded-lg border"
						>
							{/* Enable/Disable Checkbox */}
							<input
								type="checkbox"
								checked={enabled}
								onChange={(e) =>
									handleToggleRestType(restType, e.target.checked)
								}
								disabled={readOnly}
								className="checkbox checkbox-primary"
								aria-label={`Enable ${REST_LABELS[restType]}`}
							/>

							{/* Label */}
							<span className="font-medium min-w-28">
								{REST_LABELS[restType]}
							</span>

							{/* Controls (only show when enabled) */}
							{enabled && (
								<>
									{/* Mode Toggle */}
									<select
										value={mode}
										onChange={(e) =>
											handleChangeMode(
												restType,
												e.target.value as Mode
											)
										}
										disabled={readOnly}
										className="select select-bordered select-sm w-32"
									>
										<option value="max">Restore Max</option>
										<option value="restoreBy">Restore By</option>
										<option value="setTo">Set To</option>
									</select>

									{/* Number Input (show in restoreBy and setTo modes) */}
									{(mode === "restoreBy" || mode === "setTo") && (
										<input
											type="number"
											value={numValue}
											onChange={(e) => {
												const val = parseInt(e.target.value, 10);
												if (!isNaN(val) && val >= 0) {
													if (mode === "setTo") {
														handleChangeValue(restType, { setTo: val });
													} else {
														handleChangeValue(restType, val);
													}
												}
											}}
											disabled={readOnly}
											min={0}
											className="input input-bordered input-sm w-20"
											aria-label={`${REST_LABELS[restType]} ${mode === "setTo" ? "set to value" : "restore amount"}`}
										/>
									)}
								</>
							)}
						</div>
					);
				}
			)}
		</div>
	);
}
