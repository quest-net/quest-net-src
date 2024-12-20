// hooks/useGameState.ts
import { useState, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { GameState, SerializableCharacter, Character, initialGameState } from '../types/game';


export function useGameState(initialState: GameState = initialGameState) {
  const [gameState, setGameState] = useState<GameState>(initialState);

  const addCharacter = useCallback((character: Omit<SerializableCharacter, 'id'>) => {
    const newCharacter: SerializableCharacter = {
      ...character,
      id: uuidv4()
    };

    setGameState(current => ({
      ...current,
      party: [...current.party, newCharacter]
    }));
  }, []);

  const updateCharacter = useCallback((id: string, updates: Partial<Character>) => {
    setGameState(current => ({
      ...current,
      party: current.party.map(char =>
        char.id === id ? { ...char, ...updates } : char
      )
    }));
  }, []);

  const assignCharacter = useCallback((characterId: string, playerId: string) => {
    setGameState(current => ({
      ...current,
      party: current.party.map(char =>
        char.id === characterId ? { ...char, playerId } : char
      )
    }));
  }, []);

  return {
    gameState,
    setGameState,
    addCharacter,
    updateCharacter,
    assignCharacter
  };
}