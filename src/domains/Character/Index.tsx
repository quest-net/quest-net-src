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
  const [showCreateModal, setShowCreateModal] = useState(false);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">
          Characters
        </h2>
        <button 
          className="btn btn-primary"
          onClick={() => setShowCreateModal(true)}
        >
          + Create Character
        </button>
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
            <div 
              key={character.Id}
              className="card bg-base-100 border border-base-300 hover:border-primary cursor-pointer transition-colors"
              onClick={() => setSelectedCharacter(character)}
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
            </div>
          ))}
        </div>
      )}

      {/* Edit modal */}
      {selectedCharacter && (
        <dialog className="modal modal-open">
          <div className="modal-box max-w-3xl">
            <CharacterEdit
              character={selectedCharacter}
              mode="edit"
              onClose={() => setSelectedCharacter(null)}
            />
          </div>
          <form method="dialog" className="modal-backdrop">
            <button onClick={() => setSelectedCharacter(null)}>close</button>
          </form>
        </dialog>
      )}

      {/* Create modal */}
      {showCreateModal && (
        <dialog className="modal modal-open">
          <div className="modal-box max-w-3xl">
            <CharacterEdit
              mode="create"
              onClose={() => setShowCreateModal(false)}
            />
          </div>
          <form method="dialog" className="modal-backdrop">
            <button onClick={() => setShowCreateModal(false)}>close</button>
          </form>
        </dialog>
      )}
    </div>
  );
}