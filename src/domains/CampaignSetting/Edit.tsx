// domains/CampaignSetting/Edit.tsx

import { useState } from "react";
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
import { StatDefinitionsEditor } from "../../components/inputs/StatDefinitionEditor";
import { ActionDefinitionEditor } from "../../components/inputs/ActionDefinitionEditor";
import { AttributeDefinitionEditor } from "../../components/inputs/AttributeDefinitionEditor";
import { SharedInventoriesEditor } from "../../components/inputs/SharedInventoriesEditor";
import CalendarConfigEditor from "../../components/inputs/CalendarConfigEditor";
import { MovementSettingsEditor } from "../../components/inputs/MovementSettingsEditor";
import { InitiativeSettingsEditor } from "../../components/inputs/InitiativeSettingsEditor";
import { ScriptingFields } from "../../components/inputs/ScriptingFields";
import { Campaign } from "../Campaign/Campaign";
import {
	cloneVoxelTerrainEnvironmentPreset,
	type VoxelTerrainEnvironmentPreset,
} from "../VoxelTerrain/VoxelTerrain";

export function CampaignSettingEdit() {
	const context = useQuestContext();
	const { actionService } = useActionService();
	const campaign = CampaignUtils.getActiveCampaign(context);
	const [exportProgress, setExportProgress] = useState<ExportProgress | null>(null);
	const [isExporting, setIsExporting] = useState(false);

	const handleSaveCampaign = (data: Campaign) => {
		if (!actionService) return;

		actionService.execute("campaign:edit", {
			campaignId: campaign.Id,
			updates: {
				Name: data.Name,
			},
		});
	};

	const handleSaveSettings = (data: CampaignSettings) => {
		if (!actionService) return;

		actionService.execute("setting:edit", {
			updates: data,
		});
	};

	// World-rule scripts live on the campaign itself: `this` is the campaign and
	// they can react to any action. Persisted via campaign:edit alongside metadata.
	const handleSaveWorldRules = (data: Campaign) => {
		if (!actionService) return;

		actionService.execute("campaign:edit", {
			campaignId: campaign.Id,
			updates: {
				Scripts: data.Scripts,
				Parameters: data.Parameters,
			},
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
			{/* Campaign Name Section */}
			<FormWrapper
				domain="campaign"
				entityId={campaign.Id}
				initialData={campaign}
				onSave={handleSaveCampaign}
				onClose={() => { }}
				createTitle="Campaign Information"
				editTitle="Campaign Information"
				viewTitle="Campaign Information"
				buttonConfig={{
					showTopCancel: false,
					showBottomButtons: false,
				}}
			>
				<CampaignNameForm />
			</FormWrapper>

			{/* Settings Section */}
			<div className="mt-6">
				<FormWrapper
					domain="setting"
					entityId={campaign.Id}
					initialData={campaign.Settings}
					onSave={handleSaveSettings}
					onClose={() => { }}
					createTitle="Campaign Settings"
					editTitle="Campaign Settings"
					viewTitle="Campaign Settings"
					buttonConfig={{
						showTopCancel: false,
						showBottomButtons: false,
						keepButtonsVisible: true,
					}}
				>
					<CampaignSettingForm
						combatActive={campaign.GameState.CombatState.isActive}
					/>
				</FormWrapper>
			</div>

			{/* World Rules (Scripting) Section */}
			<div className="mt-6">
				<FormWrapper
					domain="campaign"
					entityId={campaign.Id}
					initialData={campaign}
					onSave={handleSaveWorldRules}
					onClose={() => { }}
					createTitle="World Rules"
					editTitle="World Rules"
					viewTitle="World Rules"
					buttonConfig={{
						showTopCancel: false,
						showBottomButtons: true,
						keepButtonsVisible: true,
					}}
				>
					<CampaignWorldRulesForm />
				</FormWrapper>
			</div>

			{/* Export Section */}
			<div className="card bg-base-100 shadow-xl border-2 border-base-300 mt-6 ml-48 w-120">
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
						onClick={handleExport}
						disabled={isExporting}
						className="btn btn-primary gap-2"
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
		</div>
	);
}
// ============================================================================
// CAMPAIGN NAME FORM (Simple component for just the name)
// ============================================================================

interface CampaignNameFormProps {
	data?: Campaign;
	onChange?: (data: Campaign) => void;
}

function CampaignNameForm({ data, onChange }: CampaignNameFormProps) {
	if (!data || !onChange) return null;

	const handleFieldChange = (field: keyof Campaign, value: any) => {
		onChange({
			...data,
			[field]: value,
		});
	};

	return (
		<FormSection
			title="Campaign Name"
			description="The display name for this campaign"
		>
			<FormField label="Name">
				<input
					type="text"
					value={data.Name}
					onChange={(e) => handleFieldChange("Name", e.target.value)}
					className="input input-bordered w-full"
					placeholder="Campaign Name"
					maxLength={100}
				/>
			</FormField>
		</FormSection>
	);
}
// ============================================================================
// CAMPAIGN WORLD RULES FORM (campaign-level scripting)
// ============================================================================

interface CampaignWorldRulesFormProps {
	data?: Campaign;
	onChange?: (data: Campaign) => void;
}

function CampaignWorldRulesForm({ data, onChange }: CampaignWorldRulesFormProps) {
	if (!data || !onChange) return null;

	return (
		<>
			<FormSection
				title="World Rules"
				description="Campaign-wide scripted behavior. A world rule reacts to any action across the whole campaign — every actor, combat, spawns — to express house rules (e.g. a toxic-fog map that drains HP each round). Usually machine-authored."
			>
				<div className="text-sm opacity-70">
					World-rule scripts run with <code>this</code> bound to the campaign and
					can reach anything via <code>game</code>.
				</div>
			</FormSection>
			<ScriptingFields data={data} onChange={onChange} />
		</>
	);
}

// ============================================================================
// CAMPAIGN SETTING FORM (Receives data and onChange from FormWrapper)
// ============================================================================

interface CampaignSettingFormProps {
	data?: CampaignSettings;
	onChange?: (data: CampaignSettings) => void;
	combatActive?: boolean;
}

function CampaignSettingForm({
	data,
	onChange,
	combatActive = false,
}: CampaignSettingFormProps) {
	if (!data || !onChange) return null;

	const handleSettingChange = (
		category: keyof CampaignSettings,
		field: string,
		value: any
	) => {
		onChange({
			...data,
			[category]: {
				...(data[category] as object),
				[field]: value,
			},
		});
	};

	const updateSettings = (updates: Partial<CampaignSettings>) => {
		onChange({ ...data, ...updates });
	};

	return (
		<>
			{/* Stat Definitions */}
			<FormSection
				title="Stat Definitions"
				description="Define custom stats for characters (HP, Mana, Stamina, etc.)"
			>
				<StatDefinitionsEditor
					stats={data.StatDefinitions}
					sharedInventories={data.SharedInventories}
					onChange={(stats) => updateSettings({ StatDefinitions: stats })}
				/>
			</FormSection>

			{/* Action Definitions */}
			<FormSection
				title="Action Definitions"
				description="Define types of actions and their default counts per turn"
			>
				<ActionDefinitionEditor
					actions={data.ActionDefinitions}
					onChange={(actions) => updateSettings({ ActionDefinitions: actions })}
				/>
			</FormSection>

			{/* Attribute Definitions */}
			<FormSection
				title="Attribute Definitions"
				description="Define custom attributes for characters (Class, Level, Alignment, etc.). Attributes only appear on a character sheet if they have a value."
			>
				<AttributeDefinitionEditor
					attributes={data.AttributeDefinitions ?? []}
					onChange={(attributes) =>
						updateSettings({ AttributeDefinitions: attributes })
					}
				/>
			</FormSection>

			{/* Shared Inventories */}
			<FormSection
				title="Shared Inventories"
				description="Define shared inventories for the party to pool resources/stats (e.g., Medkit, Party SP)"
			>
				<SharedInventoriesEditor
					inventories={data.SharedInventories ?? []}
					onChange={(inventories) => updateSettings({ SharedInventories: inventories })}
				/>
			</FormSection>

			{/* Visibility Settings */}
			<FormSection
				title="Visibility Settings"
				description="Control what information players can see"
			>
				<FormGrid cols={2}>
					<FormField label="Players can see DM rolls">
						<input
							type="checkbox"
							checked={data.VisibilitySettings.playersSeeDMRolls}
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
							checked={data.VisibilitySettings.playersSeePeerRolls}
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
							checked={data.VisibilitySettings.playersSeeEntityHealth}
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
								data.VisibilitySettings.playersSeeEntityDescriptions !== false
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
								data.VisibilitySettings.playersSeeEntityAttributes !== false
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
								data.VisibilitySettings.playersSeeEntityActions !== false
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
			{/* Calendar Settings */}
			<FormSection
				title="Calendar Settings"
				description="Customize your world's calendar (days, weeks, months, labels, names)."
			>
				<FormField label="Show calendar date to everyone">
					<input
						type="checkbox"
						checked={data.CalendarSettings.enabled !== false}
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
					value={data.CalendarSettings}
					onChange={(CalendarSettings) => updateSettings({ CalendarSettings })}
				/>
			</FormSection>
			<FormSection
				title="Rest Settings"
			>
				<FormField label="Number of short rests per day">
					<input
						type="number"
						value={data.RestSettings.shortRestsPerDay}
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
						checked={data.RestSettings.autoAdvanceDayOnLongRest}
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
			<FormSection
				title="Initiative Order"
				description="Configure how combat turn order is determined within a side. Pick a primary stat/attribute/move speed, then optionally add tiebreakers."
			>
				<InitiativeSettingsEditor
					value={data.InitiativeSettings}
					statDefinitions={data.StatDefinitions}
					attributeDefinitions={data.AttributeDefinitions ?? []}
					onChange={(InitiativeSettings) => updateSettings({ InitiativeSettings })}
					lockMode={combatActive}
				/>
			</FormSection>
			<FormSection
				title="Terrain Environments"
				description="Saved lighting and background presets for terrain maps."
			>
				<TerrainEnvironmentPresetsEditor
					presets={data.TerrainEnvironmentPresets}
					onChange={(TerrainEnvironmentPresets) =>
						updateSettings({ TerrainEnvironmentPresets })
					}
				/>
			</FormSection>
			<FormSection
				title="Movement & Height"
				description="Configure how terrain height affects movement cost"
			>
				<MovementSettingsEditor
					formula={data.MovementSettings.heightCostFormula}
					lookup={data.MovementSettings.heightCostLookup}
					onChange={(formula, lookup) =>
						updateSettings({
							MovementSettings: {
								...data.MovementSettings,
								heightCostFormula: formula,
								heightCostLookup: lookup,
							},
						})
					}
				/>

				<FormField label="Flying units reduce vertical costs">
					<input
						type="checkbox"
						checked={data.MovementSettings.flyingIgnoresHeight}
						onChange={(e) =>
							updateSettings({
								MovementSettings: {
									...data.MovementSettings,
									flyingIgnoresHeight: e.target.checked,
								},
							})
						}
						className="toggle toggle-primary"
					/>
				</FormField>

				<FormField
					label="Restrict player movement to range (in combat)"
				>
					<input
						type="checkbox"
						checked={data.MovementSettings.restrictPlayerMovementToRange ?? false}
						onChange={(e) =>
							updateSettings({
								MovementSettings: {
									...data.MovementSettings,
									restrictPlayerMovementToRange: e.target.checked,
								},
							})
						}
						className="toggle toggle-primary"
					/>
				</FormField>
			</FormSection>
		</>
	);
}

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
