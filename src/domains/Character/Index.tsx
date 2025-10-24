// domains/Character/Index.tsx

import { useState } from 'react';
import { useQuestContext } from '../Context/ContextProvider';
import { useActionService } from '../../services/Actions/ActionServiceProvider';
import { CampaignActions } from '../Campaign/CampaignActions';
import { CharacterEdit } from './Edit';
import { Character } from './Character';
import { ImageDisplay } from '../Image/ImageDisplay';

export function CharacterIndex() {
  const context = useQuestContext();
  const { actionService } = useActionService();
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

  const handleSpawn = (characterId: string, e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent opening the edit drawer
    
    if (!actionService) return;
    
    actionService.execute('character:spawn', {
      characterId: characterId,  // Changed from templateId - we're moving an existing character
      position: { x: 0, y: 0 }
    });
  };

  /**
   * Checks if a character is currently active (spawned in GameState)
   * With the new MOVE architecture, characters are either in Roster OR GameState
   */
  const isCharacterActive = (characterId: string) => {
    return campaign.GameState.Characters.some(c => c.Id === characterId);
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
        <div className="space-y-4 p-6">
          {/* Header */}
          <div className="flex justify-between items-center">
            <div>
              <h2 className="text-2xl font-bold">Character Roster</h2>
              <p className="text-base-content/60">Manage your character roster</p>
            </div>
            <label 
              htmlFor="character-drawer"
              className="btn btn-primary"
              onClick={handleOpenCreate}
            >
              <span className="icon-[mdi--plus] w-5 h-5 mr-1" />
              Create Character
            </label>
          </div>

          {/* Empty state */}
          {campaign.CharacterRoster.length === 0 ? (
            <div className="rounded-lg p-6 bg-base-300">
              <p>No characters yet. Create one to get started!</p>
            </div>
          ) : (
            /* Character cards */
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {campaign.CharacterRoster.map(character => {
                const isActive = isCharacterActive(character.Id);
                
                return (
                  <div
                    key={character.Id}
                    className={`card bg-base-100 border-2 transition-colors ${
                      isActive ? 'border-success' : 'border-base-300 hover:border-primary'
                    }`}
                  >
                    <label
                      htmlFor="character-drawer"
                      className="cursor-pointer"
                      onClick={() => handleOpenEdit(character)}
                    >
                      <figure className="px-4 pt-4">
                        <div className="w-full h-32 bg-base-200 rounded-lg overflow-hidden flex items-center justify-center">
                          {character.Image ? (
                            <ImageDisplay
                              imageId={character.Image}
                              className="w-full h-full object-cover"
                              alt={character.Name}
                            />
                          ) : (
                            <span className="text-4xl opacity-30">👤</span>
                          )}
                        </div>
                      </figure>
                      <div className="card-body">
                        <h3 className="card-title text-center justify-center">
                          {character.Name}
                        </h3>
                        {isActive && (
                          <div className="badge badge-success badge-sm w-full">
                            Active
                          </div>
                        )}
                      </div>
                    </label>
                    
                    {/* Action buttons */}
                    <div className="card-actions justify-end p-4 pt-0">
                      {!isActive ? (
                        <button
                          onClick={(e) => handleSpawn(character.Id, e)}
                          className="btn btn-sm btn-primary w-full"
                          title="Spawn character into the game"
                        >
                          <span className="icon-[mdi--play] w-4 h-4 mr-1" />
                          Spawn
                        </button>
                      ) : (
                        <button
                          className="btn btn-sm btn-ghost w-full"
                          disabled
                          title="Character is already active"
                        >
                          <span className="icon-[mdi--check-circle] w-4 h-4 mr-1" />
                          Spawned
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
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