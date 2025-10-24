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
import { Main } from '../Main/Main';

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
        {!hasSelectedCharacter ? (
          <main className="flex-1 overflow-auto p-6">
            <CharacterSelect peers={peers} />
          </main>
        ) : selectedCharacter ? (
          /* 70/30 Split Layout: Map + Character Sheet */
          <div className="flex-1 flex overflow-hidden">
            {/* Left Side: Map (70%) */}
            <div className="flex-[7] overflow-hidden">
              <Main />
            </div>

            {/* Right Side: Character Sheet Placeholder (30%) */}
            <aside className="flex-[3] border-l-2 overflow-auto p-4 bg-base-100">
              {/* PLACEHOLDER: Character Sheet Component */}
              <div className="space-y-4">
                {/* Character Header */}
                <div className="flex items-center justify-between">
                  <h2 className="text-2xl font-bold">{selectedCharacter.Name}</h2>
                  <label
                    htmlFor="player-character-drawer"
                    className="btn btn-primary btn-sm"
                    onClick={handleOpenEdit}
                  >
                    <span className="icon-[mdi--pencil] w-4 h-4 mr-1" />
                    Edit
                  </label>
                </div>

                {/* Character Image */}
                {selectedCharacter.Image && (
                  <div className="w-full aspect-square bg-base-200 rounded-lg overflow-hidden">
                    <ImageDisplay
                      imageId={selectedCharacter.Image}
                      className="w-full h-full object-cover"
                      alt={selectedCharacter.Name}
                    />
                  </div>
                )}

                {/* Description */}
                {selectedCharacter.Description && (
                  <p className="text-sm opacity-80">{selectedCharacter.Description}</p>
                )}

                {/* Stats */}
                <div>
                  <h3 className="font-semibold mb-2">Stats</h3>
                  <div className="space-y-2">
                    {selectedCharacter.Stats.map(stat => (
                      <div key={stat.Id} className="flex items-center gap-2">
                        <div 
                          className="w-3 h-3 rounded-full flex-shrink-0" 
                          style={{ backgroundColor: stat.Color }}
                        />
                        <div className="flex-1">
                          <div className="text-xs font-semibold">{stat.Name}</div>
                          <div className="text-xs">
                            {stat.Current ?? stat.Max} / {stat.Max}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Tags */}
                {selectedCharacter.Tags && selectedCharacter.Tags.length > 0 && (
                  <div>
                    <h3 className="font-semibold mb-2">Tags</h3>
                    <div className="flex flex-wrap gap-1">
                      {selectedCharacter.Tags.map(tag => (
                        <div key={tag} className="badge badge-outline badge-sm">
                          {tag}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Placeholder sections for future CharacterSheet component */}
                <div className="border-t pt-4 mt-4">
                  <div className="text-center text-sm space-y-2">
                    <p className="font-semibold">Character Sheet Component</p>
                    <p className="text-xs">Inventory, Equipment, Skills, etc. will appear here</p>
                  </div>
                </div>
              </div>
            </aside>
          </div>
        ) : (
          <main className="flex-1 overflow-auto p-6">
            <p className="text-center">
              Character not found
            </p>
          </main>
        )}
        
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