import React, { useState, useMemo } from 'react';
import { Character, Entity, isCharacter, GameState } from '../../types/game';
import { Plus, Minus } from 'lucide-react';

type CharacterStatType = 'hp' | 'mp' | 'sp';
type EntityStatType = 'hp' | 'sp';
type GaugeSize = 'small' | 'medium' | 'large';

interface BaseStatGaugesProps {
  editable?: boolean;
  gameState: GameState;
  onGameStateChange: (newState: GameState) => void;
  size?: GaugeSize;
  showSideLabels?: boolean;
  
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

const StatGauge = ({
  current,
  max,
  label,
  sideLabel,
  type,
  onIncrement,
  onDecrement,
  editable,
  size = 'medium',
  showSideLabels
}: StatGaugeProps) => {
  const [isHovered, setIsHovered] = useState(false);
  const percentage = Math.min(100, Math.max(0, (current / max) * 100));
  const { gauge, text, icon, gap, button } = sizeClasses[size];

  const colors = useMemo(() => {
    const colorMap = {
      hp: {
        light: {
          from: '#FF009D',
          to: '#FF66C4',
          text: 'text-magenta'
        },
        dark: {
          from: '#FF0051',
          to: '#FF4D86',
          text: 'text-red'
        }
      },
      mp: {
        light: {
          from: '#8A05FF',
          to: '#B24FFF',
          text: 'text-purple'
        },
        dark: {
          from: '#D505FF',
          to: '#E14FFF',
          text: 'text-pink'
        }
      },
      sp: {
        light: {
          from: '#0002FB',
          to: '#4D4EFC',
          text: 'text-blue'
        },
        dark: {
          from: '#00FBD1',
          to: '#4DFCE6',
          text: 'text-cyan'
        }
      }
    };
    return colorMap[type];
  }, [type]);
  
  return (
    <div className={`flex items-center ${gap} w-full`}>
      {showSideLabels && sideLabel && (
        <span className={`${text} font-bold font-['Mohave'] w-4 text-right ${colors.light.text} dark:${colors.dark.text}`}>
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
              '--gradient-from': `var(--${type}-gradient-from, ${colors.light.from})`,
              '--gradient-to': `var(--${type}-gradient-to, ${colors.light.to})`,
              '--dark-gradient-from': colors.dark.from,
              '--dark-gradient-to': colors.dark.to
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
  showSideLabels = true
}: StatGaugesProps) {
  const handleStatChange = (statType: CharacterStatType | EntityStatType, delta: number) => {
    const current = getCurrentStat(character, statType);
    const max = getMaxStat(character, statType);
    const newValue = Math.min(max, Math.max(0, current + delta));
    
    if (newValue === current) return;

    if (isCharacter(character)) {
      onGameStateChange({
        ...gameState,
        party: gameState.party.map(char =>
          char.id === character.id ? { ...char, [statType]: newValue } : char
        )
      });
    } else {
      onGameStateChange({
        ...gameState,
        field: gameState.field.map(entity =>
          entity.id === character.id ? { ...entity, [statType]: newValue } : entity
        )
      });
    }
  };

  return (
    <div className="space-y-4 w-full max-w-4xl px-4 py-2 rounded-lg transition-colors">
      <StatGauge
        current={character.hp}
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
          current={character.mp}
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
        current={character.sp}
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