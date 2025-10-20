// domains/CampaignSetting/Edit.tsx

import { useQuestContext } from '../Context/ContextProvider';
import { useActionService } from '../../services/Actions/ActionServiceProvider';
import { CampaignActions } from '../Campaign/CampaignActions';
import { CampaignSettings } from './CampaignSetting';
import { FormWrapper, FormSection, FormField, FormGrid } from '../../components/Form/Form';
import { StatDefinitionsEditor } from '../../components/inputs/StatDefinitionEditor';

export function CampaignSettingEdit() {
  const context = useQuestContext();
  const { actionService } = useActionService();
  const campaign = CampaignActions.getActiveCampaign(context);

  const handleSave = (data: CampaignSettings) => {
    if (!actionService) return;
    
    actionService.execute('setting:update', {
      updates: data
    });
  };

  return (
    <FormWrapper
      entityId={campaign.Id}
      initialData={campaign.Settings}
      onSave={handleSave}
      onClose={() => {}} // No close action needed - this is shown in DMView
      createTitle="Campaign Settings"
      editTitle="Campaign Settings"
      viewTitle="Campaign Settings"
    >
      <CampaignSettingForm />
    </FormWrapper>
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

  const handleSettingChange = (category: keyof CampaignSettings, field: string, value: any) => {
    onChange({
      ...data,
      [category]: {
        ...(data[category] as object),
        [field]: value
      }
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
              onChange={(e) => handleSettingChange('VisibilitySettings', 'playersSeeDMRolls', e.target.checked)}
              className="toggle toggle-primary"
            />
          </FormField>

          <FormField label="Players can see other players' rolls">
            <input
              type="checkbox"
              checked={data.VisibilitySettings.playersSeePeerRolls}
              onChange={(e) => handleSettingChange('VisibilitySettings', 'playersSeePeerRolls', e.target.checked)}
              className="toggle toggle-primary"
            />
          </FormField>
        </FormGrid>
      </FormSection>

      {/* Map Settings */}
      <FormSection 
        title="Map Settings"
        description="Configure the game map display"
      >
        <FormField label="3D Mode">
          <input
            type="checkbox"
            checked={data.MapSettings.is3D}
            onChange={(e) => handleSettingChange('MapSettings', 'is3D', e.target.checked)}
            className="toggle toggle-primary"
          />
        </FormField>
      </FormSection>
    </>
  );
}