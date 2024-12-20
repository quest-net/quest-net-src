import React, { useState, useEffect } from 'react';
import { SafeView } from './SafeView';
import { ThreatView } from './ThreatView';
import { CharacterSelect } from './CharacterSelect';
import { Character, PlayerViewProps, Item, GameState, initialGameState } from '../../types/game';
import { useCharacterActions } from '../../actions/characterActions';
import { useImageSync } from '../../hooks/useImageSync';
import { useEnvImageSync } from '../../hooks/useEnvImageSync';
import { useTransferActions } from '../../actions/transferActions';
import { CharacterEditor } from '../shared/CharacterEditor';
import { AudioPlayer } from '../shared/AudioPlayer';
import TransferRequestModal from '../shared/TransferRequestModal';
import { TransferActions, TransferNotificationPayload } from '../../types/transfer';
import LoadingScreen from '../ui/LoadingScreen';
import { Notebook } from './Notebook';

export function PlayerView({ 
  gameState, 
  playerId, 
  onCharacterSelect, 
  room,
  onGameStateChange,
  showInventoryModal,
  showEquipmentModal,
  showSkillsModal,
  onShowInventory,
  onShowEquipment,
  onShowSkills,
  activeTab = 'equipment',
  onTabChange,
  connectionStatus
}: PlayerViewProps) {
  // State
  const [selectedCharacter, setSelectedCharacter] = useState<Character | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  const [editorCharacter, setEditorCharacter] = useState<Character | undefined>();
  const [hasReceivedInitialState, setHasReceivedInitialState] = useState(false);
  const [isLoadingView, setIsLoadingView] = useState(false);
  
  // Transfer-related state
  const [transferRequest, setTransferRequest] = useState<{
    transferId: string;
    fromName: string;
    item: Item;
  } | null>(null);

  // Initialize actions
  const actions = useCharacterActions(room, gameState, onGameStateChange, false);
  const transferActions = useTransferActions(room, gameState, onGameStateChange, false);

  // Add image syncing
  useEnvImageSync(room, gameState);
  useImageSync(room, false, gameState);

  // Check for initial game state load
  useEffect(() => {
    if (gameState.party.length > 0 || gameState.globalCollections.items.length > 0) {
      setHasReceivedInitialState(true);
    }
  }, [gameState]);

  // Setup transfer notification listener
  useEffect(() => {
    if (!room) return;

    const [_, getTransferNotification] = room.makeAction<TransferNotificationPayload>(
      TransferActions.NOTIFY
    );

    getTransferNotification(({ transferId, fromId, item }) => {
      console.log('Received transfer notification:', transferId);
      
      // Find sender's character name
      const fromCharacter = gameState.party.find(c => c.id === fromId);
      if (!fromCharacter) return;

      setTransferRequest({
        transferId,
        fromName: fromCharacter.name,
        item
      });
    });
  }, [room, gameState]);

  // Update selected character when gameState or playerId changes
  useEffect(() => {
    const character = gameState.party.find(c => c.playerId === playerId);
    setSelectedCharacter(character || null);
    if (character) {
      // Add a small delay before removing loading screen
      setTimeout(() => setIsLoadingView(false), 500);
    }
  }, [gameState, playerId]);

  // Character handlers
  const handleCharacterSelection = async (characterId: string) => {
    setIsLoadingView(true);
    await actions.selectCharacter(characterId);
    onCharacterSelect(characterId);
  };

  const handleCreateCharacter = async (character: Omit<Character, 'id'>) => {
    await actions.createCharacter(character);
    setShowEditor(false);
  };

  const handleUpdateCharacter = async (id: string, updates: Partial<Character>) => {
    await actions.updateCharacter(id, updates);
    setShowEditor(false);
  };

  // Transfer handlers
  const handleTransferAccept = async () => {
    if (!transferRequest || !transferActions) return;
    await transferActions.respondToTransfer(transferRequest.transferId, true);
    setTransferRequest(null);
  };

  const handleTransferReject = async () => {
    if (!transferRequest || !transferActions) return;
    await transferActions.respondToTransfer(transferRequest.transferId, false);
    setTransferRequest(null);
  };

  if (connectionStatus !== 'connected')
  {
    return <LoadingScreen message="Connecting to Quest-Net..." />;
  }

  if (!hasReceivedInitialState) {
    return <LoadingScreen message="Packing up bags..." />;
  }
  
  // Character selection screen render
  if (!selectedCharacter) {
    return (
      <>
        <div className="h-full flex flex-col items-center justify-center p-4">
          <div className="w-full">
            <CharacterSelect
              party={gameState.party}
              playerId={playerId}
              onSelect={handleCharacterSelection}
              onCreateNew={() => {
                setEditorCharacter(undefined);
                setShowEditor(true);
              }}
            />
          </div>
        </div>

        {showEditor && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-offwhite dark:bg-grey rounded-lg p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-bold">
                  {editorCharacter ? 'Edit Character' : 'Create Character'}
                </h3>
              </div>
              
              <CharacterEditor
                character={editorCharacter}
                onSave={handleCreateCharacter}
                onUpdate={handleUpdateCharacter}
                onClose={() => {
                  setShowEditor(false);
                  setEditorCharacter(undefined);
                }}
                isRoomCreator={false}
              />
            </div>
          </div>
        )}

        {transferRequest && (
          <TransferRequestModal
            isOpen={!!transferRequest}
            onClose={() => setTransferRequest(null)}
            item={transferRequest.item}
            senderName={transferRequest.fromName}
            onAccept={handleTransferAccept}
            onReject={handleTransferReject}
          />
        )}
      </>
    );
  }

  // Show loading screen while view is preparing
  if (isLoadingView) {
    return <LoadingScreen message="Ah, you're finally awake..." />;
  }

  // Props for the game views
  const viewProps = {
    gameState,
    onGameStateChange,
    playerId,
    onCharacterSelect,
    room,
    selectedCharacter,
    showEditor,
    setShowEditor,
    editorCharacter,
    setEditorCharacter,
    showInventoryModal,
    showEquipmentModal,
    showSkillsModal,
    onShowInventory,
    onShowEquipment,
    onShowSkills,
    activeTab,
    onTabChange
  };

  // Determine which view to show based on field entities
  const hasFieldEntities = gameState.field.length > 0;
  
  return (
    <>
      <AudioPlayer gameState={gameState} isDM={false} />
      {hasFieldEntities ? (
        <ThreatView {...viewProps} />
      ) : (
        <SafeView {...viewProps} />
      )}

      {selectedCharacter && <Notebook characterName={selectedCharacter.name} />}

      {transferRequest && (
        <TransferRequestModal
          isOpen={!!transferRequest}
          onClose={() => setTransferRequest(null)}
          item={transferRequest.item}
          senderName={transferRequest.fromName}
          onAccept={handleTransferAccept}
          onReject={handleTransferReject}
        />
      )}
    </>
  );
}