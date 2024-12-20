import type { Item } from './game';

export interface TransferIntent {
  id: string;           
  itemId: string;       
  fromId: string;       // ID of character giving item 
  toId: string;         // ID of recipient (character or entity)
  toType: 'character' | 'fieldEntity';  // Distinguish between recipient types
  inventorySlotIndex: number;
  requiresConfirmation: boolean;  // false if recipient has no playerId or is field entity
  timestamp: number;    
}

export interface TransferRequestPayload {
  transferId: string;   
  itemId: string;
  fromId: string;      
  toId: string;
  toType: 'character' | 'fieldEntity';
  playerId: string;    // ID of player initiating transfer
}

export interface TransferResponsePayload {
  transferId: string;
  accepted: boolean;
  playerId: string;    // ID of player responding to transfer
}

export interface TransferNotificationPayload {
  transferId: string;
  itemId: string;
  fromId: string;      // Character ID of sender
  fromPlayerId: string;  // Player ID of sender
  item: Item;           // The actual item being transferred
}

// These must be 12 bytes or less for Trystero
export const TransferActions = {
  REQUEST: 'transferReq',
  RESPONSE: 'transferRes',
  CANCEL: 'transferCncl',
  NOTIFY: 'transferNtf'
} as const;