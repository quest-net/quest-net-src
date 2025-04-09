import React, { useState } from 'react';
import { Edit, Trash2, Eraser, Box, Send, Shield, ShieldOff, BookX, LucideIcon } from 'lucide-react';

export type ActionType = 'unequip' | 'equip' | 'use' | 'edit' | 'delete' | 'discard' | 'transfer' | 'forget';

interface GridMenuProps {
  onSelect: (action: ActionType) => void;
  availableActions?: ActionType[];
}

const getGridCols = (count: number): string => {
  switch (count) {
    case 1: return 'grid-cols-1';
    case 2: return 'grid-cols-2';
    case 3: return 'grid-cols-3';
    case 4: return 'grid-cols-4';
    case 5: return 'grid-cols-5';
    case 6: return 'grid-cols-6';
    case 7: return 'grid-cols-7';
    default: return 'grid-cols-1';
  }
};

const GridMenu: React.FC<GridMenuProps> = ({
  onSelect,
  availableActions = ["unequip", "equip", "use", "edit", "delete", "discard", "transfer", "forget"]
}) => {
  const [activeButton, setActiveButton] = useState<ActionType | null>(null);
  const [pressedButton, setPressedButton] = useState<ActionType | null>(null);

  const icons: Record<ActionType, LucideIcon> = {
    unequip: ShieldOff,
    equip: Shield,
    use: Box,
    edit: Edit,
    delete: Eraser,
    discard: Trash2,
    transfer: Send,
    forget: BookX
  };

  const shouldWrapContent = availableActions.length > 2;

  return (
    <div className="w-full h-full">
      <div className={`
        grid gap-2 w-full h-full
        ${getGridCols(availableActions.length)}
      `}>
        {availableActions.map((action) => {
          const Icon = icons[action];
          const isHovered = activeButton === action;
          const isPressed = pressedButton === action;
          
          return (
            <button
              key={action}
              className={`
                flex ${shouldWrapContent ? 'flex-col' : 'flex-row'} items-center justify-center gap-2 p-2
                rounded-lg bg-offwhite dark:bg-grey
                text-blue dark:text-cyan 
                border-2 border-blue dark:border-cyan border-b-4
                hover:bg-blue/10 dark:hover:bg-cyan/10
                active:border-b-2
                active:bg-blue dark:active:bg-cyan
                active:text-offwhite dark:active:text-grey
                transition-all duration-75
              `}
              onClick={() => {
                onSelect(action);
                setPressedButton(null);
              }}
              onMouseEnter={() => setActiveButton(action)}
              onMouseLeave={() => {
                setActiveButton(null);
                setPressedButton(null);
              }}
              onMouseDown={() => setPressedButton(action)}
              onMouseUp={() => setPressedButton(null)}
            >
              <Icon 
                className={`w-6 h-6 ${shouldWrapContent ? 'mb-1' : ''}`} 
                strokeWidth={2}
              />
              <span className={`
                text-md font-medium font-['Mohave'] capitalize
                ${shouldWrapContent ? 'text-center' : ''}
                whitespace-normal
              `}>
                {action}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default GridMenu;