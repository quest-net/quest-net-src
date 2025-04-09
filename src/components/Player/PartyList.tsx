import React from 'react';
import BasicObjectView from '../ui/BasicObjectView';
import StatGauges from './StatGauges';
import { Character } from '../../types/game';

interface PartyListProps {
  characters: Character[];
  gameState: any;
  onGameStateChange: (newState: any) => void;
  layout?: 'horizontal' | 'vertical';
}

const PartyList = ({ 
  characters,
  gameState,
  onGameStateChange,
  layout = 'horizontal'
}: PartyListProps) => {
  if (!characters.length) {
    return (
      <div className="w-full h-full flex items-center justify-center text-gray-500">
        No party members
      </div>
    );
  }

  if (layout === 'horizontal') {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <div className="flex h-full overflow-x-auto gap-4 2xl:gap-8 snap-x mx-auto">
          {characters.map(character => (
            <div 
              key={character.id}
              className="flex-none mt-6 2xl:mt-6 3xl:mt-12"
            >
              <div className="w-48 flex flex-col">
                <div className="flex-none">
                <BasicObjectView
                name={character.name}
                imageId={character.image}
                size="size=sm 2xl:size=md 3xl:size=lg" // Default size for smaller screens
              />
                </div>
                <div className="flex-none">
                  <StatGauges
                    character={character}
                    gameState={gameState}
                    onGameStateChange={onGameStateChange}
                    editable={false}
                    size="small"
                    showSideLabels={false}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="w-full space-y-4 items-center justify-center">
      {characters.map(character => (
        <div 
          key={character.id}
          className="flex items-center gap-2 "
        >
          <div className="flex-none">
            <BasicObjectView
              name={character.name}
              imageId={character.image}
              size="size=sm 2xl:size=md 3xl:size=lg"
              />
          </div>
          <div className="flex-1 hidden xl:hidden 2xl:block">
            <StatGauges
              character={character}
              gameState={gameState}
              onGameStateChange={onGameStateChange}
              editable={false}
              size="medium"
              showSideLabels={true}
            />
          </div>
          <div className="flex-1 hidden xl:block 2xl:hidden">
            <StatGauges
              character={character}
              gameState={gameState}
              onGameStateChange={onGameStateChange}
              editable={false}
              size="small"
              showSideLabels={true}
            />
          </div>
          
        </div>
      ))}
    </div>
  );
};

export default PartyList;