// domains/Character/Edit.tsx

import { useQuestContext } from '../Context/ContextProvider';
import { useActionService } from '../../services/Actions/ActionServiceProvider';
import { CharacterActions } from './CharacterActions';
import { Character } from './Character';
import { FormWrapper, FormSection, FormField, FormGrid } from '../../components/Form/Form';
import { StatDefinitionsEditor } from '../../components/inputs/StatDefinitionEditor';
import { AttributeEditor } from '../../components/inputs/AttributeEditor';
import { TagEditor } from '../../components/inputs/TagEditor';

interface CharacterEditProps {
  character?: Character;
  onClose: () => void;
}

export function CharacterEdit({ character, onClose }: CharacterEditProps) {
  const context = useQuestContext();
  const { actionService } = useActionService();

  const initialData = character || CharacterActions.createDefault(context);

  const handleSave = (data: Character) => {
    if (!actionService) return;
    
    if (!character) {
      // Create mode
      actionService.execute('character:create', {
        character: data
      });
    } else {
      // Edit mode
      actionService.execute('character:edit', {
        characterId: data.Id,
        updates: data
      });
    }
  };

  return (
    <FormWrapper
      entityId={character?.Id}
      initialData={initialData}
      onSave={handleSave}
      onClose={onClose}
      createTitle="Create Character"
      editTitle="Edit Character"
      viewTitle="View Character"
    >
      <CharacterForm />
    </FormWrapper>
  );
}

// ============================================================================
// CHARACTER FORM (Receives data and onChange from FormWrapper)
// ============================================================================

interface CharacterFormProps {
  data?: Character;
  onChange?: (data: Character) => void;
}

function CharacterForm({ data, onChange }: CharacterFormProps) {
  if (!data || !onChange) return null;

  const handleFieldChange = (field: keyof Character, value: any) => {
    onChange({
      ...data,
      [field]: value
    });
  };

  return (
    <>
      {/* Basic Info */}
      <FormSection 
        title="Basic Information"
        description="Character identity and description"
      >
        <FormGrid cols={2}>
          <FormField label="Name">
            <input
              type="text"
              value={data.Name}
              onChange={(e) => handleFieldChange('Name', e.target.value)}
              className="input input-bordered w-full"
              placeholder="Character Name"
            />
          </FormField>

          <FormField label="Image">
            <div className="text-sm text-base-content/60 italic">
              Image handling not yet implemented
            </div>
          </FormField>

          <FormField label="Description" span={2}>
            <textarea
              value={data.Description || ''}
              onChange={(e) => handleFieldChange('Description', e.target.value)}
              className="textarea textarea-bordered w-full"
              rows={3}
              placeholder="Character description..."
            />
          </FormField>

          <FormField label="Move Speed">
            <input
              type="number"
              value={data.MoveSpeed}
              onChange={(e) => handleFieldChange('MoveSpeed', Number(e.target.value))}
              className="input input-bordered w-full"
              min={0}
            />
          </FormField>
          
          <FormField label="Can Fly">
            <input
              type="checkbox"
              checked={data.CanFly}
              onChange={(e) => handleFieldChange('CanFly', e.target.checked)}
              className="toggle toggle-primary"
            />
          </FormField>
        </FormGrid>
      </FormSection>

      {/* Stats */}
      <FormSection 
        title="Stats"
        description="Character statistics (HP, Mana, etc.)"
      >
        <StatDefinitionsEditor
          stats={data.Stats}
          onChange={(stats) => handleFieldChange('Stats', stats)}
        />
      </FormSection>

      {/* Attributes */}
      <FormSection 
        title="Attributes"
        description="Custom key-value attributes"
      >
        <AttributeEditor
          attributes={data.Attributes}
          onChange={(attributes) => handleFieldChange('Attributes', attributes)}
        />
      </FormSection>

      {/* Tags */}
      <FormSection 
        title="Tags"
        description="Organizational tags for this character"
      >
        <TagEditor
          tags={data.Tags || []}
          onChange={(tags) => handleFieldChange('Tags', tags)}
        />
      </FormSection>
    </>
  );
}