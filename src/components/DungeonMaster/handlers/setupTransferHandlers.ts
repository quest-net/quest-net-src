import type { Room } from 'trystero/nostr';
import type { GameState } from '../../../types/game';
import type { 
  TransferRequestPayload, 
  TransferResponsePayload, 
  TransferIntent,
  TransferNotificationPayload 
} from '../../../types/transfer';
import { TransferActions } from '../../../types/transfer';

export function setupTransferHandlers(
  room: Room,
  gameState: GameState,
  onGameStateChange: (newState: GameState) => void
) {
  // Keep track of pending transfers
  const pendingTransfers = new Map<string, TransferIntent>();

  // Set up notification sender
  const [sendTransferNotify] = room.makeAction<TransferNotificationPayload>(TransferActions.NOTIFY);

  // Handle initial transfer requests
  const [_, getTransferRequest] = room.makeAction<TransferRequestPayload>(TransferActions.REQUEST);
  getTransferRequest(({ transferId, itemId, fromId, toId, toType, playerId }) => {
    console.log(`DM received transfer request:`, { transferId, fromId, toId });

    // Verify source character exists and has the item
    const fromCharacter = gameState.party.find(c => c.id === fromId);
    if (!fromCharacter) {
      console.error('Source character not found:', fromId);
      return;
    }

    const itemSlotIndex = fromCharacter.inventory.findIndex(([item]) => item.id === itemId);
    if (itemSlotIndex === -1) {
      console.error('Item not found in inventory:', itemId);
      return;
    }

    const [item] = fromCharacter.inventory[itemSlotIndex];

    // Find recipient and determine if confirmation is needed
    let requiresConfirmation = false;
    let recipientPlayerId: string | undefined;

    if (toType === 'character') {
      const toCharacter = gameState.party.find(c => c.id === toId);
      if (!toCharacter) {
        console.error('Recipient character not found:', toId);
        return;
      }
      requiresConfirmation = !!toCharacter.playerId;
      recipientPlayerId = toCharacter.playerId;

      // If requires confirmation, notify the recipient player
      if (requiresConfirmation && recipientPlayerId) {
        console.log(`DM sending transfer notification to player:`, recipientPlayerId);
        sendTransferNotify({
          transferId,
          itemId,
          fromId,
          fromPlayerId: playerId,
          item
        }, recipientPlayerId); // Send only to recipient player
      }
    } else {
      const toEntity = gameState.field.find(e => e.id === toId);
      if (!toEntity) {
        console.error('Recipient entity not found:', toId);
        return;
      }
    }

    // Record the transfer intent
    const transferIntent: TransferIntent = {
      id: transferId,
      itemId,
      fromId,
      toId,
      toType,
      inventorySlotIndex: itemSlotIndex,
      requiresConfirmation,
      timestamp: Date.now()
    };

    pendingTransfers.set(transferId, transferIntent);

    // If no confirmation needed, execute transfer immediately
    if (!requiresConfirmation) {
      executeTransfer(transferIntent);
      pendingTransfers.delete(transferId);
    }
  });

  // Handle transfer responses
  const [__, getTransferResponse] = room.makeAction<TransferResponsePayload>(TransferActions.RESPONSE);
  getTransferResponse(({ transferId, accepted, playerId }) => {
    console.log(`DM received transfer response:`, { transferId, accepted });

    const transfer = pendingTransfers.get(transferId);
    if (!transfer) {
      console.error('Transfer not found:', transferId);
      return;
    }

    // Find original requester to notify them of the response
    const fromCharacter = gameState.party.find(c => c.id === transfer.fromId);
    if (fromCharacter?.playerId) {
      // We could add a new action type for this if needed
      // sendTransferComplete({ transferId, accepted }, fromCharacter.playerId);
    }

    if (accepted) {
      executeTransfer(transfer);
    }

    pendingTransfers.delete(transferId);
  });

  // Handle transfer cancellations
  const [___, getTransferCancel] = room.makeAction<{ transferId: string }>(TransferActions.CANCEL);
  getTransferCancel(({ transferId }) => {
    console.log(`DM received transfer cancellation:`, transferId);
    
    const transfer = pendingTransfers.get(transferId);
    if (transfer && transfer.requiresConfirmation) {
      // Find recipient to notify them of cancellation
      if (transfer.toType === 'character') {
        const toCharacter = gameState.party.find(c => c.id === transfer.toId);
        if (toCharacter?.playerId) {
          // We could add a new action type for this
          // sendTransferCancelled({ transferId }, toCharacter.playerId);
        }
      }
    }
    
    pendingTransfers.delete(transferId);
  });

  // Helper function to execute transfers
  function executeTransfer(transfer: TransferIntent) {
    const newState = { ...gameState };
    
    // Get source character
    const fromCharacter = newState.party.find(c => c.id === transfer.fromId);
    if (!fromCharacter) return;

    // Get the item being transferred
    const itemSlot = fromCharacter.inventory[transfer.inventorySlotIndex];
    if (!itemSlot) return;

    // Remove item from source
    fromCharacter.inventory = fromCharacter.inventory.filter((_, index) => 
      index !== transfer.inventorySlotIndex
    );

    // Add item to recipient
    if (transfer.toType === 'character') {
      const toCharacter = newState.party.find(c => c.id === transfer.toId);
      if (!toCharacter) return;
      toCharacter.inventory.push(itemSlot);
    } else {
      const toEntity = newState.field.find(e => e.id === transfer.toId);
      if (!toEntity) return;
      toEntity.inventory.push(itemSlot);
    }

    onGameStateChange(newState);
  }
}