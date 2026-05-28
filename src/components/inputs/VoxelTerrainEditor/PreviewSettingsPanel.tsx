// Sidebar shown in Preview mode. Edits the terrain's Lighting and Background.

import {
	DEFAULT_VOXEL_TERRAIN_BACKGROUND_COLOR,
	type VoxelTerrainBackground,
	type VoxelTerrainLighting,
} from "../../../domains/VoxelTerrain/VoxelTerrain";

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

interface PreviewSettingsPanelProps {
	lighting: VoxelTerrainLighting;
	background: VoxelTerrainBackground;
	readOnly: boolean;
	onLightingChange: (updates: Partial<VoxelTerrainLighting>) => void;
	onBackgroundChange: (updates: VoxelTerrainBackground) => void;
}

export function PreviewSettingsPanel({
	lighting,
	background,
	readOnly,
	onLightingChange,
	onBackgroundChange,
}: PreviewSettingsPanelProps) {
	const backgroundColor = background.Color ?? DEFAULT_VOXEL_TERRAIN_BACKGROUND_COLOR;

	return (
		<>
			<div>
				<div className="text-sm font-semibold mb-2">Lighting</div>
				<div className="space-y-3">
					<label className="flex items-center justify-between gap-3">
						<span className="label-text">Color</span>
						<input
							type="color"
							className="h-9 w-12 cursor-pointer rounded border border-base-300 bg-base-100 p-1"
							value={lighting.Color}
							onChange={(e) => onLightingChange({ Color: e.target.value })}
							disabled={readOnly}
						/>
					</label>
					<label className="block">
						<div className="mb-1 flex items-center justify-between gap-3">
							<span className="label-text">Intensity</span>
							<span className="text-xs tabular-nums text-base-content/70">
								{lighting.Intensity.toFixed(2)}
							</span>
						</div>
						<input
							type="range"
							className="range range-sm"
							min={LIGHTING_INTENSITY_MIN}
							max={LIGHTING_INTENSITY_MAX}
							step={LIGHTING_INTENSITY_STEP}
							value={lighting.Intensity}
							onChange={(e) =>
								onLightingChange({
									Intensity: clampNumber(
										numberInputValue(e.target.value, lighting.Intensity),
										LIGHTING_INTENSITY_MIN,
										LIGHTING_INTENSITY_MAX,
									),
								})
							}
							disabled={readOnly}
						/>
					</label>
					<label className="block">
						<div className="mb-1 flex items-center justify-between gap-3">
							<span className="label-text">Rotation</span>
							<span className="text-xs tabular-nums text-base-content/70">
								{Math.round(lighting.Rotation)} deg
							</span>
						</div>
						<input
							type="range"
							className="range range-sm"
							min={LIGHTING_ROTATION_MIN}
							max={LIGHTING_ROTATION_MAX}
							step={1}
							value={lighting.Rotation}
							onChange={(e) =>
								onLightingChange({
									Rotation: clampNumber(
										numberInputValue(e.target.value, lighting.Rotation),
										LIGHTING_ROTATION_MIN,
										LIGHTING_ROTATION_MAX,
									),
								})
							}
							disabled={readOnly}
						/>
					</label>
					<label className="block">
						<div className="mb-1 flex items-center justify-between gap-3">
							<span className="label-text">Elevation</span>
							<span className="text-xs tabular-nums text-base-content/70">
								{Math.round(lighting.Elevation)} deg
							</span>
						</div>
						<input
							type="range"
							className="range range-sm"
							min={LIGHTING_ELEVATION_MIN}
							max={LIGHTING_ELEVATION_MAX}
							step={1}
							value={lighting.Elevation}
							onChange={(e) =>
								onLightingChange({
									Elevation: clampNumber(
										numberInputValue(e.target.value, lighting.Elevation),
										LIGHTING_ELEVATION_MIN,
										LIGHTING_ELEVATION_MAX,
									),
								})
							}
							disabled={readOnly}
						/>
					</label>
				</div>
			</div>

			<div>
				<div className="text-sm font-semibold mb-2">Background</div>
				<div className="space-y-3">
					<label className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-lg border border-base-300 px-3 py-2">
						<span className="label-text">Color</span>
						<input
							type="checkbox"
							className="toggle toggle-sm toggle-primary"
							checked={!!background.Color}
							onChange={(e) =>
								onBackgroundChange(
									e.target.checked
										? { Color: backgroundColor }
										: {},
								)
							}
							disabled={readOnly}
						/>
					</label>
					<input
						type="color"
						className="h-10 w-full cursor-pointer rounded border border-base-300 bg-base-100 p-1 disabled:cursor-not-allowed disabled:opacity-50"
						value={backgroundColor}
						onChange={(e) => onBackgroundChange({ Color: e.target.value })}
						disabled={readOnly || !background.Color}
					/>
				</div>
			</div>
		</>
	);
}
