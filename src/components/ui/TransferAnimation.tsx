import React, { useState, forwardRef, useImperativeHandle } from 'react';
import { motion } from 'framer-motion';

interface AnimationProps {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  onComplete: () => void;
}

interface AnimationState {
  id: number;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

interface TransferAnimationManagerRef {
  addAnimation: (startX: number, startY: number, endX: number, endY: number) => void;
}

const TransferAnimation: React.FC<AnimationProps> = ({ 
  startX, 
  startY, 
  endX, 
  endY, 
  onComplete 
}) => {
  return (
    <motion.div
      className="fixed w-4 h-4 rounded-full bg-blue dark:bg-cyan z-50"
      initial={{ x: startX, y: startY, scale: 0 }}
      animate={{ 
        x: endX,
        y: endY,
        scale: [0, 1, 1, 0]
      }}
      transition={{ 
        duration: 0.5,
        ease: "easeOut"
      }}
      onAnimationComplete={onComplete}
      style={{
        boxShadow: "0 0 10px 2px var(--color-blue)",
      }}
    />
  );
};

const TransferAnimationManager = forwardRef<TransferAnimationManagerRef>((_, ref) => {
  const [animations, setAnimations] = useState<AnimationState[]>([]);

  useImperativeHandle(ref, () => ({
    addAnimation: (startX: number, startY: number, endX: number, endY: number) => {
      const id = Date.now();
      setAnimations(prev => [...prev, {
        id,
        startX,
        startY,
        endX,
        endY
      }]);
    }
  }));

  return (
    <>
      {animations.map(anim => (
        <TransferAnimation
          key={anim.id}
          startX={anim.startX}
          startY={anim.startY}
          endX={anim.endX}
          endY={anim.endY}
          onComplete={() => {
            setAnimations(prev => prev.filter(a => a.id !== anim.id));
          }}
        />
      ))}
    </>
  );
});

TransferAnimationManager.displayName = 'TransferAnimationManager';

export type { TransferAnimationManagerRef };
export default TransferAnimationManager;