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
        <div className="flex overflow-x-auto gap-8 snap-x mx-auto">
          {characters.map(character => (
            <div 
              key={character.id}
              className="flex-none snap-start"
            >
              <div className="w-48 flex flex-col">
                <div className="flex-none">
                <BasicObjectView
                    name={character.name}
                    imageId={character.image}
                    size="md" // Default size for smaller screens
                    className="3xl:hidden" // Hide on 1440p and up
                  />
                  <BasicObjectView
                    name={character.name}
                    imageId={character.image}
                    size="lg" // Larger size for 1440p
                    className="hidden 3xl:block" // Show only on 1440p and up
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
                    size="md" // Default size for smaller screens
                    className="3xl:hidden" // Hide on 1440p and up
                  />
                  <BasicObjectView
                    name={character.name}
                    imageId={character.image}
                    size="lg" // Larger size for 1440p
                    className="hidden 3xl:block" // Show only on 1440p and up
                  />
          </div>
          <div className="flex-1">
            <StatGauges
              character={character}
              gameState={gameState}
              onGameStateChange={onGameStateChange}
              editable={false}
              size="medium"
              showSideLabels={true}
            />
          </div>
        </div>
      ))}
    </div>
  );
};

export default PartyList;