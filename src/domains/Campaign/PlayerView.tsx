// domains/Campaign/PlayerView.tsx

import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuestContext, triggerContextUpdate } from '../Context/ContextProvider';
import { CampaignActions } from './CampaignActions';
import { UserActions } from '../User/UserActions';
import { LogDisplay } from '../Log/LogDisplay';
import { PeerStatus } from '../Room/PeerStatus';
import { CharacterSelect } from '../Character/CharacterSelect';
import { CharacterEdit } from '../Character/Edit';
import { ImageDisplay } from '../Image/ImageDisplay';
import { usePeerTracking } from '../../hooks/usePeerTracking';

export function PlayerView() {
  const { identifier } = useParams<{ identifier: string }>();
  const context = useQuestContext();
  const navigate = useNavigate();
  const [isEditingCharacter, setIsEditingCharacter] = useState(false);
  
  // Single source of truth for peer data - call hook once at view level
  const { peers, connectionStatus } = usePeerTracking();
  
  const campaign = CampaignActions.findCampaignByIdentifier(identifier!, context);

  if (!campaign) {
    return null;
  }

  // Check if user has selected a character for this campaign
  // Use RoomCode as the key for consistency (players use RoomCode in their sanitized campaigns)
  const selectedCharacterId = context.User.SelectedCharacters[campaign.RoomCode];
  const hasSelectedCharacter = !!selectedCharacterId;

  // Find the selected character to display info
  const selectedCharacter = hasSelectedCharacter
    ? campaign.GameState.Characters.find(c => c.Id === selectedCharacterId)
    : null;

  const handleChangeCharacter = () => {
    UserActions.selectCharacter({
      campaignId: campaign.RoomCode, // Use RoomCode for consistency
      characterId: null
    }, context);
    triggerContextUpdate();
  };

  const handleOpenEdit = () => {
    setIsEditingCharacter(true);
  };

  const handleCloseEdit = () => {
    setIsEditingCharacter(false);
    
    // Programmatically close the drawer
    const checkbox = document.getElementById('player-character-drawer') as HTMLInputElement;
    if (checkbox) {
      checkbox.checked = false;
    }
  };

  return (
    <div className="drawer">
      <input 
        id="player-character-drawer" 
        type="checkbox" 
        className="drawer-toggle"
        onChange={(e) => {
          // Sync React state when drawer is closed via overlay click
          if (!e.target.checked) {
            setIsEditingCharacter(false);
          }
        }}
      />

      <div className="drawer-content flex flex-col h-screen">
        {/* Header - Always Visible */}
        <header className="navbar border-b-2 px-6 justify-between">
          <div className="flex items-center gap-4">
            <PeerStatus connectionStatus={connectionStatus} peers={peers} />
          </div>
          <h1 className="text-xl font-bold">{campaign.Name}</h1>
          <div className="flex items-center gap-2">
            {selectedCharacter && (
              <div className="badge badge-primary badge-lg">
                Playing as: {selectedCharacter.Name}
              </div>
            )}
            {hasSelectedCharacter && (
              <button
                className="btn btn-neutral btn-sm"
                onClick={handleChangeCharacter}
                title="Change character"
              >
                <span className="icon-[mdi--account-switch] w-5 h-5" />
              </button>
            )}
            <button
              className="btn btn-neutral"
              onClick={() => navigate('/campaigns')}
            >
              Leave Campaign
            </button>
          </div>
        </header>

        {/* Main Content - Conditional */}
        <main className="flex-1 overflow-auto p-6">
          {!hasSelectedCharacter ? (
            <CharacterSelect peers={peers} />
          ) : selectedCharacter ? (
            /* Character Display */
            <div className="max-w-2xl mx-auto">
              <div className="card bg-base-100 border-2 border-base-300">
                {/* Character Image */}
                <figure className="px-6 pt-6">
                  <div className="w-full max-w-md aspect-square bg-base-200 rounded-lg overflow-hidden flex items-center justify-center">
                    {selectedCharacter.Image ? (
                      <ImageDisplay
                        imageId={selectedCharacter.Image}
                        className="w-full h-full object-cover"
                        alt={selectedCharacter.Name}
                      />
                    ) : (
                      <span className="text-9xl opacity-30">👤</span>
                    )}
                  </div>
                </figure>

                {/* Character Info */}
                <div className="card-body">
                  <div className="flex justify-between items-start">
                    <h2 className="card-title text-3xl">
                      {selectedCharacter.Name}
                    </h2>
                    <label
                      htmlFor="player-character-drawer"
                      className="btn btn-primary btn-sm"
                      onClick={handleOpenEdit}
                    >
                      <span className="icon-[mdi--pencil] w-4 h-4 mr-1" />
                      Edit
                    </label>
                  </div>
                  
                  {selectedCharacter.Description && (
                    <p className="text-base-content/80 mt-2">
                      {selectedCharacter.Description}
                    </p>
                  )}

                  {/* Stats */}
                  <div className="divider">Stats</div>
                  <div className="grid grid-cols-2 gap-3">
                    {selectedCharacter.Stats.map(stat => (
                      <div key={stat.Id} className="flex items-center gap-3">
                        <div 
                          className="w-4 h-4 rounded-full flex-shrink-0" 
                          style={{ backgroundColor: stat.Color }}
                        />
                        <div className="flex-1">
                          <div className="text-sm font-semibold">{stat.Name}</div>
                          <div className="text-xs opacity-70">
                            {stat.Current ?? stat.Max} / {stat.Max}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Tags */}
                  {selectedCharacter.Tags && selectedCharacter.Tags.length > 0 && (
                    <>
                      <div className="divider">Tags</div>
                      <div className="flex flex-wrap gap-2">
                        {selectedCharacter.Tags.map(tag => (
                          <div key={tag} className="badge badge-outline">
                            {tag}
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <p className="text-center text-base-content opacity-50">
              Character not found
            </p>
          )}
        </main>
        
        {/* Log Display */}
        <LogDisplay />
      </div>

      {/* Edit Drawer */}
      <div className="drawer-side z-50">
        <label 
          htmlFor="player-character-drawer"
          aria-label="close sidebar"
          className="drawer-overlay"
        ></label>
        <div className="bg-base-200 min-h-full w-full max-w-4xl p-6 overflow-y-auto">
          {isEditingCharacter && selectedCharacter && (
            <CharacterEdit
              character={selectedCharacter}
              onClose={handleCloseEdit}
            />
          )}
        </div>
      </div>
    </div>
  );
}