// Completely overhauled StandaloneCharacterSheet.tsx
import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Character, GameState, Item, Skill } from '../../types/game';
import { getCatalogItem, getCatalogSkill } from '../../utils/referenceHelpers';
import BasicObjectView from '../ui/BasicObjectView';
import { 
  Sword, Shield, Backpack, Scroll, Heart, Zap, Battery, 
  User, FileText, ArrowLeft, Home, Eye 
} from 'lucide-react';

interface StandaloneCharacterSheetProps {
  testCharacter?: Character;
  testGameState?: GameState;
}

export function StandaloneCharacterSheet({ testCharacter, testGameState }: StandaloneCharacterSheetProps) {
  const { characterId } = useParams<{ characterId: string }>();
  const navigate = useNavigate();
  const [character, setCharacter] = useState<Character | null>(null);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<{ item: Item; type: 'equipment' | 'inventory'; quantity?: number; usesLeft?: number } | null>(null);
  const [selectedSkill, setSelectedSkill] = useState<{ skill: Skill; usesLeft?: number } | null>(null);

  // Helper functions to handle selection (only one item OR skill at a time)
  const handleItemSelect = (item: Item, type: 'equipment' | 'inventory', quantity?: number, usesLeft?: number) => {
    setSelectedItem({ item, type, quantity, usesLeft });
    setSelectedSkill(null); // Clear skill selection
  };

  const handleSkillSelect = (skill: Skill, usesLeft?: number) => {
    setSelectedSkill({ skill, usesLeft });
    setSelectedItem(null); // Clear item selection
  };

  const isItemSelected = (item: Item, type: 'equipment' | 'inventory') => {
    return selectedItem?.item.id === item.id && selectedItem?.type === type;
  };

  const isSkillSelected = (skill: Skill) => {
    return selectedSkill?.skill.id === skill.id;
  };

  useEffect(() => {
    if (testCharacter && testGameState) {
      setCharacter(testCharacter);
      setGameState(testGameState);
      setLoading(false);
      return;
    }

    if (!characterId) {
      setError('No character ID provided');
      setLoading(false);
      return;
    }

    // Load from localStorage
    try {
      let foundCharacter: Character | null = null;
      let foundGameState: GameState | null = null;

      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith('gameState_')) {
          try {
            const savedData = JSON.parse(localStorage.getItem(key) || '');
            const gameStateData = savedData.gameState;
            
            const char = gameStateData.party.find((c: Character) => c.id === characterId);
            if (char) {
              foundCharacter = char;
              foundGameState = gameStateData;
              break;
            }
          } catch (err) {
            console.log(`Failed to parse saved state for key ${key}:`, err);
          }
        }
      }

      if (foundCharacter && foundGameState) {
        setCharacter(foundCharacter);
        setGameState(foundGameState);
      } else {
        setError('Character not found in saved data');
      }
    } catch (err) {
      setError('Failed to load character data');
      console.error('Error loading character:', err);
    } finally {
      setLoading(false);
    }
  }, [characterId, testCharacter, testGameState]);

  if (loading) {
    return (
      <div className="min-h-screen bg-offwhite dark:bg-grey flex items-center justify-center">
        <div className="text-xl text-grey dark:text-offwhite">Loading character...</div>
      </div>
    );
  }

  if (error || !character || !gameState) {
    return (
      <div className="min-h-screen bg-offwhite dark:bg-grey">
        <CharacterSheetHeader onBack={() => navigate('/')} />
        <div className="flex items-center justify-center py-20">
          <div className="text-center">
            <h1 className="text-2xl font-bold text-red-600 mb-4">Character Not Found</h1>
            <p className="text-grey dark:text-offwhite mb-4">{error || 'Unable to load character data'}</p>
            <button 
              onClick={() => navigate('/')}
              className="px-4 py-2 bg-blue dark:bg-cyan text-white rounded-lg hover:opacity-90 transition-opacity"
            >
              Return to Quest-Net
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-offwhite dark:bg-grey">
      <CharacterSheetHeader onBack={() => navigate('/')} />
      
      <div className="max-w-full mx-auto p-6">
        {/* Character Header Section */}
        <div className="bg-white dark:bg-black rounded-lg border-2 border-grey dark:border-offwhite p-6 mb-6">
          <div className="flex items-start gap-6">
            {/* Character Portrait */}
            <div className="flex-shrink-0">
              <BasicObjectView
                name=""
                imageId={character.image}
                size="lg"
              />
            </div>

            {/* Character Info & Stats */}
            <div className="flex-grow space-y-4">
              <div>
                <h1 className="text-3xl font-bold text-grey dark:text-offwhite mb-2">{character.name}</h1>
                {character.description && (
                  <p className="text-grey/80 dark:text-offwhite/80 leading-relaxed">{character.description}</p>
                )}
              </div>

              {/* Stat Bars */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <StatBar 
                  label="HP" 
                  current={character.hp} 
                  max={character.maxHp} 
                  color="red" 
                  icon={<Heart className="w-5 h-5" />}
                />
                <StatBar 
                  label="MP" 
                  current={character.mp} 
                  max={character.maxMp} 
                  color="blue" 
                  icon={<Zap className="w-5 h-5" />}
                />
                <StatBar 
                  label="SP" 
                  current={character.sp} 
                  max={character.maxSp} 
                  color="green" 
                  icon={<Battery className="w-5 h-5" />}
                  extra={`+${character.spRegenRate}/turn`}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Main Content Grid */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          
          {/* Left Column - Equipment & Skills */}
          <div className="space-y-6">
            {/* Equipment Section */}
            <ContentSection 
              title="Equipment" 
              icon={<Shield className="w-5 h-5" />}
              isEmpty={character.equipment.length === 0}
              emptyMessage="No equipment equipped"
            >
              <div className="grid grid-cols-2 gap-4">
                {character.equipment.map((itemRef, index) => {
                  const item = getCatalogItem(itemRef.catalogId, gameState);
                  if (!item) return null;
                  
                  return (
                    <ItemCard
                      key={index}
                      item={item}
                      usesLeft={itemRef.usesLeft}
                      isSelected={isItemSelected(item, 'equipment')}
                      onClick={() => handleItemSelect(item, 'equipment', undefined, itemRef.usesLeft)}
                    />
                  );
                })}
              </div>
            </ContentSection>

            {/* Skills Section */}
            <ContentSection 
              title="Skills" 
              icon={<Scroll className="w-5 h-5" />}
              isEmpty={character.skills.length === 0}
              emptyMessage="No skills learned"
            >
              <div className="grid grid-cols-2 gap-4">
                {character.skills.map((skillRef, index) => {
                  const skill = getCatalogSkill(skillRef.catalogId, gameState);
                  if (!skill) return null;
                  
                  return (
                    <SkillCard
                      key={index}
                      skill={skill}
                      usesLeft={skillRef.usesLeft}
                      isSelected={isSkillSelected(skill)}
                      onClick={() => handleSkillSelect(skill, skillRef.usesLeft)}
                    />
                  );
                })}
              </div>
            </ContentSection>
          </div>

          {/* Middle Column - Inventory */}
          <div>
            <ContentSection 
              title="Inventory" 
              icon={<Backpack className="w-5 h-5" />}
              isEmpty={character.inventory.length === 0}
              emptyMessage="Inventory is empty"
            >
              <div className="space-y-3">
                {character.inventory.map(([itemRef, quantity], index) => {
                  const item = getCatalogItem(itemRef.catalogId, gameState);
                  if (!item) return null;
                  
                  return (
                    <InventoryItemRow
                      key={index}
                      item={item}
                      quantity={quantity}
                      usesLeft={itemRef.usesLeft}
                      isSelected={isItemSelected(item, 'inventory')}
                      onClick={() => handleItemSelect(item, 'inventory', quantity, itemRef.usesLeft)}
                    />
                  );
                })}
              </div>
            </ContentSection>
          </div>

          {/* Right Column - Details Panel */}
          <div>
            <DetailsPanel 
              selectedItem={selectedItem}
              selectedSkill={selectedSkill}
              onClose={() => {
                setSelectedItem(null);
                setSelectedSkill(null);
              }}
            />
          </div>
        </div>

        {/* Status Effects (if any) */}
        {character.statusEffects.length > 0 && (
          <div className="mt-6">
            <ContentSection 
              title="Status Effects" 
              icon={<Zap className="w-5 h-5" />}
              isEmpty={false}
            >
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {character.statusEffects.map((effectRef, index) => (
                  <div key={index} className="p-3 rounded-lg bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200 text-center">
                    <div className="font-semibold">Status Effect {index + 1}</div>
                    <div className="text-sm">{effectRef.duration} turns</div>
                  </div>
                ))}
              </div>
            </ContentSection>
          </div>
        )}
      </div>
    </div>
  );
}

// Header Component
function CharacterSheetHeader({ onBack }: { onBack: () => void }) {
  return (
    <div className="bg-white dark:bg-black border-b-2 border-grey dark:border-offwhite">
      <div className="max-w-full mx-auto px-6 py-4">
        <div className="flex items-center justify-between">
          <button 
            onClick={onBack}
            className="flex items-center gap-2 text-grey dark:text-offwhite hover:text-blue dark:hover:text-cyan transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
            Back to Quest-Net
          </button>
          
          <div className="flex items-center gap-4">
            <h1 className="text-2xl font-bold font-['Mohave'] text-grey dark:text-offwhite">
              Character Sheet
            </h1>
            <span className="text-sm text-grey/60 dark:text-offwhite/60 bg-yellow-100 dark:bg-yellow-900 px-2 py-1 rounded">
              Read Only
            </span>
          </div>
          
          <div className="w-24"></div> {/* Spacer for centering */}
        </div>
      </div>
    </div>
  );
}

// Stat Bar Component
function StatBar({ 
  label, 
  current, 
  max, 
  color, 
  icon, 
  extra 
}: { 
  label: string; 
  current: number; 
  max: number; 
  color: 'red' | 'blue' | 'green'; 
  icon: React.ReactNode;
  extra?: string;
}) {
  const percentage = Math.max(0, (current / max) * 100);
  const colorClasses = {
    red: 'bg-red-500 text-red-600 dark:text-red-400',
    blue: 'bg-blue-500 text-blue-600 dark:text-blue-400',
    green: 'bg-green-500 text-green-600 dark:text-green-400'
  };

  return (
    <div>
      <div className={`flex items-center gap-2 mb-1 ${colorClasses[color].split(' ')[1]} ${colorClasses[color].split(' ')[2]}`}>
        {icon}
        <span className="font-semibold">{label}</span>
        <span className="ml-auto font-mono">{current} / {max}</span>
      </div>
      <div className="w-full bg-grey/20 dark:bg-offwhite/20 rounded-full h-3">
        <div 
          className={`${colorClasses[color].split(' ')[0]} h-3 rounded-full transition-all duration-300`}
          style={{ width: `${percentage}%` }}
        />
      </div>
      {extra && (
        <div className="text-xs text-grey/60 dark:text-offwhite/60 mt-1">{extra}</div>
      )}
    </div>
  );
}

// Content Section Component
function ContentSection({ 
  title, 
  icon, 
  isEmpty, 
  emptyMessage, 
  children 
}: { 
  title: string; 
  icon: React.ReactNode; 
  isEmpty: boolean;
  emptyMessage?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white dark:bg-black rounded-lg border-2 border-grey dark:border-offwhite p-6">
      <h3 className="text-xl font-bold text-grey dark:text-offwhite mb-4 flex items-center gap-2">
        {icon}
        {title}
      </h3>
      
      {isEmpty ? (
        <p className="text-grey/60 dark:text-offwhite/60 text-center py-8">
          {emptyMessage}
        </p>
      ) : (
        children
      )}
    </div>
  );
}

// Item Card Component
function ItemCard({ 
  item, 
  usesLeft, 
  isSelected,
  onClick 
}: { 
  item: Item; 
  usesLeft?: number;
  isSelected: boolean;
  onClick: () => void;
}) {
  const tooltip = `${item.name}${usesLeft ? ` • ${usesLeft} uses left` : ''}${item.isEquippable ? ' • Equippable' : ''}`;
  
  return (
    <div 
      onClick={onClick}
      className={`cursor-pointer p-2 rounded-lg transition-colors ${
        isSelected 
          ? 'bg-blue/20 dark:bg-cyan/20 border-2 border-blue dark:border-cyan' 
          : 'hover:bg-grey/10 dark:hover:bg-offwhite/10 border-2 border-transparent'
      }`}
    >
      <BasicObjectView
        name={item.name}
        imageId={item.image}
        size="md"
        tooltip={tooltip}
      />
      {usesLeft && (
        <div className="text-center text-xs text-grey/70 dark:text-offwhite/70 mt-1">
          {usesLeft} uses
        </div>
      )}
    </div>
  );
}

// Skill Card Component
function SkillCard({ 
  skill, 
  usesLeft, 
  isSelected,
  onClick 
}: { 
  skill: Skill; 
  usesLeft?: number;
  isSelected: boolean;
  onClick: () => void;
}) {
  const tooltip = `${skill.name} • ${skill.spCost} SP • ${skill.damage} damage${usesLeft ? ` • ${usesLeft} uses left` : ''}`;
  
  return (
    <div 
      onClick={onClick}
      className={`cursor-pointer p-2 rounded-lg transition-colors ${
        isSelected 
          ? 'bg-blue/20 dark:bg-cyan/20 border-2 border-blue dark:border-cyan' 
          : 'hover:bg-grey/10 dark:hover:bg-offwhite/10 border-2 border-transparent'
      }`}
    >
      <BasicObjectView
        name={skill.name}
        imageId={skill.image}
        size="md"
        tooltip={tooltip}
      />
      <div className="text-center text-xs text-grey/70 dark:text-offwhite/70 mt-1 space-y-1">
        <div>{skill.spCost} SP • {skill.damage} dmg</div>
        {usesLeft && <div>{usesLeft} uses</div>}
      </div>
    </div>
  );
}

// Inventory Item Row Component
function InventoryItemRow({ 
  item, 
  quantity, 
  usesLeft, 
  isSelected,
  onClick 
}: { 
  item: Item; 
  quantity: number;
  usesLeft?: number;
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <div 
      onClick={onClick}
      className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors ${
        isSelected
          ? 'bg-blue/20 dark:bg-cyan/20 border-2 border-blue dark:border-cyan'
          : 'border border-grey/20 dark:border-offwhite/20 hover:bg-grey/10 dark:hover:bg-offwhite/10'
      }`}
    >
      <div className="flex-shrink-0">
        <BasicObjectView
          name=""
          imageId={item.image}
          size="sm"
        />
      </div>
      <div className="flex-grow min-w-0">
        <div className="font-semibold text-grey dark:text-offwhite truncate">{item.name}</div>
        <div className="text-sm text-grey/70 dark:text-offwhite/70">
          Qty: {quantity}
          {usesLeft && ` • ${usesLeft} uses left`}
          {item.isEquippable && ' • Equippable'}
        </div>
        <div className="text-xs text-grey/60 dark:text-offwhite/60 line-clamp-1">
          {item.description}
        </div>
      </div>
      <Eye className="w-4 h-4 text-grey/40 dark:text-offwhite/40 flex-shrink-0" />
    </div>
  );
}

// Details Panel Component
function DetailsPanel({ 
  selectedItem, 
  selectedSkill, 
  onClose 
}: { 
  selectedItem: { item: Item; type: 'equipment' | 'inventory'; quantity?: number; usesLeft?: number } | null;
  selectedSkill: { skill: Skill; usesLeft?: number } | null;
  onClose: () => void;
}) {
  if (!selectedItem && !selectedSkill) {
    return (
      <div className="bg-white dark:bg-black rounded-lg border-2 border-grey dark:border-offwhite p-6">
        <div className="text-center text-grey/60 dark:text-offwhite/60 py-8">
          <Eye className="w-12 h-12 mx-auto mb-4 opacity-40" />
          <p>Click on an item or skill to view details</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-black rounded-lg border-2 border-grey dark:border-offwhite p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xl font-bold text-grey dark:text-offwhite">Details</h3>
        <button 
          onClick={onClose}
          className="text-grey/60 dark:text-offwhite/60 hover:text-grey dark:hover:text-offwhite"
        >
          ×
        </button>
      </div>

      {selectedItem && (
        <ItemDetails 
          item={selectedItem.item}
          type={selectedItem.type}
          quantity={selectedItem.quantity}
          usesLeft={selectedItem.usesLeft}
        />
      )}

      {selectedSkill && (
        <SkillDetails 
          skill={selectedSkill.skill}
          usesLeft={selectedSkill.usesLeft}
        />
      )}
    </div>
  );
}

// Item Details Component
function ItemDetails({ 
  item, 
  type, 
  quantity, 
  usesLeft 
}: { 
  item: Item; 
  type: 'equipment' | 'inventory';
  quantity?: number;
  usesLeft?: number;
}) {
  return (
    <div className="space-y-4">
      {/* Item Image & Name */}
      <div className="text-center">
        <div className="mx-auto mb-3">
          <BasicObjectView
            key={item.id} // Force re-render when item changes
            name={item.name}
            imageId={item.image}
            size="lg"
          />
        </div>
        <h4 className="text-lg font-bold text-grey dark:text-offwhite">{item.name}</h4>
      </div>

      {/* Item Stats */}
      <div className="grid grid-cols-2 gap-4 text-sm">
        <div>
          <span className="text-grey/70 dark:text-offwhite/70">Type:</span>
          <div className="font-semibold">{type === 'equipment' ? 'Equipped' : 'Inventory'}</div>
        </div>
        {quantity && (
          <div>
            <span className="text-grey/70 dark:text-offwhite/70">Quantity:</span>
            <div className="font-semibold">{quantity}</div>
          </div>
        )}
        <div>
          <span className="text-grey/70 dark:text-offwhite/70">Equippable:</span>
          <div className="font-semibold">{item.isEquippable ? 'Yes' : 'No'}</div>
        </div>
        {item.uses && (
          <div>
            <span className="text-grey/70 dark:text-offwhite/70">Uses Left:</span>
            <div className="font-semibold">{usesLeft ?? item.uses}</div>
          </div>
        )}
      </div>

      {/* Description */}
      <div>
        <span className="text-grey/70 dark:text-offwhite/70 text-sm">Description:</span>
        <p className="text-grey dark:text-offwhite leading-relaxed mt-1">{item.description}</p>
      </div>

      {/* Tags */}
      {item.tags && item.tags.length > 0 && (
        <div>
          <span className="text-grey/70 dark:text-offwhite/70 text-sm">Tags:</span>
          <div className="flex flex-wrap gap-1 mt-1">
            {item.tags.map((tag, index) => (
              <span 
                key={index}
                className="px-2 py-1 bg-grey/20 dark:bg-offwhite/20 rounded text-xs"
              >
                {tag}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Skill Details Component
function SkillDetails({ 
  skill, 
  usesLeft 
}: { 
  skill: Skill; 
  usesLeft?: number;
}) {
  return (
    <div className="space-y-4">
      {/* Skill Image & Name */}
      <div className="text-center">
        <div className="mx-auto mb-3">
          <BasicObjectView
            key={skill.id} // Force re-render when skill changes
            name={skill.name}
            imageId={skill.image}
            size="lg"
          />
        </div>
        <h4 className="text-lg font-bold text-grey dark:text-offwhite">{skill.name}</h4>
      </div>

      {/* Skill Stats */}
      <div className="grid grid-cols-2 gap-4 text-sm">
        <div>
          <span className="text-grey/70 dark:text-offwhite/70">SP Cost:</span>
          <div className="font-semibold text-blue-600 dark:text-blue-400">{skill.spCost}</div>
        </div>
        <div>
          <span className="text-grey/70 dark:text-offwhite/70">Damage:</span>
          <div className="font-semibold text-red-600 dark:text-red-400">{skill.damage}</div>
        </div>
        {skill.uses && (
          <div className="col-span-2">
            <span className="text-grey/70 dark:text-offwhite/70">Uses Left:</span>
            <div className="font-semibold">{usesLeft ?? skill.uses}</div>
          </div>
        )}
      </div>

      {/* Description */}
      <div>
        <span className="text-grey/70 dark:text-offwhite/70 text-sm">Description:</span>
        <p className="text-grey dark:text-offwhite leading-relaxed mt-1">{skill.description}</p>
      </div>

      {/* Tags */}
      {skill.tags && skill.tags.length > 0 && (
        <div>
          <span className="text-grey/70 dark:text-offwhite/70 text-sm">Tags:</span>
          <div className="flex flex-wrap gap-1 mt-1">
            {skill.tags.map((tag, index) => (
              <span 
                key={index}
                className="px-2 py-1 bg-grey/20 dark:bg-offwhite/20 rounded text-xs"
              >
                {tag}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}