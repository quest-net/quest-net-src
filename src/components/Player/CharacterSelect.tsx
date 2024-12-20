import React, {useState} from 'react';
import { Character } from '../../types/game'
import {ReactComponent as Sphere} from '../ui/sphere.svg'
import BasicObjectView from '../ui/BasicObjectView';

interface CharacterSelectProps {
  party: Character[];
  playerId: string;
  onSelect: (characterId: string) => void;
  onCreateNew: () => void;
}

export function CharacterSelect({ party, playerId, onSelect, onCreateNew }: CharacterSelectProps) {
  const [hoveredCharacter, setHoveredCharacter] = useState<string | null>(null);
  const availableCharacters = party.filter(char => !char.playerId || char.playerId === playerId);

  return (
    <div className="h-full w-full flex items-center justify-center">
      {/* Background SVG wrapper */}
    <div className="fixed inset-0 w-full h-full -z-10 overflow-hidden pointer-events-none">
      <Sphere className=" absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[80vh] h-[80vh] opacity-80 scale-[2] fill-[#333233] dark:fill-[#F2EEE4]" />
    </div>
      <div className="max-w-[75%] px-8">
        <h2 className="text-4xl font-['Mohave'] font-bold text-center">
          Select Your Character
        </h2>
        
        <div className="flex flex-wrap gap-12 justify-center mt-12 mb-48">
          {/* Available Characters */}
          {availableCharacters.map(character => (
            <div
              key={character.id}
              onMouseEnter={() => setHoveredCharacter(character.id)}
              onMouseLeave={() => setHoveredCharacter(null)}
            >
              <BasicObjectView
                name={character.name}
                imageId={character.image}
                size="xl"
                border={hoveredCharacter === character.id ? {
                  width: 4
                } : undefined}
                onClick={() => onSelect(character.id)}
              />
            </div>
          ))}

          {/* Create New Character Option */}
          <BasicObjectView
            name="Create New Character"
            size="xl"
            action={{
              onClick: onCreateNew,
              icon: 'arrow'
            }}
          />
        </div>
      </div>
    </div>
  );
}

export default CharacterSelect;