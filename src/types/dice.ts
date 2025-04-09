// src/types/dice.ts

import type { Room } from './room';

export interface DiceRollResult {
  characterName: string;  // Name of character who rolled
  result: number;        // The result of the roll
  maxValue: number;      // Maximum possible value (e.g., 20 for d20)
  timestamp: number;     // When the roll occurred
}

// Action name for peer communication
// Must be 12 bytes or less for Trystero
export const DiceActions = {
  ROLL_RESULT: 'diceResult'
} as const;

export const broadcastRollResult = (
  room: Room | undefined, 
  characterName: string, 
  result: number, 
  maxValue: number
) => {
  if (!room || !characterName) return;

  const [sendRollResult] = room.makeAction<DiceRollResult>(DiceActions.ROLL_RESULT);
  
  const rollResult: DiceRollResult = {
    characterName,
    result,
    maxValue,
    timestamp: Date.now()
  };

  sendRollResult(rollResult);
};