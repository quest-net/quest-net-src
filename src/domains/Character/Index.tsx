// domains/Character/Index.tsx

import { useQuestContext } from '../Context/ContextProvider';
import { useActionService } from '../../services/Actions/ActionServiceProvider';
import { CampaignActions } from '../Campaign/CampaignActions';
import { CharacterEdit } from './Edit';
import { IndexView, IndexViewItem } from '../../components/IndexView/IndexView';
import { useState } from 'react';
import { replacePathTag } from '../../utils/FolderUtils';

export function CharacterIndex() {
  const context = useQuestContext();
  const { actionService } = useActionService();
  const campaign = CampaignActions.getActiveCampaign(context);
  
  // Add a counter to force new keys on each create
  const [createCounter, setCreateCounter] = useState(0);

  const handleSpawn = (characterId: string) => {
    if (!actionService) return;
    
    actionService.execute('character:spawn', {
      characterId: characterId,
      position: { x: 0, y: 0 }
    });
  };

  const handleBulkUpdateItemTags = (updates: Array<{ itemId: string; newTags: string[] }>) => {
    if (!actionService) return;
    
    actionService.execute('character:bulkEditTags', {
      updates: updates.map(update => ({
        characterId: update.itemId,
        tags: update.newTags
      }))
    });
  };

  const items: IndexViewItem[] = campaign.CharacterRoster.map(character => ({
    id: character.Id,
    label: character.Name,
    details: character.Description,
    imageId: character.Image,
    tags: character.Tags || [],
    action: {
      label: 'Spawn',
      icon: 'icon-[mdi--play]',
      onClick: () => handleSpawn(character.Id)
    }
  }));

  return (
    <IndexView
      items={items}
      title="Character Roster"
      description="Manage your character roster"
      createLabel="Create Character"
      onCreateClick={() => setCreateCounter(prev => prev + 1)}
      searchEnabled={true}
      searchPlaceholder="Search characters by name..."
      emptyMessage="No characters yet. Create one to get started!"
      onBulkUpdateItemTags={handleBulkUpdateItemTags}
      renderEditForm={(item, folderContext) => {
        const character = item 
          ? campaign.CharacterRoster.find(c => c.Id === item.id)
          : undefined;

        // Build initial tags from current path
        const initialTags = folderContext.currentPath.length > 0
          ? replacePathTag([], folderContext.currentPath)
          : undefined;

        return (
          <CharacterEdit
            key={item?.id || `create-${createCounter}`}
            character={character}
            initialTags={initialTags}
            onClose={() => {
              const checkbox = document.getElementById('indexview-drawer') as HTMLInputElement;
              if (checkbox) checkbox.checked = false;
            }}
          />
        );
      }}
    />
  );
}