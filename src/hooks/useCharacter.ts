// hooks/useCharacter.ts
import { useCallback } from 'react';
import { Character, GameState } from '../types/game';
interface UseCharacterActions {
 updateHp: (characterId: string, newHp: number) => void;
 assignCharacter: (characterId: string, playerId: string | undefined) => void;
 getCharacterById: (characterId: string) => Character | undefined;
 getCharacterByPlayerId: (playerId: string) => Character | undefined;
}

export function useCharacter(
 gameState: GameState,
 onGameStateChange: (newState: GameState) => void
): UseCharacterActions {
 const updateHp = useCallback((characterId: string, newHp: number) => {
   onGameStateChange({
     ...gameState,
     party: gameState.party.map(char =>
       char.id === characterId 
         ? { ...char, hp: Math.min(Math.max(0, newHp), char.maxHp) }
         : char
     )
   });
 }, [gameState, onGameStateChange]);

 const assignCharacter = useCallback((characterId: string, playerId: string | undefined) => {
   onGameStateChange({
     ...gameState,
     party: gameState.party.map(char =>
       char.id === characterId ? { ...char, playerId } : char
     )
   });
 }, [gameState, onGameStateChange]);

 const getCharacterById = useCallback((characterId: string) => {
   return gameState.party.find(char => char.id === characterId);
 }, [gameState]);

 const getCharacterByPlayerId = useCallback((playerId: string) => {
   return gameState.party.find(char => char.playerId === playerId);
 }, [gameState]);

 return {
   updateHp,
   assignCharacter,
   getCharacterById,
   getCharacterByPlayerId
 };
}