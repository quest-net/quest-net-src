import { Room } from 'trystero/nostr';
import { GameState } from '../types/game';
import { TransferIntent, TransferRequestPayload, TransferResponsePayload, TransferActions } from '../types/transfer';
import { selfId } from 'trystero';


export function setupTransferActions(
  room: Room,
  gameState: GameState,
  onGameStateChange: (newState: GameState) => void,
  isRoomCreator: boolean
) {
  // Set up action senders
  const [sendTransferRequest] = room.makeAction<TransferRequestPayload>(TransferActions.REQUEST);
  const [sendTransferResponse] = room.makeAction<TransferResponsePayload>(TransferActions.RESPONSE);
  const [sendTransferCancel] = room.makeAction<{ transferId: string }>(TransferActions.CANCEL);

  // DM-only actions
  const dmActions = isRoomCreator ? {
    // Process transfer immediately (for offline recipients)
    executeTransferDirect: (transfer: TransferIntent) => {
      const newState = { ...gameState };
      const fromCharacter = newState.party.find(c => c.id === transfer.fromId);
      
      if (!fromCharacter) return false;

      const itemSlot = fromCharacter.inventory[transfer.inventorySlotIndex];
      if (!itemSlot) return false;

      // Remove item from sender
      fromCharacter.inventory = fromCharacter.inventory.filter((_, index) => 
        index !== transfer.inventorySlotIndex
      );

      // Add item to recipient
      if (transfer.toType === 'character') {
        const toCharacter = newState.party.find(c => c.id === transfer.toId);
        if (!toCharacter) return false;
        toCharacter.inventory.push(itemSlot);
      } else {
        const toEntity = newState.field.find(e => e.instanceId === transfer.toId);
        if (!toEntity) return false;
        toEntity.inventory.push(itemSlot);
      }

      onGameStateChange(newState);
      return true;
    },
  } : undefined;

  // Actions available to players
  return {
    ...dmActions,

    // Initiate transfer request
    requestTransfer: (
      itemId: string, 
      fromId: string,
      toId: string,
      toType: 'character' | 'fieldEntity',
      inventorySlotIndex: number
    ) => {
      const transferId = crypto.randomUUID();
      return sendTransferRequest({
        transferId,
        itemId,
        fromId,
        toId,
        toType,
        playerId: selfId
      });
    },

    // Respond to transfer request
    respondToTransfer: (transferId: string, accepted: boolean) => {
      return sendTransferResponse({
        transferId,
        accepted,
        playerId: selfId
      });
    },

    // Cancel pending transfer
    cancelTransfer: (transferId: string) => {
      return sendTransferCancel({ transferId });
    }
  };
}

export function useTransferActions(
  room: Room | undefined,
  gameState: GameState,
  onGameStateChange: (newState: GameState) => void,
  isRoomCreator: boolean
) {
  if (!room) {
    return {
      requestTransfer: () => Promise.resolve(),
      respondToTransfer: () => Promise.resolve(),
      cancelTransfer: () => Promise.resolve()
    };
  }

  return setupTransferActions(room, gameState, onGameStateChange, isRoomCreator);
}