// domains/CampaignSetting/Edit.tsx

import { useState } from "react";
import { useQuestContext } from "../Context/ContextProvider";
import { useActionService } from "../../services/Actions/ActionServiceProvider";
import { CampaignActions, ExportProgress } from "../Campaign/CampaignActions";
import { CampaignSettings } from "./CampaignSetting";
import {
	FormWrapper,
	FormSection,
	FormField,
	FormGrid,
} from "../../components/Form/Form";
import { StatDefinitionsEditor } from "../../components/inputs/StatDefinitionEditor";
import { ActionDefinitionEditor } from "../../components/inputs/ActionDefinitionEditor";
import { AttributeDefinitionEditor } from "../../components/inputs/AttributeDefinitionEditor";
import { SharedInventoriesEditor } from "../../components/inputs/SharedInventoriesEditor";
import CalendarConfigEditor from "../../components/inputs/CalendarConfigEditor";
import { MovementSettingsEditor } from "../../components/inputs/MovementSettingsEditor";
import { InitiativeSettingsEditor } from "../../components/inputs/InitiativeSettingsEditor";
import { Campaign } from "../Campaign/Campaign";

export function CampaignSettingEdit() {
	const context = useQuestContext();
	const { actionService } = useActionService();
	const campaign = CampaignActions.getActiveCampaign(context);
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

	const handleExport = async () => {
		setIsExporting(true);
		setExportProgress({
			current: 0,
			total: 1,
			status: "Starting export...",
		});

		try {
			await CampaignActions.download(
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
					}}
				>
					<CampaignSettingForm />
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
// CAMPAIGN SETTING FORM (Receives data and onChange from FormWrapper)
// ============================================================================

interface CampaignSettingFormProps {
	data?: CampaignSettings;
	onChange?: (data: CampaignSettings) => void;
}

function CampaignSettingForm({ data, onChange }: CampaignSettingFormProps) {
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
				</FormGrid>
			</FormSection>
			{/* Calendar Settings */}
			<FormSection
				title="Calendar Settings"
				description="Customize your world's calendar (days, weeks, months, labels, names)."
			>
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

				<FormField label="Flying units ignore vertical costs">
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
			</FormSection>
		</>
	);
}