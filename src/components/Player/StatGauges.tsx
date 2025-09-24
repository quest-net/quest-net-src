import React, { useState, useMemo, useEffect } from 'react';
import { Character, Entity, isCharacter, GameState } from '../../types/game';
import { Plus, Minus } from 'lucide-react';
import { useCharacterActions } from '../../actions/characterActions';
import type { Room } from 'trystero/nostr';

type CharacterStatType = 'hp' | 'mp' | 'sp';
type EntityStatType = 'hp' | 'sp';
type GaugeSize = 'small' | 'medium' | 'large';

interface BaseStatGaugesProps {
  editable?: boolean;
  gameState: GameState;
  onGameStateChange: (newState: GameState) => void;
  size?: GaugeSize;
  showSideLabels?: boolean;
  room?: Room;
  isRoomCreator?: boolean;
}

interface CharacterStatGaugesProps extends BaseStatGaugesProps {
  character: Character;
}

interface EntityStatGaugesProps extends BaseStatGaugesProps {
  character: Entity;
}

type StatGaugesProps = CharacterStatGaugesProps | EntityStatGaugesProps;

// Helper functions remain unchanged
const getMaxStat = (character: Character | Entity, statType: CharacterStatType | EntityStatType): number => {
  switch (statType) {
    case 'hp':
      return character.maxHp;
    case 'mp':
      return isCharacter(character) ? character.maxMp : 0;
    case 'sp':
      return character.maxSp;
    default:
      return 0;
  }
};

const getCurrentStat = (character: Character | Entity, statType: CharacterStatType | EntityStatType): number => {
  switch (statType) {
    case 'hp':
      return character.hp;
    case 'mp':
      return isCharacter(character) ? character.mp : 0;
    case 'sp':
      return character.sp;
    default:
      return 0;
  }
};

const sizeClasses = {
  small: {
    gauge: 'h-2',
    text: 'text-sm',
    icon: '12',
    gap: 'gap-2',
    button: 'p-0.5'
  },
  medium: {
    gauge: 'h-3',
    text: 'text-md',
    icon: '16',
    gap: 'gap-4',
    button: 'p-1'
  },
  large: {
    gauge: 'h-4',
    text: 'text-lg',
    icon: '20',
    gap: 'gap-4',
    button: 'p-2'
  }
};

interface StatGaugeProps {
  current: number;
  max: number;
  label: string;
  sideLabel?: string;
  type: 'hp' | 'mp' | 'sp';
  onIncrement?: () => void;
  onDecrement?: () => void;
  editable?: boolean;
  size?: GaugeSize;
  showSideLabels?: boolean;
}

const StatGauge: React.FC<StatGaugeProps> = ({
  current,
  max,
  label,
  sideLabel,
  type,
  onIncrement,
  onDecrement,
  editable = true,
  size = 'medium',
  showSideLabels = true
}) => {
  const [isHovered, setIsHovered] = useState(false);
  
  const { gauge, text, icon, gap, button } = sizeClasses[size];
  const percentage = max > 0 ? Math.min(100, (current / max) * 100) : 0;
  
  const colors = {
    hp: {
      light: { from: '#ef4444', to: '#dc2626' },
      dark: { from: '#f87171', to: '#ef4444' }
    },
    mp: {
      light: { from: '#3b82f6', to: '#2563eb' },
      dark: { from: '#60a5fa', to: '#3b82f6' }
    },
    sp: {
      light: { from: '#f59e0b', to: '#d97706' },
      dark: { from: '#fbbf24', to: '#f59e0b' }
    }
  };
  
  return (
    <div className={`flex items-center ${gap} transition-colors`}>
      {showSideLabels && (
        <span className={`${text} font-bold text-grey dark:text-offwhite transition-colors min-w-max`}>
          {sideLabel}
        </span>
      )}
      
      {editable && (
        <button
          onClick={onDecrement}
          className={`${button} rounded-full hover:bg-offwhite/10 dark:hover:bg-grey/10 transition-colors`}
          disabled={current <= 0}
        >
          <Minus 
            size={parseInt(icon)} 
            className="text-grey dark:text-offwhite transition-colors" 
          />
        </button>
      )}

      <div 
        className="flex-1 relative" 
        onMouseEnter={() => setIsHovered(true)} 
        onMouseLeave={() => setIsHovered(false)}
      >
        <div className={`${gauge} bg-grey/10 dark:bg-offwhite/10 rounded-full overflow-hidden transition-colors`}>
          <div
            className="h-full transition-all duration-300"
            style={{
              width: `${percentage}%`,
              background: `linear-gradient(to right, var(--gradient-from), var(--gradient-to))`,
              '--gradient-from': `var(--${type}-gradient-from, ${colors[type].light.from})`,
              '--gradient-to': `var(--${type}-gradient-to, ${colors[type].light.to})`,
              '--dark-gradient-from': colors[type].dark.from,
              '--dark-gradient-to': colors[type].dark.to
            } as React.CSSProperties}
          />
        </div>
        {isHovered && (
          <div className="absolute inset-0 flex items-center justify-center">
            <span 
              className={`${text} font-medium px-4 py-0.5`}
              style={{
                background: 'linear-gradient(to right, transparent, var(--bg-color) 40%, var(--bg-color) 60%, transparent)',
                '--bg-color': 'var(--color-background)'
              } as React.CSSProperties}
            >
              {current}/{max}
            </span>
          </div>
        )}
      </div>

      {editable && (
        <button
          onClick={onIncrement}
          className={`${button} rounded-full hover:bg-offwhite/10 dark:hover:bg-grey/10 transition-colors`}
          disabled={current >= max}
        >
          <Plus 
            size={parseInt(icon)} 
            className="text-grey dark:text-offwhite transition-colors" 
          />
        </button>
      )}
    </div>
  );
};

export default function StatGauges({
  character,
  editable = true,
  gameState,
  onGameStateChange,
  size = 'medium',
  showSideLabels = true,
  room,
  isRoomCreator = false
}: StatGaugesProps) {
  const characterActions = useCharacterActions(room, gameState, onGameStateChange, isRoomCreator);

  // Optimistic updates state - only for characters that need DM validation
  const [optimisticChanges, setOptimisticChanges] = useState<{
    hp?: number;
    mp?: number;
    sp?: number;
  }>({});

  // Clear optimistic changes when actual character stats change
  useEffect(() => {
    setOptimisticChanges({});
  }, [character.hp, character.sp, isCharacter(character) ? character.mp : undefined]);

  // Get current stat with optimistic overlay
  const getOptimisticStat = (statType: CharacterStatType | EntityStatType): number => {
    const baseStat = getCurrentStat(character, statType);
    const optimisticChange = optimisticChanges[statType as keyof typeof optimisticChanges];
    return optimisticChange !== undefined ? optimisticChange : baseStat;
  };

  const handleStatChange = (statType: CharacterStatType | EntityStatType, delta: number) => {
    // For characters, use optimistic updates + action system
    if (isCharacter(character)) {
      const currentValue = getCurrentStat(character, statType);
      const maxValue = getMaxStat(character, statType);
      const newValue = Math.min(maxValue, Math.max(0, currentValue + delta));
      
      if (newValue === currentValue) return;

      // Apply optimistic update immediately
      setOptimisticChanges(prev => ({
        ...prev,
        [statType]: newValue
      }));

      // Send action to DM for validation
      characterActions?.adjustCharacterStat(character.id, statType as CharacterStatType, delta);
      return;
    }

    // For entities, keep the direct state modification since only DMs can edit entities
    // and there's no player action needed for entity stat changes
    const current = getCurrentStat(character, statType);
    const max = getMaxStat(character, statType);
    const newValue = Math.min(max, Math.max(0, current + delta));
    
    if (newValue === current) return;

    // Update field entity using instanceId
    const instanceId = character.id;
    
    onGameStateChange({
      ...gameState,
      field: gameState.field.map(entityRef =>
        entityRef.instanceId === instanceId 
          ? { ...entityRef, [statType]: newValue } 
          : entityRef
      )
    });
  };

  return (
    <div className="space-y-2 2xl:space-y-4 w-full max-w-4xl px-4 py-0 rounded-lg transition-colors">
      <StatGauge
        current={getOptimisticStat('hp')}
        max={character.maxHp}
        label="Health"
        sideLabel="HP"
        type="hp"
        onIncrement={() => handleStatChange('hp', 1)}
        onDecrement={() => handleStatChange('hp', -1)}
        editable={editable}
        size={size}
        showSideLabels={showSideLabels}
      />
      
      {isCharacter(character) && (
        <StatGauge
          current={getOptimisticStat('mp')}
          max={character.maxMp}
          label="Mana"
          sideLabel="MP"
          type="mp"
          onIncrement={() => handleStatChange('mp', 1)}
          onDecrement={() => handleStatChange('mp', -1)}
          editable={editable}
          size={size}
          showSideLabels={showSideLabels}
        />
      )}
      
      <StatGauge
        current={getOptimisticStat('sp')}
        max={character.maxSp}
        label="Special"
        sideLabel="SP"
        type="sp"
        onIncrement={() => handleStatChange('sp', 1)}
        onDecrement={() => handleStatChange('sp', -1)}
        editable={editable}
        size={size}
        showSideLabels={showSideLabels}
      />
    </div>
  );
}