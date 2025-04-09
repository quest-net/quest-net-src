import React, { useEffect, useState } from 'react';
import type { Room } from 'trystero/nostr';
import { Character, GameState } from '../../types/game';
import StatGauges from '../Player/StatGauges';
import { imageManager } from '../../services/ImageManager';
import { InventoryPanel } from '../Player/InventoryPanel';
import { SkillsPanel } from '../Player/SkillsPanel';
import { EquipmentPanel } from '../Player/EquipmentPanel';
import {ReactComponent as Sword} from '../ui/sword.svg';
import {ReactComponent as Bag} from '../ui/bag.svg';
import {ReactComponent as Star} from '../ui/star.svg';
import {ReactComponent as Gear} from '../ui/gear.svg';
import type { SVGProps } from 'react';

interface TabButtonProps {
  icon: React.ReactElement<SVGProps<SVGSVGElement>> | React.ReactNode;
  title: string;
  onClick?: () => void;
  upsideDown?: boolean;
}

function TabButton({ icon, title, onClick, upsideDown = false }: TabButtonProps) {
  return (
    <button 
      className="relative aspect-[4/3] min-w-[150px] w-full max-w-[200px] group"
      title={title}
      onClick={onClick}
    >
      <div className="absolute inset-0 overflow-visible">
        <svg 
          viewBox="0 0 134 89" 
          className={`w-full h-full overflow-visible ${upsideDown ? 'rotate-180' : ''}`}
          preserveAspectRatio="none"
        >
          <path 
            d="M51.6936 0C50.2645 0 48.944 0.762396 48.2295 2L1.4641 83C-0.0754968 85.6667 1.849 89 4.9282 89H129.636C132.715 89 134.64 85.6667 133.1 83L86.3346 2C85.6201 0.762395 84.2996 0 82.8705 0H51.6936Z"
            className={`
              fill-offwhite/50 
              dark:fill-grey/50
              stroke-blue 
              dark:stroke-cyan
              stroke-[3]
              group-hover:fill-offwhite/80
              dark:group-hover:fill-grey/80
              group-active:fill-blue
              dark:group-active:fill-cyan
              transition-colors
              drop-shadow-lg
            `}
          />
        </svg>
      </div>

      <div className="absolute inset-0 flex items-center justify-center">
        <div className={`
          w-9 h-9 
          text-blue dark:text-cyan 
          scale-[1.75]
          group-active:text-offwhite
          dark:group-active:text-grey
          transition-colors
        `}>
          {React.isValidElement(icon) && 
            React.cloneElement(icon as React.ReactElement<SVGProps<SVGSVGElement>>, {
              className: `w-full h-full ${(icon.props as SVGProps<SVGSVGElement>).className || ''}`
            })}
          {!React.isValidElement(icon) && icon}
        </div>
      </div>
    </button>
  );
}

interface CharacterListProps {
  party: Character[];
  onSelectCharacter: (id: string) => void;
  gameState: GameState;
  onGameStateChange: (newState: GameState) => void;
  room?: Room;
  selectedCharacterForInventory: string | null;
  selectedCharacterForEquipment: string | null;
  selectedCharacterForSkills: string | null;
  onCloseInventoryModal: () => void;
  onCloseEquipmentModal: () => void;
  onCloseSkillsModal: () => void;
  showInventoryModal: (characterId: string) => void;
  showEquipmentModal: (characterId: string) => void;
  showSkillsModal: (characterId: string) => void;
}

export function CharacterList({ 
  party, 
  onSelectCharacter, 
  gameState, 
  onGameStateChange,
  room,
  selectedCharacterForInventory,
  selectedCharacterForEquipment,
  selectedCharacterForSkills,
  onCloseInventoryModal,
  onCloseEquipmentModal,
  onCloseSkillsModal,
  showInventoryModal,
  showEquipmentModal,
  showSkillsModal
}: CharacterListProps) {
  const [characterImages, setCharacterImages] = useState<Record<string, string>>({});

  useEffect(() => {
    const loadCharacterImages = async () => {
      const newImages: Record<string, string> = {};
      
      for (const character of party) {
        if (character.image) {
          const thumbnail = imageManager.getThumbnail(character.image);
          if (thumbnail) {
            newImages[character.id] = thumbnail;
            continue;
          }

          try {
            const file = await imageManager.getImage(character.image);
            if (file) {
              const url = URL.createObjectURL(file);
              newImages[character.id] = url;
            }
          } catch (error) {
            console.error(`Failed to load image for character ${character.id}:`, error);
          }
        }
      }
      
      // Cleanup old URLs
      Object.values(characterImages).forEach(url => {
        if (url.startsWith('blob:')) {
          URL.revokeObjectURL(url);
        }
      });

      setCharacterImages(newImages);
    };

    loadCharacterImages();

    return () => {
      Object.values(characterImages).forEach(url => {
        if (url.startsWith('blob:')) {
          URL.revokeObjectURL(url);
        }
      });
    };
  }, [party]);

  return (
    <div className="">
      {party.map(character => (
        <div 
          key={character.id}
          id={`character-${character.id}`}
          className="border-2 mb-4 bg-offwhite/60 dark:bg-grey/60 border-grey dark:border-offwhite rounded-2xl shadow-md p-4"
        >
          <div className="flex items-center">
            <div className="w-64 flex-shrink-0">
              <h3 className="font-medium font-[Mohave] text-2xl">{character.name}</h3>
            </div>

            <div className="w-48 h-48 flex-shrink-0 mr-8">
              {characterImages[character.id] ? (
                <img
                  src={characterImages[character.id]}
                  alt={character.name}
                  className="w-full h-full object-cover rounded-lg"
                />
              ) : (
                <div className="w-full h-full bg-gray-100 dark:bg-gray-700 rounded-lg flex items-center justify-center">
                  <span className="text-gray-400 text-xs">No image</span>
                </div>
              )}
            </div>

            <div className="flex-1 flex items-center gap-8">
              <StatGauges
                character={character}
                gameState={gameState}
                onGameStateChange={onGameStateChange}
                size="large"
                showSideLabels={true}
              />
              <div className="flex-1 flex items-center justify-center -space-x-8">
                <TabButton
                  icon={<Sword />}
                  title="Equipment"
                  upsideDown={true}
                  onClick={() => showEquipmentModal(character.id)}
                />
                <TabButton
                  icon={<Bag />}
                  title="Inventory"
                  onClick={() => showInventoryModal(character.id)}
                />
                <TabButton
                  icon={<Star />}
                  title="Skills"
                  upsideDown={true}
                  onClick={() => showSkillsModal(character.id)}
                />
                <TabButton
                  icon={<Gear />}
                  title="Settings"
                  onClick={() => onSelectCharacter(character.id)}
                />
              </div>
            </div>
          </div>
        </div>
      ))}

      {party.length === 0 && (
        <div className="text-center py-8 font-['Mohave'] text-2xl text-offwhite dark:text-grey bg-grey dark:bg-offwhite rounded-md">
          No characters in the party yet
        </div>
      )}

      {/* Modals */}
      {selectedCharacterForInventory && (
        <InventoryPanel
          inventory={party.find(c => c.id === selectedCharacterForInventory)?.inventory || []}
          onClose={onCloseInventoryModal}
          room={room}
          isRoomCreator={true}
          gameState={gameState}
          onGameStateChange={onGameStateChange}
          actorId={selectedCharacterForInventory}
          actorType="character"
          isModal={true}
        />
      )}

      {selectedCharacterForEquipment && (
        <EquipmentPanel
          equipment={party.find(c => c.id === selectedCharacterForEquipment)?.equipment || []}
          onClose={onCloseEquipmentModal}
          room={room}
          gameState={gameState}
          isRoomCreator={true}
          onGameStateChange={onGameStateChange}
          actorId={selectedCharacterForEquipment}
          isModal={true}
        />
      )}

      {selectedCharacterForSkills && (
        <SkillsPanel
          skills={party.find(c => c.id === selectedCharacterForSkills)?.skills || []}
          onClose={onCloseSkillsModal}
          room={room}
          gameState={gameState}
          isRoomCreator={true}
          onGameStateChange={onGameStateChange}
          actorType="character"
          actorId={selectedCharacterForSkills}
          isModal={true}
        />
      )}
    </div>
  );
}