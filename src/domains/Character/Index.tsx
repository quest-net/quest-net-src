// domains/Character/Index.tsx

import { useState } from 'react';
import { useQuestContext } from '../Context/ContextProvider';
import { CampaignActions } from '../Campaign/CampaignActions';
import { CharacterEdit } from './Edit';
import { Character } from './Character';

export function CharacterIndex() {
  const context = useQuestContext();
  const campaign = CampaignActions.getActiveCampaign(context);
  const [selectedCharacter, setSelectedCharacter] = useState<Character | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  const handleOpenEdit = (character: Character) => {
    setIsCreating(false);
    setSelectedCharacter(character);
  };

  const handleOpenCreate = () => {
    setSelectedCharacter(null);
    setIsCreating(true);
  };

  const handleClose = () => {
    setSelectedCharacter(null);
    setIsCreating(false);
    
    // Programmatically close the drawer
    const checkbox = document.getElementById('character-drawer') as HTMLInputElement;
    if (checkbox) {
      checkbox.checked = false;
    }
  };

  return (
    <div className="drawer">
      <input 
        id="character-drawer" 
        type="checkbox" 
        className="drawer-toggle"
        onChange={(e) => {
          // Sync React state when drawer is closed via overlay click
          if (!e.target.checked) {
            setSelectedCharacter(null);
            setIsCreating(false);
          }
        }}
      />
      
      {/* Main Content */}
      <div className="drawer-content">
        <div className="space-y-4">
          {/* Header */}
          <div className="flex justify-between items-center">
            <h2 className="text-2xl font-bold">Characters</h2>
            <label 
              htmlFor="character-drawer"
              className="btn btn-primary"
              onClick={handleOpenCreate}
            >
              + Create Character
            </label>
          </div>

          {/* Empty state */}
          {campaign.CharacterTemplates.length === 0 ? (
            <div className="rounded-lg p-6 bg-base-300">
              <p>No characters yet. Create one to get started!</p>
            </div>
          ) : (
            /* Character cards */
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {campaign.CharacterTemplates.map(character => (
                <label
                  key={character.Id}
                  htmlFor="character-drawer"
                  className="card bg-base-100 border border-base-300 hover:border-primary cursor-pointer transition-colors"
                  onClick={() => handleOpenEdit(character)}
                >
                  <figure className="px-4 pt-4">
                    {/* TODO: Image handling not implemented yet */}
                    <div className="w-full h-32 bg-base-200 rounded-lg flex items-center justify-center">
                      <span className="text-4xl">👤</span>
                    </div>
                  </figure>
                  <div className="card-body">
                    <h3 className="card-title text-center">{character.Name}</h3>
                  </div>
                </label>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Drawer */}
      <div className="drawer-side z-50">
        <label 
          htmlFor="character-drawer"
          aria-label="close sidebar"
          className="drawer-overlay"
        ></label>
        <div className="bg-base-200 min-h-full w-full max-w-4xl p-6 overflow-y-auto">
          {(selectedCharacter || isCreating) && (
            <CharacterEdit
              character={selectedCharacter || undefined}
              onClose={handleClose}
            />
          )}
        </div>
      </div>
    </div>
  );
}