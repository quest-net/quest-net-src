// domains/CampaignSetting/Edit.tsx

import { useQuestContext } from "../Context/ContextProvider";
import { useActionService } from "../../services/Actions/ActionServiceProvider";
import { CampaignActions } from "../Campaign/CampaignActions";
import { CampaignSettings } from "./CampaignSetting";
import {
	FormWrapper,
	FormSection,
	FormField,
	FormGrid,
} from "../../components/Form/Form";
import { StatDefinitionsEditor } from "../../components/inputs/StatDefinitionEditor";
import CalendarConfigEditor from "../../components/inputs/CalendarConfigEditor";

export function CampaignSettingEdit() {
	const context = useQuestContext();
	const { actionService } = useActionService();
	const campaign = CampaignActions.getActiveCampaign(context);

	const handleSave = (data: CampaignSettings) => {
		if (!actionService) return;

		actionService.execute("setting:edit", {
			updates: data,
		});
	};

	return (
		<div className="p-6">
			<FormWrapper
				domain="setting"
				entityId={campaign.Id}
				initialData={campaign.Settings}
				onSave={handleSave}
				onClose={() => {}}
				createTitle="Campaign Settings"
				editTitle="Campaign Settings"
				viewTitle="Campaign Settings"
			>
				<CampaignSettingForm />
			</FormWrapper>
		</div>
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
					onChange={(stats) => updateSettings({ StatDefinitions: stats })}
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
				description="Customize your world’s calendar (days, weeks, months, labels, names)."
			>
				<CalendarConfigEditor
					value={data.CalendarSettings}
					onChange={(CalendarSettings) => updateSettings({ CalendarSettings })}
				/>
			</FormSection>
		</>
	);
}
