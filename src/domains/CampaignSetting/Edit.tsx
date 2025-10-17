// domains/CampaignSetting/Edit.tsx

import { useEffect, useState } from 'react';
import { useQuestContext } from '../Context/ContextProvider';
import { useActionService } from '../../services/Actions/ActionServiceProvider';
import { CampaignActions } from '../Campaign/CampaignActions';
import { CampaignSettings } from './CampaignSetting';
import { FormSection, FormField } from '../../components/Form/FormIndex';
import { StatDefinitionsEditor } from '../../components/inputs/StatDefinitionEditor';

export function CampaignSettingEdit() {
  const context = useQuestContext();
  const { actionService } = useActionService();
  const campaign = CampaignActions.getActiveCampaign(context);
  
  const [settings, setSettings] = useState<CampaignSettings>(campaign.Settings);
  const [isDirty, setIsDirty] = useState(false);

  useEffect(() => {
    const originalSettings = JSON.stringify(campaign.Settings);
    const currentSettings = JSON.stringify(settings);
    
    if (originalSettings !== currentSettings) {
      setIsDirty(true);
    } else {
      setIsDirty(false);
    }
  }, [settings, campaign.Settings]);

  const handleSettingChange = (category: keyof CampaignSettings, field: string) => {
    return (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
      
      setSettings(prev => ({
        ...prev,
        [category]: {
          ...(prev[category] as object), // Cast to ensure spread works
          [field]: value
        }
      }));
    };
  };

  const handleSave = () => {
    if (!actionService) return;
    
    actionService.execute('setting:update', {
      updates: settings
    });

    setIsDirty(false);
  };

  const updateSettings = (updates: Partial<CampaignSettings>) => {
    setSettings(prev => ({ ...prev, ...updates }));
  };

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">Campaign Settings</h2>
        <div className="flex items-center gap-4">
          {isDirty && (
            <span className="text-sm text-warning italic">You have unsaved changes</span>
          )}
          <button onClick={handleSave} className="btn btn-primary">
            Save Changes
          </button>
        </div>
      </div>

      {/* Stat Definitions */}
      <FormSection 
        title="Stat Definitions" 
        description="Define custom stats for characters (HP, Mana, Stamina, etc.)"
      >
        <StatDefinitionsEditor
          stats={settings.StatDefinitions}
          onChange={(stats) => updateSettings({ StatDefinitions: stats })}
          readOnly={false}
        />
      </FormSection>

      {/* Visibility Settings */}
      <FormSection 
        title="Visibility Settings"
        description="Control what information players can see"
      >
          <FormField label="Players can see DM rolls">
            <input
              type="checkbox"
              checked={settings.VisibilitySettings.playersSeeDMRolls}
              onChange={handleSettingChange('VisibilitySettings', 'playersSeeDMRolls')}
              className="toggle toggle-primary"
            />
          </FormField>

          <FormField label="Players can see other players' rolls">
            <input
              type="checkbox"
              checked={settings.VisibilitySettings.playersSeePeerRolls}
              onChange={handleSettingChange('VisibilitySettings', 'playersSeePeerRolls')}
              className="toggle toggle-primary"
            />
          </FormField>
      </FormSection>

      {/* Map Settings */}
      <FormSection 
        title="Map Settings"
        description="Configure the game map display"
      >
        <FormField label="3D Mode">
          <input
            type="checkbox"
            checked={settings.MapSettings.is3D}
            onChange={handleSettingChange('MapSettings', 'is3D')}
            className="toggle toggle-primary"
          />
        </FormField>
      </FormSection>

      {/* Save Button (bottom) */}
      <div className="flex justify-end">
        <button onClick={handleSave} className="btn btn-primary">
          Save Changes
        </button>
      </div>
    </div>
  );
}