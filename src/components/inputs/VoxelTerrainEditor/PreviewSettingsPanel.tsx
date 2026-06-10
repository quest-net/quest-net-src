// Sidebar shown in Preview mode. Edits the terrain's Lighting, Surroundings,
// and Background. Sections are separated by hairline dividers (cards eat too
// much width in this narrow sidebar); control labels are text-xs/opacity-70
// so the section headings read unambiguously as headers.

import {
	DEFAULT_VOXEL_TERRAIN_BACKGROUND_COLOR,
	DEFAULT_VOXEL_TERRAIN_SURROUNDINGS,
	type VoxelTerrainBackground,
	type VoxelTerrainLighting,
	type VoxelTerrainSurroundings,
} from "../../../domains/VoxelTerrain/VoxelTerrain";
import {
	isVolumetricMaterial,
	SPECIAL_MATERIAL_SWATCHES,
} from "../../Map/Terrain/materials";
import { TerrainColorPicker } from "./TerrainColorPicker";

// Volumetric materials (fog) have no surface shader, so they cannot render as
// a surroundings plane; hide them from the picker here.
const SURROUNDINGS_EXCLUDED_INDICES: readonly number[] =
	SPECIAL_MATERIAL_SWATCHES
		.filter((swatch) => isVolumetricMaterial(swatch.index))
		.map((swatch) => swatch.index);

const LIGHTING_INTENSITY_MIN = 0;
const LIGHTING_INTENSITY_MAX = 3;
const LIGHTING_INTENSITY_STEP = 0.05;
const LIGHTING_ROTATION_MIN = 0;
const LIGHTING_ROTATION_MAX = 360;
const LIGHTING_ELEVATION_MIN = 0;
const LIGHTING_ELEVATION_MAX = 90;

function clampNumber(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

function numberInputValue(value: string, fallback: number): number {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : fallback;
}

/** A range control with a muted label and a tabular value readout. */
function SliderRow({
	label,
	valueText,
	min,
	max,
	step,
	value,
	disabled,
	onChange,
}: {
	label: string;
	valueText: string;
	min: number;
	max: number;
	step: number;
	value: number;
	disabled: boolean;
	onChange: (value: number) => void;
}) {
	return (
		<label className="block">
			<div className="mb-1 flex items-center justify-between gap-3">
				<span className="text-xs opacity-70">{label}</span>
				<span className="text-xs tabular-nums font-medium">{valueText}</span>
			</div>
			<input
				type="range"
				className="range range-sm"
				min={min}
				max={max}
				step={step}
				value={value}
				onChange={(e) =>
					onChange(clampNumber(numberInputValue(e.target.value, value), min, max))
				}
				disabled={disabled}
			/>
		</label>
	);
}

/** A single-line toggle control with a muted label. */
function ToggleRow({
	label,
	checked,
	disabled,
	onChange,
}: {
	label: string;
	checked: boolean;
	disabled: boolean;
	onChange: (checked: boolean) => void;
}) {
	return (
		<label className="flex cursor-pointer items-center justify-between gap-3">
			<span className="text-xs opacity-70">{label}</span>
			<input
				type="checkbox"
				className="toggle toggle-sm toggle-primary"
				checked={checked}
				onChange={(e) => onChange(e.target.checked)}
				disabled={disabled}
			/>
		</label>
	);
}

interface PreviewSettingsPanelProps {
	lighting: VoxelTerrainLighting;
	background: VoxelTerrainBackground;
	surroundings: VoxelTerrainSurroundings | undefined;
	/** Terrain Height in tactical units -- the surroundings height slider's max. */
	maxSurroundingsHeight: number;
	readOnly: boolean;
	onLightingChange: (updates: Partial<VoxelTerrainLighting>) => void;
	onBackgroundChange: (updates: VoxelTerrainBackground) => void;
	onSurroundingsChange: (next: VoxelTerrainSurroundings | undefined) => void;
}

export function PreviewSettingsPanel({
	lighting,
	background,
	surroundings,
	maxSurroundingsHeight,
	readOnly,
	onLightingChange,
	onBackgroundChange,
	onSurroundingsChange,
}: PreviewSettingsPanelProps) {
	const backgroundColor = background.Color ?? DEFAULT_VOXEL_TERRAIN_BACKGROUND_COLOR;

	return (
		<div className="divide-y divide-base-300">
			<section className="py-4 first:pt-0 last:pb-0 space-y-3">
				<div className="text-sm font-semibold">Lighting</div>
				<label className="flex cursor-pointer items-center justify-between gap-3">
					<span className="text-xs opacity-70">Color</span>
					<input
						type="color"
						className="h-9 w-12 cursor-pointer rounded border border-base-300 bg-base-100 p-1"
						value={lighting.Color}
						onChange={(e) => onLightingChange({ Color: e.target.value })}
						disabled={readOnly}
					/>
				</label>
				<SliderRow
					label="Intensity"
					valueText={lighting.Intensity.toFixed(2)}
					min={LIGHTING_INTENSITY_MIN}
					max={LIGHTING_INTENSITY_MAX}
					step={LIGHTING_INTENSITY_STEP}
					value={lighting.Intensity}
					disabled={readOnly}
					onChange={(value) => onLightingChange({ Intensity: value })}
				/>
				<SliderRow
					label="Rotation"
					valueText={`${Math.round(lighting.Rotation)} deg`}
					min={LIGHTING_ROTATION_MIN}
					max={LIGHTING_ROTATION_MAX}
					step={1}
					value={lighting.Rotation}
					disabled={readOnly}
					onChange={(value) => onLightingChange({ Rotation: value })}
				/>
				<SliderRow
					label="Elevation"
					valueText={`${Math.round(lighting.Elevation)} deg`}
					min={LIGHTING_ELEVATION_MIN}
					max={LIGHTING_ELEVATION_MAX}
					step={1}
					value={lighting.Elevation}
					disabled={readOnly}
					onChange={(value) => onLightingChange({ Elevation: value })}
				/>
			</section>

			<section className="py-4 first:pt-0 last:pb-0 space-y-3">
				<div className="text-sm font-semibold">Surroundings</div>
				<ToggleRow
					label="Show surroundings"
					checked={!!surroundings}
					disabled={readOnly}
					onChange={(checked) =>
						onSurroundingsChange(
							checked
								? {
									...DEFAULT_VOXEL_TERRAIN_SURROUNDINGS,
									Height: Math.min(
										DEFAULT_VOXEL_TERRAIN_SURROUNDINGS.Height,
										maxSurroundingsHeight,
									),
								}
								: undefined,
						)
					}
				/>
				{surroundings && (
					<>
						<SliderRow
							label="Height"
							valueText={`${Math.round(surroundings.Height)}`}
							min={0}
							max={maxSurroundingsHeight}
							step={1}
							value={surroundings.Height}
							disabled={readOnly}
							onChange={(value) =>
								onSurroundingsChange({ ...surroundings, Height: value })
							}
						/>
						<TerrainColorPicker
							compact
							value={surroundings.ColorIndex}
							onChange={(index) =>
								onSurroundingsChange({ ...surroundings, ColorIndex: index })
							}
							disabled={readOnly}
							excludeIndices={SURROUNDINGS_EXCLUDED_INDICES}
						/>
					</>
				)}
			</section>

			<section className="py-4 first:pt-0 last:pb-0 space-y-3">
				<div className="text-sm font-semibold">Background</div>
				<ToggleRow
					label="Show color"
					checked={!!background.Color}
					disabled={readOnly}
					onChange={(checked) =>
						onBackgroundChange(checked ? { Color: backgroundColor } : {})
					}
				/>
				<input
					type="color"
					className="h-10 w-full cursor-pointer rounded border border-base-300 bg-base-100 p-1 disabled:cursor-not-allowed disabled:brightness-75"
					value={backgroundColor}
					onChange={(e) => onBackgroundChange({ Color: e.target.value })}
					disabled={readOnly || !background.Color}
				/>
			</section>
		</div>
	);
}
