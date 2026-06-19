// domains/CampaignSetting/Edit.tsx

import { useState } from "react";
import { useIsMobile } from "../../hooks/useIsMobile";
import { useQuestContext } from "../Context/ContextProvider";
import { useActionService } from "../../services/Actions/ActionServiceProvider";
import { CampaignUtils, ExportProgress } from "../Campaign/CampaignUtils";
import {
	getCampaignTerrainEnvironmentPresets,
	type CampaignSettings,
} from "./CampaignSetting";
import {
	FormWrapper,
	FormSection,
	FormField,
	FormGrid,
	useFormReadOnly,
} from "../../components/Form/Form";
import { StatDefinitionsEditor } from "../../components/editors/StatDefinitionEditor";
import { ActionDefinitionEditor } from "../../components/editors/ActionDefinitionEditor";
import { AttributeDefinitionEditor } from "../../components/editors/AttributeDefinitionEditor";
import { SharedInventoriesEditor } from "../../components/editors/SharedInventoriesEditor";
import CalendarConfigEditor from "../../components/editors/CalendarConfigEditor";
import { MovementSettingsEditor } from "../../components/editors/MovementSettingsEditor";
import { InitiativeSettingsEditor } from "../../components/editors/InitiativeSettingsEditor";
import { ScriptingFields } from "../../components/editors/ScriptingFields";
import { SecretModeToggle } from "../../components/editors/SecretModeToggle";
import { CampaignStats } from "./CampaignStats";
import { Campaign } from "../Campaign/Campaign";
import {
	cloneVoxelTerrainEnvironmentPreset,
	type VoxelTerrainEnvironmentPreset,
} from "../VoxelTerrain/VoxelTerrain";

// ============================================================================
// CATEGORIES
// ============================================================================

type SettingsCategory =
	| "general"
	| "statsActions"
	| "sharedInventories"
	| "combat"
	| "time"
	| "visibility"
	| "terrain"
	| "worldRules";

const SETTINGS_CATEGORY_KEY = "campaign-settings-category";

const CATEGORIES: { id: SettingsCategory; label: string; icon: string }[] = [
	{ id: "general", label: "General", icon: "icon-[mdi--information-outline]" },
	{
		id: "statsActions",
		label: "Stats & Actions",
		icon: "icon-[mdi--format-list-bulleted-type]",
	},
	{
		id: "sharedInventories",
		label: "Shared Inventories",
		icon: "icon-[mdi--treasure-chest]",
	},
	{ id: "combat", label: "Combat", icon: "icon-[mdi--sword-cross]" },
	{ id: "time", label: "Time & Rest", icon: "icon-[mdi--calendar-clock]" },
	{ id: "visibility", label: "Visibility", icon: "icon-[mdi--eye]" },
	{ id: "terrain", label: "Terrain", icon: "icon-[mdi--terrain]" },
	{ id: "worldRules", label: "World Rules", icon: "icon-[mdi--script-text]" },
];

// ============================================================================
// CAMPAIGN SETTING EDIT (single unified form over the whole Campaign)
// ============================================================================

export function CampaignSettingEdit() {
	const context = useQuestContext();
	const { actionService } = useActionService();
	const campaign = CampaignUtils.getActiveCampaign(context);
	const [exportProgress, setExportProgress] = useState<ExportProgress | null>(null);
	const [isExporting, setIsExporting] = useState(false);

	// One Save persists everything: campaign metadata + world-rule scripts via
	// `campaign:edit`, and the settings payload via `setting:edit`.
	const handleSave = (data: Campaign) => {
		if (!actionService) return;

		actionService.execute("campaign:edit", {
			campaignId: campaign.Id,
			updates: {
				Name: data.Name,
				Scripts: data.Scripts,
				Parameters: data.Parameters,
			},
		});

		actionService.execute("setting:edit", {
			updates: data.Settings,
		});
	};

	const handleExport = async () => {
		setIsExporting(true);
		setExportProgress({
			current: 0,
			total: 1,
			status: "Starting export...",
		});

		try {
			await CampaignUtils.download(
				{ campaignId: campaign.Id },
				context,
				setExportProgress
			);

			// Show success for a moment before clearing
			setTimeout(() => {
				setExportProgress(null);
				setIsExporting(false);
			}, 2000);
		} catch (error) {
			console.error("Export failed:", error);
			alert(
				`Export failed: ${error instanceof Error ? error.message : "Unknown error"
				}`
			);
			setExportProgress(null);
			setIsExporting(false);
		}
	};

	return (
		<div className="p-6">
			<FormWrapper
				domain="setting"
				entityId={campaign.Id}
				initialData={campaign}
				onSave={handleSave}
				onClose={() => { }}
				createTitle="Campaign Settings"
				editTitle="Campaign Settings"
				viewTitle="Campaign Settings"
				fullWidth
				buttonConfig={{
					showTopCancel: false,
					showBottomButtons: false,
					keepButtonsVisible: true,
				}}
			>
				<CampaignSettingsLayout
					combatActive={campaign.GameState.CombatState.isActive}
					exportProgress={exportProgress}
					isExporting={isExporting}
					onExport={handleExport}
				/>
			</FormWrapper>
		</div>
	);
}

// ============================================================================
// LAYOUT (two-pane: category nav + active category content)
// ============================================================================

interface CampaignSettingsLayoutProps {
	// Injected by FormWrapper
	data?: Campaign;
	onChange?: (data: Campaign) => void;
	combatActive?: boolean;
	exportProgress: ExportProgress | null;
	isExporting: boolean;
	onExport: () => void;
}

function CampaignSettingsLayout({
	data,
	onChange,
	combatActive = false,
	exportProgress,
	isExporting,
	onExport,
}: CampaignSettingsLayoutProps) {
	const isMobile = useIsMobile();
	const [activeCategory, setActiveCategory] = useState<SettingsCategory>(() => {
		const stored = localStorage.getItem(SETTINGS_CATEGORY_KEY) as SettingsCategory | null;
		return CATEGORIES.some((c) => c.id === stored) ? (stored as SettingsCategory) : "general";
	});

	if (!data || !onChange) return null;

	const settings = data.Settings;

	const selectCategory = (id: SettingsCategory) => {
		localStorage.setItem(SETTINGS_CATEGORY_KEY, id);
		setActiveCategory(id);
	};

	const updateSettings = (updates: Partial<CampaignSettings>) => {
		onChange({ ...data, Settings: { ...settings, ...updates } });
	};

	const handleSettingChange = (
		category: keyof CampaignSettings,
		field: string,
		value: any
	) => {
		updateSettings({
			[category]: {
				...(settings[category] as object),
				[field]: value,
			},
		} as Partial<CampaignSettings>);
	};

	const handleCampaignChange = (field: keyof Campaign, value: any) => {
		onChange({ ...data, [field]: value });
	};

	const content = (
		<div className="flex-1 min-w-0 space-y-6">
			{renderCategory(activeCategory, {
				data,
				onChange,
				settings,
				combatActive,
				updateSettings,
				handleSettingChange,
				handleCampaignChange,
			})}
		</div>
	);

	// Right column: persistent across every category. Holds secret mode, export,
	// and at-a-glance campaign stats.
	const infoColumn = (
		<aside className="w-full lg:w-72 space-y-4">
			{/* General already shows stats large in its content; avoid duplicating. */}
			{activeCategory !== "general" && <CampaignStats campaign={data} />}
			<SecretModeToggle variant="panel" />
			<ExportCard
				exportProgress={exportProgress}
				isExporting={isExporting}
				onExport={onExport}
			/>
		</aside>
	);

	if (isMobile) {
		return (
			<div className="space-y-4">
				<div className="tabs tabs-boxed flex-nowrap overflow-x-auto">
					{CATEGORIES.map((c) => (
						<button
							key={c.id}
							type="button"
							className={`tab gap-2 ${activeCategory === c.id ? "tab-active" : ""}`}
							onClick={() => selectCategory(c.id)}
						>
							<span className={`${c.icon} w-4 h-4`} />
							{c.label}
						</button>
					))}
				</div>
				{content}
				{infoColumn}
			</div>
		);
	}

	return (
		<div className="flex items-start gap-6">
			{/* In-content category nav: a rounded, labeled panel inset within the
			    content padding, distinct from DMView's flush icon-only app rail. */}
			<nav className="w-56 shrink-0">
				<div className="card bg-base-100 border-2 border-base-300 sticky top-4">
					<div className="card-body p-2">
						<h3 className="px-3 pt-2 pb-1 text-sm font-semibold opacity-70">
							Settings
						</h3>
						<ul className="menu gap-1 w-full">
							{CATEGORIES.map((c) => (
								<li key={c.id}>
									<button
										type="button"
										className={activeCategory === c.id ? "menu-active" : ""}
										onClick={() => selectCategory(c.id)}
									>
										<span className={`${c.icon} w-5 h-5`} />
										{c.label}
									</button>
								</li>
							))}
						</ul>
					</div>
				</div>
			</nav>
			{content}
			<div className="sticky top-4 shrink-0">{infoColumn}</div>
		</div>
	);
}

// ============================================================================
// CATEGORY CONTENT
// ============================================================================

interface CategoryRenderArgs {
	data: Campaign;
	onChange: (data: Campaign) => void;
	settings: CampaignSettings;
	combatActive: boolean;
	updateSettings: (updates: Partial<CampaignSettings>) => void;
	handleSettingChange: (
		category: keyof CampaignSettings,
		field: string,
		value: any
	) => void;
	handleCampaignChange: (field: keyof Campaign, value: any) => void;
}

function renderCategory(category: SettingsCategory, args: CategoryRenderArgs) {
	const {
		data,
		onChange,
		settings,
		combatActive,
		updateSettings,
		handleSettingChange,
		handleCampaignChange,
	} = args;

	switch (category) {
		case "general":
			return (
				<>
					<FormSection
						title="Campaign Name"
						description="The display name for this campaign"
					>
						<FormField label="Name">
							<input
								type="text"
								value={data.Name}
								onChange={(e) => handleCampaignChange("Name", e.target.value)}
								className="input input-bordered w-full"
								placeholder="Campaign Name"
								maxLength={100}
							/>
						</FormField>
					</FormSection>

					<CampaignStats campaign={data} variant="large" />
				</>
			);

		case "statsActions":
			return (
				<>
					<FormSection
						title="Stat Definitions"
						description="Define custom stats for characters (HP, Mana, Stamina, etc.)"
					>
						<StatDefinitionsEditor
							stats={settings.StatDefinitions}
							onChange={(stats) => updateSettings({ StatDefinitions: stats })}
						/>
					</FormSection>

					<div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
						<FormSection
							title="Action Definitions"
							description="Define types of actions and their default counts per turn"
						>
							<ActionDefinitionEditor
								actions={settings.ActionDefinitions}
								onChange={(actions) =>
									updateSettings({ ActionDefinitions: actions })
								}
							/>
						</FormSection>

						<FormSection
							title="Attribute Definitions"
							description="Define custom attributes for characters (Class, Level, Alignment, etc.). Attributes only appear on a character sheet if they have a value."
						>
							<AttributeDefinitionEditor
								attributes={settings.AttributeDefinitions ?? []}
								onChange={(attributes) =>
									updateSettings({ AttributeDefinitions: attributes })
								}
							/>
						</FormSection>
					</div>
				</>
			);

		case "sharedInventories":
			return (
				<FormSection
					title="Shared Inventories"
					description="Define shared inventories for the party to pool resources/stats (e.g., Medkit, Party SP)"
				>
					<SharedInventoriesEditor
						inventories={settings.SharedInventories ?? []}
						onChange={(inventories) =>
							updateSettings({ SharedInventories: inventories })
						}
					/>
				</FormSection>
			);

		case "combat":
			return (
				<div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
					<FormSection
						title="Initiative Order"
						description="Configure how combat turn order is determined within a side. Pick a primary stat/attribute/move speed, then optionally add tiebreakers."
					>
						<InitiativeSettingsEditor
							value={settings.InitiativeSettings}
							statDefinitions={settings.StatDefinitions}
							attributeDefinitions={settings.AttributeDefinitions ?? []}
							onChange={(InitiativeSettings) =>
								updateSettings({ InitiativeSettings })
							}
							lockMode={combatActive}
						/>
					</FormSection>

					<FormSection
						title="Movement & Height"
						description="Configure how terrain height affects movement cost"
					>
						<MovementSettingsEditor
							formula={settings.MovementSettings.heightCostFormula}
							lookup={settings.MovementSettings.heightCostLookup}
							onChange={(formula, lookup) =>
								updateSettings({
									MovementSettings: {
										...settings.MovementSettings,
										heightCostFormula: formula,
										heightCostLookup: lookup,
									},
								})
							}
						/>

						<FormField label="Flying units reduce vertical costs">
							<input
								type="checkbox"
								checked={settings.MovementSettings.flyingIgnoresHeight}
								onChange={(e) =>
									updateSettings({
										MovementSettings: {
											...settings.MovementSettings,
											flyingIgnoresHeight: e.target.checked,
										},
									})
								}
								className="toggle toggle-primary"
							/>
						</FormField>

						<FormField label="Restrict player movement to range (in combat)">
							<input
								type="checkbox"
								checked={
									settings.MovementSettings.restrictPlayerMovementToRange ?? false
								}
								onChange={(e) =>
									updateSettings({
										MovementSettings: {
											...settings.MovementSettings,
											restrictPlayerMovementToRange: e.target.checked,
										},
									})
								}
								className="toggle toggle-primary"
							/>
						</FormField>
					</FormSection>
				</div>
			);

		case "time":
			return (
				<div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
					<FormSection
						title="Calendar Settings"
						description="Customize your world's calendar (days, weeks, months, labels, names)."
					>
						<FormField label="Show calendar date to everyone">
							<input
								type="checkbox"
								checked={settings.CalendarSettings.enabled !== false}
								onChange={(e) =>
									handleSettingChange(
										"CalendarSettings",
										"enabled",
										e.target.checked
									)
								}
								className="toggle toggle-primary"
							/>
						</FormField>
						<CalendarConfigEditor
							value={settings.CalendarSettings}
							onChange={(CalendarSettings) => updateSettings({ CalendarSettings })}
						/>
					</FormSection>

					<FormSection title="Rest Settings">
						<FormField label="Number of short rests per day">
							<input
								type="number"
								value={settings.RestSettings.shortRestsPerDay}
								onChange={(e) =>
									handleSettingChange(
										"RestSettings",
										"shortRestsPerDay",
										Number(e.target.value)
									)
								}
								className="input"
							/>
						</FormField>
						<FormField label="Long rest increments calendar">
							<input
								type="checkbox"
								checked={settings.RestSettings.autoAdvanceDayOnLongRest}
								onChange={(e) =>
									handleSettingChange(
										"RestSettings",
										"autoAdvanceDayOnLongRest",
										e.target.checked
									)
								}
								className="toggle toggle-primary"
							/>
						</FormField>
					</FormSection>
				</div>
			);

		case "visibility":
			return (
				<FormSection
					title="Visibility Settings"
					description="Control what information players can see"
				>
					<FormGrid cols={3}>
						<FormField label="Players can see DM rolls">
							<input
								type="checkbox"
								checked={settings.VisibilitySettings.playersSeeDMRolls}
								onChange={(e) =>
									handleSettingChange(
										"VisibilitySettings",
										"playersSeeDMRolls",
										e.target.checked
									)
								}
								className="toggle toggle-primary"
							/>
						</FormField>

						<FormField label="Players can see other players' rolls">
							<input
								type="checkbox"
								checked={settings.VisibilitySettings.playersSeePeerRolls}
								onChange={(e) =>
									handleSettingChange(
										"VisibilitySettings",
										"playersSeePeerRolls",
										e.target.checked
									)
								}
								className="toggle toggle-primary"
							/>
						</FormField>

						<FormField label="Players can see entities' max health">
							<input
								type="checkbox"
								checked={settings.VisibilitySettings.playersSeeEntityHealth}
								onChange={(e) =>
									handleSettingChange(
										"VisibilitySettings",
										"playersSeeEntityHealth",
										e.target.checked
									)
								}
								className="toggle toggle-primary"
							/>
						</FormField>

						<FormField label="Players can see entity descriptions">
							<input
								type="checkbox"
								checked={
									settings.VisibilitySettings.playersSeeEntityDescriptions !==
									false
								}
								onChange={(e) =>
									handleSettingChange(
										"VisibilitySettings",
										"playersSeeEntityDescriptions",
										e.target.checked
									)
								}
								className="toggle toggle-primary"
							/>
						</FormField>

						<FormField label="Players can see entity attributes">
							<input
								type="checkbox"
								checked={
									settings.VisibilitySettings.playersSeeEntityAttributes !==
									false
								}
								onChange={(e) =>
									handleSettingChange(
										"VisibilitySettings",
										"playersSeeEntityAttributes",
										e.target.checked
									)
								}
								className="toggle toggle-primary"
							/>
						</FormField>

						<FormField label="Players can see entity actions">
							<input
								type="checkbox"
								checked={
									settings.VisibilitySettings.playersSeeEntityActions !== false
								}
								onChange={(e) =>
									handleSettingChange(
										"VisibilitySettings",
										"playersSeeEntityActions",
										e.target.checked
									)
								}
								className="toggle toggle-primary"
							/>
						</FormField>
					</FormGrid>
				</FormSection>
			);

		case "terrain":
			return (
				<FormSection
					title="Terrain Environments"
					description="Saved lighting and background presets for terrain maps."
				>
					<TerrainEnvironmentPresetsEditor
						presets={settings.TerrainEnvironmentPresets}
						onChange={(TerrainEnvironmentPresets) =>
							updateSettings({ TerrainEnvironmentPresets })
						}
					/>
				</FormSection>
			);

		case "worldRules":
			return (
				<>
					<FormSection
						title="World Rules"
						description="Campaign-wide scripted behavior. A world rule reacts to any action across the whole campaign — every actor, combat, spawns — to express house rules (e.g. a toxic-fog map that drains HP each round). Usually machine-authored."
					>
						<div className="text-sm opacity-70">
							World-rule scripts run with <code>this</code> bound to the campaign
							and can reach anything via <code>game</code>.
						</div>
					</FormSection>
					<ScriptingFields data={data} onChange={onChange} />
				</>
			);
	}
}

// ============================================================================
// EXPORT CARD
// ============================================================================

interface ExportCardProps {
	exportProgress: ExportProgress | null;
	isExporting: boolean;
	onExport: () => void;
}

function ExportCard({ exportProgress, isExporting, onExport }: ExportCardProps) {
	return (
		<div className="card bg-base-100 shadow-xl border-2 border-base-300">
			<div className="card-body">
				<h2 className="card-title">Export Campaign Data</h2>
				<p className="text-sm opacity-70 mb-4">
					Export this campaign as a JSON file including all images. This may take
					a moment for campaigns with many images.
				</p>

				{exportProgress && (
					<div className="space-y-2 mb-4">
						<div className="flex justify-between text-sm">
							<span>{exportProgress.status}</span>
							<span>
								{exportProgress.current} / {exportProgress.total}
							</span>
						</div>
						<progress
							className="progress progress-primary w-full"
							value={exportProgress.current}
							max={exportProgress.total}
						/>
					</div>
				)}

				<button
					onClick={onExport}
					disabled={isExporting}
					className="btn btn-primary gap-2 self-start"
				>
					{isExporting ? (
						<>
							<span className="loading loading-spinner loading-sm" />
							Exporting...
						</>
					) : (
						<>
							<span className="icon-[mdi--download] w-5 h-5" />
							Export Campaign
						</>
					)}
				</button>
			</div>
		</div>
	);
}

// ============================================================================
// TERRAIN ENVIRONMENT PRESETS
// ============================================================================

interface TerrainEnvironmentPresetsEditorProps {
	presets?: VoxelTerrainEnvironmentPreset[];
	onChange: (presets: VoxelTerrainEnvironmentPreset[]) => void;
}

function TerrainEnvironmentPresetsEditor({
	presets,
	onChange,
}: TerrainEnvironmentPresetsEditorProps) {
	const readOnly = useFormReadOnly();
	const [confirmingPresetId, setConfirmingPresetId] = useState<string | null>(
		null
	);
	const environmentPresets = getCampaignTerrainEnvironmentPresets({
		TerrainEnvironmentPresets: presets,
	});

	const deletePreset = (presetId: string) => {
		if (confirmingPresetId !== presetId) {
			setConfirmingPresetId(presetId);
			return;
		}

		onChange(
			environmentPresets
				.filter((preset) => preset.Id !== presetId)
				.map(cloneVoxelTerrainEnvironmentPreset)
		);
		setConfirmingPresetId(null);
	};

	if (environmentPresets.length === 0) {
		return (
			<div className="rounded-md border border-base-300 bg-base-200/40 px-3 py-2 text-sm opacity-70">
				No environment presets saved
			</div>
		);
	}

	return (
		<div className="space-y-2">
			{environmentPresets.map((preset) => {
				const confirming = confirmingPresetId === preset.Id;
				return (
					<div
						key={preset.Id}
						className="flex items-center gap-3 rounded-md border border-base-300 bg-base-200/40 px-3 py-2"
					>
						<div className="min-w-0 flex-1">
							<div className="truncate font-medium">{preset.Name}</div>
							<div className="mt-1 flex flex-wrap items-center gap-3 text-xs opacity-70">
								<span className="inline-flex items-center gap-1">
									<EnvironmentPresetSwatch color={preset.Lighting.Color} />
									Light
								</span>
								<span className="inline-flex items-center gap-1">
									<EnvironmentPresetSwatch color={preset.Background.Color} />
									Background
								</span>
								<span>{preset.Lighting.Intensity.toFixed(2)}</span>
								<span>{Math.round(preset.Lighting.Rotation)} deg</span>
								<span>{Math.round(preset.Lighting.Elevation)} deg</span>
							</div>
						</div>
						<button
							type="button"
							className={`btn btn-square btn-sm ${
								confirming ? "btn-warning" : "btn-error btn-outline"
							}`}
							onClick={() => deletePreset(preset.Id)}
							disabled={readOnly}
							title={confirming ? "Click again to delete preset" : "Delete preset"}
						>
							<span
								className={`h-4 w-4 ${
									confirming
										? "icon-[mdi--alert]"
										: "icon-[mdi--trash-can-outline]"
								}`}
							/>
						</button>
					</div>
				);
			})}
		</div>
	);
}

function EnvironmentPresetSwatch({ color }: { color?: string }) {
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
