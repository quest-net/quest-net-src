import { useEffect, useState } from 'react';
import { Character } from './Character';
import { useActionService } from '../../services/Actions/ActionServiceProvider';
import { useQuestContext } from '../Context/ContextProvider';
import { CampaignActions } from '../Campaign/CampaignActions';
import { AttributeEditor } from '../../components/inputs/AttributeEditor';
import { TagEditor } from '../../components/inputs/TagEditor';
import { StatDefinitionsEditor } from '../../components/inputs/StatDefinitionEditor';
import { CampaignSettings } from '../CampaignSetting/CampaignSetting';

interface CharacterEditProps {
  character?: Character;
  mode: 'create' | 'edit' | 'view';
  onClose?: () => void;
}

const getInitialFormData = (campaignSettings: CampaignSettings, character?: Character): Character => {
  if (character) {
    return structuredClone(character); // Use structuredClone for a deep copy
  }

  // Create a new character template
  return {
    Id: crypto.randomUUID(),
    Name: 'New Character',
    Description: '',
    Image: '',
    Stats: structuredClone(campaignSettings.StatDefinitions), // Deep copy from campaign settings
    Attributes: {},
    Position: { x: 0, y: 0 },
    MoveSpeed: 6,
    CanFly: false,
    Inventory: [],
    Equipment: [],
    Skills: [],
    Statuses: [],
    Tags: [],
    Notes: [],
    playedBy: null,
  };
};

export function CharacterEdit({ character, mode, onClose }: CharacterEditProps) {
  const context = useQuestContext();
  const { actionService } = useActionService();
  const campaign = CampaignActions.getActiveCampaign(context);
  const isReadOnly = mode === 'view';

  // Use a stringified version for reliable dirty checking
  const [initialData] = useState(() => getInitialFormData(campaign.Settings, character));
  const [formData, setFormData] = useState<Character>(initialData);
  const [isDirty, setIsDirty] = useState(false);

  useEffect(() => {
    // Compare stringified versions to check for meaningful changes
    setIsDirty(JSON.stringify(initialData) !== JSON.stringify(formData));
  }, [formData, initialData]);

  const handleFieldChange = (field: keyof Character, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleSave = () => {
    if (!actionService) return;
    if (mode === 'create') {
      actionService.execute('character:create', { character: formData });
    } else if (mode === 'edit' && character) {
      // For edits, only send the changed fields for efficiency, but here we send the whole object as per CharacterActions
      actionService.execute('character:edit', { characterId: character.Id, updates: formData });
    }
    onClose?.();
  };
  
  return (
    <div className="p-4 bg-base-200 rounded-lg space-y-6">
      {/* Header */}
      <header className="flex justify-between items-center pb-2 border-b border-base-300">
        <h3 className="text-xl font-bold">{mode === 'create' ? 'Create New Character' : formData.Name}</h3>
        {onClose && (
          <button onClick={onClose} className="btn btn-sm btn-ghost btn-square">
            <span className="icon-[mdi--close] h-6 w-6" />
          </button>
        )}
      </header>

      {/* Form Body */}
      <main className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Main Details */}
          <div className="form-control">
            <label className="label"><span className="label-text">Name</span></label>
            <input 
              type="text" 
              value={formData.Name}
              onChange={(e) => handleFieldChange('Name', e.target.value)}
              disabled={isReadOnly}
              className="input input-bordered"
            />
          </div>
          <div className="form-control md:col-span-2">
            <label className="label"><span className="label-text">Description</span></label>
            <textarea 
              value={formData.Description}
              onChange={(e) => handleFieldChange('Description', e.target.value)}
              disabled={isReadOnly}
              className="textarea textarea-bordered h-24"
              rows={3}
            />
          </div>

          {/* Image Placeholder */}
          <div className="form-control">
            <label className="label"><span className="label-text">Image</span></label>
            <div className="w-full aspect-square bg-base-300 rounded-lg flex items-center justify-center">
              <span className="icon-[mdi--image-off-outline] text-4xl text-base-content/30" />
            </div>
          </div>
          
          {/* Movement */}
          <div className="md:col-span-2 space-y-4">
            <div className="form-control">
              <label className="label"><span className="label-text">Move Speed</span></label>
              <input 
                type="number" 
                value={formData.MoveSpeed}
                onChange={(e) => handleFieldChange('MoveSpeed', parseInt(e.target.value, 10) || 0)}
                disabled={isReadOnly}
                className="input input-bordered"
              />
            </div>
            <div className="form-control">
              <label className="cursor-pointer label justify-start gap-4">
                <input 
                  type="checkbox" 
                  checked={formData.CanFly}
                  onChange={(e) => handleFieldChange('CanFly', e.target.checked)}
                  disabled={isReadOnly}
                  className="checkbox checkbox-primary" 
                />
                <span className="label-text">Can Fly</span> 
              </label>
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="form-control">
          <label className="label"><span className="label-text font-bold">Stats</span></label>
          <StatDefinitionsEditor
            stats={formData.Stats}
            onChange={(stats) => handleFieldChange('Stats', stats)}
            readOnly={isReadOnly}
          />
        </div>

        {/* Attributes */}
        <div className="form-control">
          <label className="label"><span className="label-text font-bold">Attributes</span></label>
          <AttributeEditor 
            attributes={formData.Attributes}
            onChange={(attrs) => handleFieldChange('Attributes', attrs)}
            readOnly={isReadOnly}
          />
        </div>
        
        {/* Tags */}
        <div className="form-control">
          <label className="label"><span className="label-text font-bold">Tags</span></label>
          <TagEditor 
            tags={formData.Tags || []}
            onChange={(tags) => handleFieldChange('Tags', tags)}
            readOnly={isReadOnly}
          />
        </div>
      </main>

      {/* Footer Actions */}
      {mode !== 'view' && (
        <footer className="flex justify-end gap-2 pt-4 border-t border-base-300">
          <button onClick={onClose} className="btn btn-ghost">Cancel</button>
          <button onClick={handleSave} className="btn btn-primary" disabled={!isDirty}>
            Save Changes
          </button>
        </footer>
      )}
    </div>
  );
}