import React from 'react';
import { X } from 'lucide-react';

interface DiceNotificationProps {
  characterName: string;
  result: number;
  maxValue: number;
  onDismiss: () => void;
  index: number;
}

export function DiceNotification({ 
  characterName, 
  result, 
  maxValue, 
  onDismiss,
  index
}: DiceNotificationProps) {
  const isCriticalMin = result === 1;
  const isCriticalMax = result === maxValue;

  const getNumberStyle = () => {
    if (isCriticalMin) {
      return 'text-magenta dark:text-red animate-pulse';
    }
    if (isCriticalMax) {
      return 'text-blue dark:text-cyan animate-pulse';
    }
    return 'text-text dark:text-background';
  };

  const getRollText = () => {
    if (maxValue === 2) {
      const flipResult = result === 1 ? 'heads' : 'tails';
      return `${characterName} got ${flipResult} on a coin flip`;
    }
    return `${characterName} rolled a ${result} out of ${maxValue}`;
  };

  return (
    <div className="bg-offwhite dark:bg-grey px-[1vh] py-[0.5vh] rounded-lg shadow-lg flex items-center gap-4 border border-text dark:border-background">
      <span className="font-['Mohave'] text-[1.5vmin]">
        <span className={getNumberStyle()}>{getRollText()}</span>
      </span>
      <button
        onClick={onDismiss}
        className="p-1 hover:bg-grey/20 dark:hover:bg-offwhite/20 rounded-full transition-colors"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}