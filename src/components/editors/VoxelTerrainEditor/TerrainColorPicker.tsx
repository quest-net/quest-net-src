// Reusable terrain palette + special-material picker.
//
// Renders the 240-color palette grid and the categorized special-material
// swatches. Used by the edit-mode sidebar (EditorSidebar) and by the
// preview-mode Surroundings section (PreviewSettingsPanel). Renders as a
// fragment of sibling sections so the parent's vertical spacing applies.

import {
	TERRAIN_PALETTE,
	TERRAIN_PALETTE_ROWS,
} from "../../../utils/terrain/palette/TerrainPaletteUtils";
import { groupSpecialMaterialSwatches } from "../../Map/Terrain/materials";

// Derived once from the static material registry; grouping never changes at runtime.
const MATERIAL_SWATCH_GROUPS = groupSpecialMaterialSwatches();

interface TerrainColorPickerProps {
	/** Selected palette index (0-255). */
	value: number;
	onChange: (index: number) => void;
	disabled?: boolean;
	/**
	 * Palette indices to omit from the special-material swatches (e.g. the
	 * volumetric fog material, which cannot render as a surroundings plane).
	 */
	excludeIndices?: readonly number[];
	/**
	 * Renders "Color"/"Materials" as small sub-headings instead of section
	 * headings, for embedding the picker inside a titled section (e.g. the
	 * preview sidebar's Surroundings card).
	 */
	compact?: boolean;
}

export function TerrainColorPicker({
	value,
	onChange,
	disabled,
	excludeIndices,
	compact,
}: TerrainColorPickerProps) {
	const headingClass = compact
		? "text-xs font-semibold mb-1"
		: "text-sm font-semibold mb-2";
	return (
		<>
			<div>
				<div className={headingClass}>Color</div>
				<div
					className="grid"
					style={{ gridTemplateColumns: `repeat(${TERRAIN_PALETTE_ROWS}, 1fr)` }}
				>
					{TERRAIN_PALETTE.map((color, idx) => (
						<button
							key={idx}
							type="button"
							className={`aspect-square${value === idx ? " ring-2 ring-base-content ring-inset" : ""}`}
							style={{ backgroundColor: color }}
							onClick={() => onChange(idx)}
							title={`Color ${idx}`}
							aria-label={`Color ${idx}`}
							disabled={disabled}
						/>
					))}
				</div>
			</div>

			<div>
				<div className={headingClass}>Materials</div>
				<div className="flex flex-col gap-2">
					{MATERIAL_SWATCH_GROUPS.map((group) => {
						const swatches = excludeIndices
							? group.swatches.filter((s) => !excludeIndices.includes(s.index))
							: group.swatches;
						if (swatches.length === 0) return null;
						return (
							<div key={group.category}>
								<div className="text-xs opacity-70 mb-1">{group.label}</div>
								<div className="flex flex-row flex-wrap gap-1">
									{swatches.map((swatch) => (
										<button
											key={swatch.index}
											type="button"
											className={`w-6 h-6${value === swatch.index ? " ring-2 ring-base-content ring-inset" : ""}`}
											style={{ backgroundColor: swatch.color }}
											onClick={() => onChange(swatch.index)}
											title={swatch.label}
											aria-label={swatch.label}
											disabled={disabled}
										/>
									))}
								</div>
							</div>
						);
					})}
				</div>
			</div>
		</>
	);
}
