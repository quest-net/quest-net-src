// components/inputs/RestoreRuleEditor.tsx
import { RestoreRule } from "../../domains/CampaignSetting/CampaignSetting";
import { useFormReadOnly } from "../Form/Form";

interface RestoreRuleEditorProps {
	value?: RestoreRule;
	onChange: (value: RestoreRule | undefined) => void;
	readOnly?: boolean;
}

type RestType = "shortRest" | "longRest" | "combatEnd";

const REST_LABELS: Record<RestType, string> = {
	shortRest: "Short Rest",
	longRest: "Long Rest",
	combatEnd: "Combat End",
};

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
		newValue: number | "max"
	) => {
		onChange({
			...value,
			[restType]: newValue,
		});
	};

	const handleChangeMode = (restType: RestType, mode: "number" | "max") => {
		const currentValue = value?.[restType];
		if (currentValue === undefined) return;

		if (mode === "max") {
			handleChangeValue(restType, "max");
		} else {
			// Switch to number mode with default value of 1
			handleChangeValue(restType, 1);
		}
	};

	const isEnabled = (restType: RestType) => value?.[restType] !== undefined;
	const getMode = (restType: RestType): "number" | "max" => {
		const val = value?.[restType];
		return val === "max" ? "max" : "number";
	};
	const getNumberValue = (restType: RestType): number => {
		const val = value?.[restType];
		return typeof val === "number" ? val : 1;
	};

	return (
		<div className="space-y-3">
			{(["shortRest", "longRest", "combatEnd"] as RestType[]).map(
				(restType) => {
					const enabled = isEnabled(restType);
					const mode = getMode(restType);
					const numValue = getNumberValue(restType);

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
												e.target.value as "number" | "max"
											)
										}
										disabled={readOnly}
										className="select select-bordered select-sm w-32"
									>
										<option value="max">Restore Max</option>
										<option value="number">Restore By</option>
									</select>

									{/* Number Input (only show in number mode) */}
									{mode === "number" && (
										<input
											type="number"
											value={numValue}
											onChange={(e) => {
												const val = parseInt(e.target.value, 10);
												if (!isNaN(val) && val >= 0) {
													handleChangeValue(restType, val);
												}
											}}
											disabled={readOnly}
											min={0}
											className="input input-bordered input-sm w-20"
											aria-label={`${REST_LABELS[restType]} restore amount`}
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