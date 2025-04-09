import React, { useState, useCallback, forwardRef, useImperativeHandle } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { DiceNotification } from './DiceNotification';

interface DiceRollNotification {
  id: string;
  characterName: string;
  result: number;
  maxValue: number;
}

export interface DiceNotificationStackHandle {
  addNotification: (notification: Omit<DiceRollNotification, 'id'>) => void;
}

export const DiceNotificationStack = forwardRef<DiceNotificationStackHandle>((_, ref) => {
  // Store all rolls (up to 10)
  const [storedRolls, setStoredRolls] = useState<DiceRollNotification[]>([]);
  const [isExiting, setIsExiting] = useState(false);
  const [isSettling, setIsSettling] = useState(false);
  const [queuedNotification, setQueuedNotification] = useState<Omit<DiceRollNotification, 'id'> | null>(null);

  // Get the 3 most recent rolls to display
  const displayedRolls = storedRolls.slice(-3);

  const addNotification = useCallback((notification: Omit<DiceRollNotification, 'id'>) => {
    const newRoll = {
      ...notification,
      id: Math.random().toString(36).substring(7)
    };

    setStoredRolls(current => {
      // Keep only the 9 most recent rolls and add the new one
      const updated = [...current.slice(-9), newRoll];
      return updated;
    });
  }, []);

  useImperativeHandle(ref, () => ({
    addNotification,
  }), [addNotification]);

  const dismissNotification = useCallback((id: string) => {
    setStoredRolls(current => current.filter(roll => roll.id !== id));
  }, []);

  return (
    <div className="fixed left-1/2 -translate-x-1/2 top-2" style={{ width: 'fit-content', zIndex: 50 }}>
      <motion.div layout className="relative inline-flex flex-row gap-2">
        <AnimatePresence mode="popLayout">
          {displayedRolls.map((notification, index) => (
            <motion.div
              key={notification.id}
              layout
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={{ duration: 0.2 }}
            >
              <DiceNotification
                characterName={notification.characterName}
                result={notification.result}
                maxValue={notification.maxValue}
                onDismiss={() => dismissNotification(notification.id)}
                index={index}
              />
            </motion.div>
          ))}
        </AnimatePresence>
      </motion.div>
    </div>
  );
});

DiceNotificationStack.displayName = 'DiceNotificationStack';