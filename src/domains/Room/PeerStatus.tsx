// domains/Room/PeerStatus.tsx
import { useState, useRef, useEffect } from 'react';
import { PeerInfo } from '../../hooks/usePeerTracking';
import { useQuestContext } from '../Context/ContextProvider';
import { CampaignActions } from '../Campaign/CampaignActions';

interface PeerStatusProps {
  connectionStatus: 'online' | 'connected';
  peers: PeerInfo[];
}

export function PeerStatus({ connectionStatus, peers }: PeerStatusProps) {
  const [isOpen, setIsOpen] = useState(false);
  const context = useQuestContext();
  const windowRef = useRef<HTMLDivElement>(null);
  const badgeRef = useRef<HTMLButtonElement>(null);

  // Get the current campaign
  const campaign = CampaignActions.getActiveCampaign(context);

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (
        windowRef.current &&
        badgeRef.current &&
        !windowRef.current.contains(event.target as Node) &&
        !badgeRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const getBadgeColorClass = () => {
    return connectionStatus === 'online' ? 'badge-warning' : 'badge-success';
  };

  // Helper function to get character name for a peer
  const getCharacterName = (peerId: string): string | null => {
    const peer = peers.find(p => p.peerId === peerId);
    if (!peer) return null;

    // IMPORTANT: Always use RoomCode as the key, since players use RoomCode
    // (their sanitized campaigns have Id = RoomCode)
    const selectedCharId = peer.user.SelectedCharacters[campaign.RoomCode];
    if (!selectedCharId) return null;

    const character = campaign.GameState.Characters.find(c => c.Id === selectedCharId);
    return character ? character.Name : null;
  };

  return (
    <div className="relative">
      <button
        ref={badgeRef}
        onClick={() => setIsOpen(!isOpen)}
        className={`badge badge-lg ${getBadgeColorClass()} gap-2 cursor-pointer hover:opacity-80 transition-opacity`}
        aria-label="Peer connection status"
      >
        {connectionStatus === 'online' ? (
          <span className="icon-[eos-icons--compass] w-5 h-5"></span>
        ) : (
          <>
            <span className="icon-[mdi--access-point-network] w-4 h-4"></span>
            {peers.length}
          </>
        )}
      </button>

      {isOpen && (
        <div
          ref={windowRef}
          className="absolute top-full left-0 mt-2 w-80 bg-base-100 border-2 border-base-300 rounded-lg shadow-xl z-50"
        >
          <div className="p-4">
            <div className="flex justify-between items-center mb-3">
              <h3 className="font-bold text-lg">Connected Peers</h3>
              <span className="text-sm opacity-70">
                {peers.length} {peers.length === 1 ? 'peer' : 'peers'}
              </span>
            </div>

            {peers.length === 0 ? (
              <div className="text-center py-6 opacity-50">
                <p>No peers connected</p>
              </div>
            ) : (
              <div className="space-y-2">
                {peers.map(peer => {
                  const characterName = getCharacterName(peer.peerId);
                  
                  return (
                    <div
                      key={peer.peerId}
                      className="p-3 bg-base-200 rounded-lg"
                    >
                      <div className="flex justify-between items-start mb-2">
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold truncate">{peer.user.Name}</p>
                          <p className="text-xs opacity-60 truncate font-mono">
                            {peer.peerId}
                          </p>
                        </div>
                        <div className="ml-2 text-right">
                          {peer.ping !== null ? (
                            <>
                              <p className="text-sm font-mono font-bold">
                                {peer.ping}ms
                              </p>
                              <p className="text-xs opacity-60">ping</p>
                            </>
                          ) : (
                            <p className="text-xs opacity-60">measuring...</p>
                          )}
                        </div>
                      </div>
                      
                      {/* Character Selection Display */}
                      <div className="mt-2 pt-2 border-t border-base-300">
                        {characterName ? (
                          <div className="flex items-center gap-2">
                            <span className="icon-[mdi--account] w-4 h-4 opacity-60"></span>
                            <span className="text-sm">
                              Playing as: <span className="font-semibold">{characterName}</span>
                            </span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 opacity-50">
                            <span className="icon-[mdi--account-off] w-4 h-4"></span>
                            <span className="text-sm italic">No character selected</span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="mt-3 pt-3 border-t border-base-300">
              <div className="flex items-center gap-2 text-sm">
                <div className={`w-2 h-2 rounded-full ${
                  connectionStatus === 'online' ? 'bg-warning' : 'bg-success'
                }`}></div>
                <span className="opacity-70">
                  Status: <span className="font-semibold capitalize">{connectionStatus}</span>
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}