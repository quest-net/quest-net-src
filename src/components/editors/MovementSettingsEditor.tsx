// components/editors/MovementSettingsEditor.tsx
import { useState, useMemo } from "react";
import { useFormReadOnly } from "../Form/Form";
import { validateAndBuildHeightCostLookup } from "../../domains/CampaignSetting/CampaignSettingUtils";
import { MAX_HEIGHT } from "../../domains/VoxelTerrain/VoxelTerrain";

interface MovementSettingsEditorProps {
	formula: string;
	lookup: number[];
	onChange: (formula: string, lookup: number[]) => void;
	readOnly?: boolean;
}

const PRESET_FORMULAS = {
	"0": "No vertical cost (flat terrain)",
	"floor(h/2)": "Gentle slopes (2 height = 1 movement)",
	"ceil(h/2)": "Any climb costs (minimum 1 per change)",
	"h": "Linear (1:1 ratio)",
	"2*h": "Steep terrain (2:1 ratio)",
	"max(1, floor(h/2))": "Gentle with minimum (1-2 height = 1 movement, then scales)",
	"min(h, 5)": "Capped climb (max 5 movement per climb)",
	"min(2^h, 100)": "Exponential (capped at 100)",
	custom: "Custom formula...",
};

export function MovementSettingsEditor({
	formula,
	lookup,
	onChange,
	readOnly: readOnlyProp,
}: MovementSettingsEditorProps) {
	const contextReadOnly = useFormReadOnly();
	const readOnly = readOnlyProp ?? contextReadOnly;

	// Track if user is in custom mode
	const [isCustom, setIsCustom] = useState(() => {
		return !Object.keys(PRESET_FORMULAS).includes(formula);
	});

	// Track validation error
	const [validationError, setValidationError] = useState<string | null>(null);

	// Current selected preset (or "custom")
	// Check isCustom state FIRST before checking formula
	const currentPreset = useMemo(() => {
		if (isCustom) return "custom";
		if (Object.keys(PRESET_FORMULAS).includes(formula)) {
			return formula;
		}
		return "custom";
	}, [formula, isCustom]); // Added isCustom to dependencies

	const handlePresetChange = (preset: string) => {
		if (preset === "custom") {
			setIsCustom(true);
			setValidationError(null);
			return;
		}

		setIsCustom(false);
		setValidationError(null);

		// Validate and update
		const result = validateAndBuildHeightCostLookup(preset);
		if (result.valid) {
			onChange(preset, result.lookup!);
		} else {
			// This shouldn't happen for presets, but handle it
			setValidationError(result.error!);
		}
	};

	const handleCustomFormulaChange = (newFormula: string) => {
		const result = validateAndBuildHeightCostLookup(newFormula);

		if (result.valid) {
			setValidationError(null);
			onChange(newFormula, result.lookup!);
		} else {
			// Still update the formula so user can type, but show error
			setValidationError(result.error!);
			// Update with empty lookup to indicate invalid state
			onChange(newFormula, []);
		}
	};

	return (
		<div className="space-y-4">
			{/* Preset Selector */}
			<div>
				<label className="label">
					<span className="label-text font-semibold">Formula Preset</span>
				</label>
				<select
					value={currentPreset}
					onChange={(e) => handlePresetChange(e.target.value)}
					disabled={readOnly}
					className="select select-bordered w-full"
				>
					{Object.entries(PRESET_FORMULAS).map(([value, label]) => (
						<option key={value} value={value}>
							{label}
						</option>
					))}
				</select>
			</div>

			{/* Custom Formula Input */}
			{isCustom && (
				<div>
					<label className="label">
						<span className="label-text font-semibold">Custom Formula</span>
						<span className="label-text-alt">Use 'h' for height difference</span>
					</label>
					<input
						type="text"
						value={formula}
						onChange={(e) => handleCustomFormulaChange(e.target.value)}
						disabled={readOnly}
						className={`input input-bordered w-full ${
							validationError ? "input-error" : ""
						}`}
						placeholder="e.g., floor(h/2) or min(h, 5)"
					/>
					{validationError && (
						<div className="label">
							<span className="label-text-alt text-error">
								⚠️ {validationError}
							</span>
						</div>
					)}
					<div className="label">
						<span className="label-text-alt">
							💡 Available functions: floor, ceil, round, min, max, abs, sqrt, pow, ^
						</span>
					</div>
				</div>
			)}

			{/* Preview Table - only show if lookup is valid */}
			{!validationError && lookup.length > 0 && (
				<div className="bg-base-200 rounded-lg p-4">
					<div className="text-sm font-semibold mb-3">
						Cost Preview: <code className="text-primary">{formula}</code>
					</div>
					<div className="overflow-x-auto">
						<table className="table table-sm table-zebra">
							<thead>
								<tr>
									<th>Height Difference</th>
									{/* Start from h=1, show up to 9 values */}
									{Array.from({ length: Math.min(9, MAX_HEIGHT) }, (_, i) => i + 1).map(
										(h) => (
											<th key={h} className="text-center">
												{h}
											</th>
										)
									)}
									{MAX_HEIGHT > 9 && <th className="text-center">...</th>}
									{MAX_HEIGHT > 9 && (
										<th className="text-center">{MAX_HEIGHT}</th>
									)}
								</tr>
							</thead>
							<tbody>
								<tr>
									<td className="font-semibold">Movement Cost</td>
									{/* lookup[0] = cost for h=1, lookup[1] = cost for h=2, etc. */}
									{Array.from({ length: Math.min(9, MAX_HEIGHT) }, (_, i) => i + 1).map(
										(h) => (
											<td key={h} className="text-center font-mono font-bold">
												{lookup[h - 1]}
											</td>
										)
									)}
									{MAX_HEIGHT > 9 && <td className="text-center">...</td>}
									{MAX_HEIGHT > 9 && (
										<td className="text-center font-mono font-bold">
											{lookup[MAX_HEIGHT - 1]}
										</td>
									)}
								</tr>
							</tbody>
						</table>
					</div>
					<div className="text-xs opacity-70 mt-2">
						💡 Horizontal movement always costs 1. These are the additional movement points required to climb each height difference.
					</div>
				</div>
			)}
		</div>
	);
}