// domains/Terrain/TerrainDisplay.tsx

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuestContext } from "../Context/ContextProvider";
import { CampaignActions } from "../Campaign/CampaignActions";
import { TerrainStorageService } from "../../services/TerrainStorageService";
import { useActionService } from "../../services/Actions/ActionServiceProvider";
import { getCampaignTerrainEnvironmentPresets } from "../CampaignSetting/CampaignSetting";
import { ToggleButton } from "../../components/ui/ToggleButton";
import {
	DEFAULT_VOXEL_TERRAIN_BACKGROUND_COLOR,
	DEFAULT_VOXEL_TERRAIN_LIGHTING,
	cloneVoxelTerrainEnvironmentPreset,
	type VoxelTerrainBackground,
	type VoxelTerrainEnvironmentPreset,
	type VoxelTerrainEnvironmentPresetId,
	type VoxelTerrainLighting,
} from "../VoxelTerrain/VoxelTerrain";

const ENVIRONMENT_EDIT_DEBOUNCE_MS = 300;
const LIGHTING_INTENSITY_MIN = 0;
const LIGHTING_INTENSITY_MAX = 3;
const LIGHTING_INTENSITY_STEP = 0.05;
const LIGHTING_ROTATION_MIN = 0;
const LIGHTING_ROTATION_MAX = 360;
const LIGHTING_ELEVATION_MIN = 0;
const LIGHTING_ELEVATION_MAX = 90;

const PRESET_ICONS: Record<VoxelTerrainEnvironmentPresetId, string> = {
	neutral: "icon-[mdi--weather-cloudy]",
	nighttime: "icon-[mdi--weather-night]",
	daytime: "icon-[mdi--weather-sunny]",
	sunset: "icon-[mdi--weather-sunset]",
};

type TerrainEnvironmentUpdates = Pick<
	VoxelTerrainEnvironmentPreset,
	"Lighting" | "Background"
>;

function clampNumber(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

function numberInputValue(value: string, fallback: number): number {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeColor(color: string | undefined): string {
	return color?.trim().toLowerCase() ?? "";
}

function cloneLighting(
	lighting: VoxelTerrainLighting | undefined
): VoxelTerrainLighting {
	return {
		...DEFAULT_VOXEL_TERRAIN_LIGHTING,
		...(lighting ?? {}),
	};
}

function cloneBackground(
	background: VoxelTerrainBackground | undefined
): VoxelTerrainBackground {
	return background?.Color ? { Color: background.Color } : {};
}

function lightingMatches(
	a: VoxelTerrainLighting,
	b: VoxelTerrainLighting
): boolean {
	return (
		normalizeColor(a.Color) === normalizeColor(b.Color) &&
		Math.abs(a.Intensity - b.Intensity) < 0.001 &&
		Math.abs(a.Rotation - b.Rotation) < 0.001 &&
		Math.abs(a.Elevation - b.Elevation) < 0.001
	);
}

function backgroundMatches(
	a: VoxelTerrainBackground,
	b: VoxelTerrainBackground
): boolean {
	return normalizeColor(a.Color) === normalizeColor(b.Color);
}

function environmentMatches(
	lighting: VoxelTerrainLighting,
	background: VoxelTerrainBackground,
	environment: TerrainEnvironmentUpdates
): boolean {
	return (
		lightingMatches(lighting, environment.Lighting) &&
		backgroundMatches(background, environment.Background)
	);
}

function getPresetIcon(presetId: string): string {
	return (
		PRESET_ICONS[presetId as VoxelTerrainEnvironmentPresetId] ??
		"icon-[mdi--palette-outline]"
	);
}

function EnvironmentSwatch({ color }: { color?: string }) {
	return (
		<span
			className="h-4 w-4 shrink-0 rounded-full border border-base-300"
			style={{
				background: color
					? color
					: "linear-gradient(135deg, transparent 0 45%, currentColor 45% 55%, transparent 55% 100%)",
			}}
		/>
	);
}

interface EnvironmentSliderProps {
	label: string;
	value: number;
	min: number;
	max: number;
	step: number;
	display: string;
	disabled: boolean;
	onChange: (value: number) => void;
}

function EnvironmentSlider({
	label,
	value,
	min,
	max,
	step,
	display,
	disabled,
	onChange,
}: EnvironmentSliderProps) {
	return (
		<label className="block min-w-0">
			<div className="mb-1 flex items-center justify-between gap-2">
				<span className="label-text text-xs font-medium">{label}</span>
				<span className="text-xs tabular-nums opacity-70">
					{display}
				</span>
			</div>
			<input
				type="range"
				className="range range-xs"
				min={min}
				max={max}
				step={step}
				value={value}
				onChange={(e) => onChange(numberInputValue(e.target.value, value))}
				disabled={disabled}
			/>
		</label>
	);
}

export default function TerrainDisplay({
	terrainId,
}: {
	terrainId?: string;
}) {
	const context = useQuestContext();
	const { actionService } = useActionService();
	const campaign = CampaignActions.getActiveCampaign(context);
	const isDM = context.User.Role === "dm";

	// The terrain whose atmosphere we display/edit is the one being rendered
	// (passed from Main). With per-actor terrain there is no single global one.
	const activeTerrain = campaign.VoxelTerrains.find((t) => t.Id === terrainId);

	const isInteractive = isDM && !!actionService && !!activeTerrain;
	const name = activeTerrain?.Name ?? "Unknown Terrain";
	const isLoaded = TerrainStorageService.isHydrated(activeTerrain);
	const showStatusLine = isDM || !isLoaded;

	const [showAdvanced, setShowAdvanced] = useState(false);
	const [draftLighting, setDraftLighting] =
		useState<VoxelTerrainLighting | null>(null);
	const [draftBackground, setDraftBackground] =
		useState<VoxelTerrainBackground | null>(null);
	const [presetName, setPresetName] = useState("");
	const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const pendingUpdatesRef = useRef<Partial<TerrainEnvironmentUpdates> | null>(
		null
	);
	const pendingTerrainIdRef = useRef<string | null>(null);
	const actionServiceRef = useRef(actionService);

	useEffect(() => {
		actionServiceRef.current = actionService;
	}, [actionService]);

	useEffect(() => {
		setDraftLighting(null);
		setDraftBackground(null);
		pendingUpdatesRef.current = null;
		pendingTerrainIdRef.current = null;
		if (debounceTimerRef.current) {
			clearTimeout(debounceTimerRef.current);
			debounceTimerRef.current = null;
		}
	}, [activeTerrain?.Id]);

	useEffect(() => {
		return () => {
			if (debounceTimerRef.current) {
				clearTimeout(debounceTimerRef.current);
			}
		};
	}, []);

	const committedLighting = useMemo(
		() => cloneLighting(activeTerrain?.Lighting),
		[
			activeTerrain?.Lighting?.Color,
			activeTerrain?.Lighting?.Intensity,
			activeTerrain?.Lighting?.Rotation,
			activeTerrain?.Lighting?.Elevation,
		]
	);
	const committedBackground = useMemo(
		() => cloneBackground(activeTerrain?.Background),
		[activeTerrain?.Background?.Color]
	);

	useEffect(() => {
		if (draftLighting && lightingMatches(draftLighting, committedLighting)) {
			setDraftLighting(null);
		}
		if (
			draftBackground &&
			backgroundMatches(draftBackground, committedBackground)
		) {
			setDraftBackground(null);
		}
	}, [draftLighting, draftBackground, committedLighting, committedBackground]);

	const currentLighting = draftLighting ?? committedLighting;
	const currentBackground = draftBackground ?? committedBackground;
	const backgroundColor =
		currentBackground.Color ?? DEFAULT_VOXEL_TERRAIN_BACKGROUND_COLOR;
	const environmentPresets = useMemo(
		() => getCampaignTerrainEnvironmentPresets(campaign.Settings),
		[campaign.Settings.TerrainEnvironmentPresets]
	);

	const activePreset = useMemo(
		() =>
			environmentPresets.find((preset) =>
				environmentMatches(
					currentLighting,
					currentBackground,
					preset
				)
			) ?? null,
		[currentLighting, currentBackground, environmentPresets]
	);

	const commitEnvironmentUpdate = (
		terrainId: string,
		updates: Partial<TerrainEnvironmentUpdates>
	) => {
		actionServiceRef.current?.execute("terrain:edit", {
			terrainId,
			updates,
			repairActors: false,
		});
	};

	const clearPendingUpdate = () => {
		if (debounceTimerRef.current) {
			clearTimeout(debounceTimerRef.current);
			debounceTimerRef.current = null;
		}
		pendingUpdatesRef.current = null;
		pendingTerrainIdRef.current = null;
	};

	const scheduleEnvironmentUpdate = (
		updates: Partial<TerrainEnvironmentUpdates>
	) => {
		if (!activeTerrain || !isInteractive) return;

		pendingTerrainIdRef.current = activeTerrain.Id;
		pendingUpdatesRef.current = {
			...(pendingUpdatesRef.current ?? {}),
			...updates,
		};

		if (debounceTimerRef.current) {
			clearTimeout(debounceTimerRef.current);
		}

		debounceTimerRef.current = setTimeout(() => {
			const terrainId = pendingTerrainIdRef.current;
			const pendingUpdates = pendingUpdatesRef.current;
			clearPendingUpdate();
			if (!terrainId || !pendingUpdates) return;
			commitEnvironmentUpdate(terrainId, pendingUpdates);
		}, ENVIRONMENT_EDIT_DEBOUNCE_MS);
	};

	const applyPreset = (preset: VoxelTerrainEnvironmentPreset) => {
		if (!activeTerrain || !isInteractive) return;

		const environment: TerrainEnvironmentUpdates = {
			Lighting: { ...preset.Lighting },
			Background: cloneBackground(preset.Background),
		};
		setDraftLighting(environment.Lighting);
		setDraftBackground(environment.Background);
		clearPendingUpdate();

		if (
			environmentMatches(
				committedLighting,
				committedBackground,
				environment
			)
		) {
			return;
		}

		commitEnvironmentUpdate(activeTerrain.Id, environment);
	};

	const saveCurrentEnvironmentAsPreset = () => {
		const name = presetName.trim();
		if (!name || !isInteractive) return;

		const nextPreset: VoxelTerrainEnvironmentPreset = {
			Id: crypto.randomUUID(),
			Name: name,
			Lighting: { ...currentLighting },
			Background: cloneBackground(currentBackground),
		};

		actionServiceRef.current?.execute("setting:edit", {
			updates: {
				TerrainEnvironmentPresets: [
					...environmentPresets.map(cloneVoxelTerrainEnvironmentPreset),
					nextPreset,
				],
			},
		});
		setPresetName("");
	};

	const updateLighting = (updates: Partial<VoxelTerrainLighting>) => {
		const nextLighting = {
			...currentLighting,
			...updates,
		};
		setDraftLighting(nextLighting);
		scheduleEnvironmentUpdate({ Lighting: nextLighting });
	};

	const updateBackground = (updates: VoxelTerrainBackground) => {
		const nextBackground = cloneBackground(updates);
		setDraftBackground(nextBackground);
		scheduleEnvironmentUpdate({ Background: nextBackground });
	};

	if (!activeTerrain) {
		return (
			<div className="h-full place-content-center text-center">
				<div className="text-lg font-semibold">No active terrain</div>
				<div className="mt-1 text-sm opacity-70">
					Select a terrain before configuring the environment.
				</div>
			</div>
		);
	}

	return (
		<div className="relative h-full">
			{isDM && (
				<button
					type="button"
					onClick={() => setShowAdvanced((value) => !value)}
					disabled={!activeTerrain}
					className="btn btn-circle btn-sm btn-ghost absolute right-2 top-2 z-10"
					title={
						showAdvanced
							? "Show environment presets"
							: "Custom environment"
					}
				>
					{showAdvanced ? (
						<span className="icon-[mdi--view-grid] h-5 w-5" />
					) : (
						<span className="icon-[mdi--cog] h-5 w-5" />
					)}
				</button>
			)}

			<div
				className={`flex h-full flex-col ${
					showAdvanced && isDM ? "justify-center gap-2" : "justify-center gap-3"
				}`}
			>
				{!(showAdvanced && isDM) && (
					<div className="text-center">
						<div className="text-xl font-semibold leading-tight">
							Currently in <span className="font-bold">{name}</span>
						</div>
						{showStatusLine && (
							<div className="mt-1 flex flex-wrap items-center justify-center gap-2 text-xs uppercase tracking-wide opacity-70">
								{isDM && (
									<span>
										{activePreset
											? `${activePreset.Name} environment`
											: "Custom environment"}
									</span>
								)}
								{!isLoaded && <span>Loading terrain data...</span>}
							</div>
						)}
						<div className="mx-auto mt-1 h-1 w-full max-w-md bg-linear-to-r from-transparent via-primary to-transparent" />
					</div>
				)}

				{showAdvanced && isDM ? (
					<div className="mx-auto flex w-full max-w-3xl flex-col gap-2 pr-9 text-left sm:pr-0">
						<div className="grid grid-cols-1 gap-2 md:grid-cols-[minmax(190px,1fr)_minmax(220px,1.1fr)]">
							<div className="grid gap-2">
								<label className="flex min-w-0 items-center justify-between gap-2 rounded-md border border-base-300 bg-base-200/40 px-2 py-1.5">
									<span className="label-text text-sm font-medium">
										Light
									</span>
									<input
										type="color"
										className="h-8 w-12 cursor-pointer rounded border border-base-300 bg-base-100 p-1 disabled:cursor-not-allowed disabled:brightness-75"
										value={currentLighting.Color}
										onChange={(e) =>
											updateLighting({ Color: e.target.value })
										}
										disabled={!isInteractive}
										title="Light color"
									/>
								</label>
								<label className="flex min-w-0 items-center justify-between gap-2 rounded-md border border-base-300 bg-base-200/40 px-2 py-1.5">
									<span className="label-text text-sm font-medium">
										Background
									</span>
									<div className="flex items-center gap-2">
										<button
											type="button"
											className="btn btn-square btn-xs btn-ghost"
											onClick={() => updateBackground({})}
											disabled={!isInteractive || !currentBackground.Color}
											title="Clear background color"
										>
											<span className="icon-[mdi--close] h-4 w-4" />
										</button>
										<input
											type="color"
											className="h-8 w-12 cursor-pointer rounded border border-base-300 bg-base-100 p-1 disabled:cursor-not-allowed disabled:brightness-75"
											value={backgroundColor}
											onChange={(e) =>
												updateBackground({ Color: e.target.value })
											}
											disabled={!isInteractive}
											title="Background color"
										/>
									</div>
								</label>
							</div>
							<div className="flex min-w-0 flex-col gap-2 rounded-md border border-base-300 bg-base-200/40 p-2">
								<input
									type="text"
									className="input input-bordered input-md w-58 min-w-0"
									value={presetName}
									onChange={(e) => setPresetName(e.target.value)}
									disabled={!isInteractive}
									maxLength={48}
									placeholder="Preset name"
									aria-label="Preset name"
								/>
								<button
									type="button"
									className="btn btn-primary btn-md w-full gap-2"
									onClick={saveCurrentEnvironmentAsPreset}
									disabled={!isInteractive || presetName.trim().length === 0}
									title="Save terrain environment preset"
								>
									<span className="icon-[mdi--content-save] h-4 w-4" />
									<span>Save</span>
								</button>
							</div>
						</div>
						<div className="grid grid-cols-1 gap-2 rounded-md border border-base-300 bg-base-200/40 p-2 sm:grid-cols-3">
							<EnvironmentSlider
								label="Intensity"
								value={currentLighting.Intensity}
								min={LIGHTING_INTENSITY_MIN}
								max={LIGHTING_INTENSITY_MAX}
								step={LIGHTING_INTENSITY_STEP}
								display={currentLighting.Intensity.toFixed(2)}
								disabled={!isInteractive}
								onChange={(value) =>
									updateLighting({
										Intensity: clampNumber(
											value,
											LIGHTING_INTENSITY_MIN,
											LIGHTING_INTENSITY_MAX
										),
									})
								}
							/>
							<EnvironmentSlider
								label="Rotation"
								value={currentLighting.Rotation}
								min={LIGHTING_ROTATION_MIN}
								max={LIGHTING_ROTATION_MAX}
								step={1}
								display={`${Math.round(currentLighting.Rotation)} deg`}
								disabled={!isInteractive}
								onChange={(value) =>
									updateLighting({
										Rotation: clampNumber(
											value,
											LIGHTING_ROTATION_MIN,
											LIGHTING_ROTATION_MAX
										),
									})
								}
							/>
							<EnvironmentSlider
								label="Elevation"
								value={currentLighting.Elevation}
								min={LIGHTING_ELEVATION_MIN}
								max={LIGHTING_ELEVATION_MAX}
								step={1}
								display={`${Math.round(currentLighting.Elevation)} deg`}
								disabled={!isInteractive}
								onChange={(value) =>
									updateLighting({
										Elevation: clampNumber(
											value,
											LIGHTING_ELEVATION_MIN,
											LIGHTING_ELEVATION_MAX
										),
									})
								}
							/>
						</div>
					</div>
				) : isDM ? (
					<div className="flex flex-wrap justify-center gap-2">
						{environmentPresets.length === 0 && (
							<div className="text-sm opacity-70">
								No environment presets saved
							</div>
						)}
						{environmentPresets.map((preset) => {
							const active = activePreset?.Id === preset.Id;
							return (
								<ToggleButton
									key={preset.Id}
									active={active}
									className="btn-sm min-w-28 gap-2"
									onClick={() => applyPreset(preset)}
									disabled={!isInteractive}
									title={`${preset.Name} environment`}
								>
									<span
										className={`${getPresetIcon(preset.Id)} h-4 w-4`}
									/>
									<span>{preset.Name}</span>
									<EnvironmentSwatch color={preset.Background.Color} />
								</ToggleButton>
							);
						})}
					</div>
				) : null}
			</div>
		</div>
	);
}
