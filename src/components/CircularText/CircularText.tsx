import React, { useEffect } from 'react';
import { motion, useAnimation, useMotionValue, MotionValue, Transition } from 'motion/react';

interface CircularTextProps {
  text: string;
  spinDuration?: number;
  onHover?: 'slowDown' | 'speedUp' | 'pause' | 'goBonkers' | 'none';
  className?: string;
  // Enhanced props
  fontSize?: string; // Tailwind class like "text-2xl" or CSS value like "24px"
  textColor?: string; // Tailwind class like "text-primary" or CSS color like "#ff0000"
  radius?: number | string; // Radius: number (px), "10rem", "150px", "20vw", "20vh"
  fontWeight?: string; // Tailwind class like "font-bold" or CSS value like "700"
  letterSpacing?: number; // Additional spacing between letters in degrees (can be negative)
  direction?: 'clockwise' | 'counterclockwise'; // Rotation direction
  fontFamily?: string; // Tailwind class like "font-mono" or CSS font family
}

const getRotationTransition = (duration: number, from: number, loop: boolean = true) => ({
  from,
  to: from + 360,
  ease: 'linear' as const,
  duration,
  type: 'tween' as const,
  repeat: loop ? Infinity : 0
});

const getTransition = (duration: number, from: number) => ({
  rotate: getRotationTransition(duration, from),
  scale: {
    type: 'spring' as const,
    damping: 20,
    stiffness: 300
  }
});

const CircularText: React.FC<CircularTextProps> = ({
  text,
  spinDuration = 20,
  onHover = 'speedUp',
  className = '',
  fontSize = 'text-2xl',
  textColor = 'text-white',
  radius = 100,
  fontWeight = 'font-black',
  letterSpacing = 0,
  direction = 'clockwise',
  fontFamily = ''
}) => {
  const letters = Array.from(text);
  const controls = useAnimation();
  const rotation: MotionValue<number> = useMotionValue(0);

  // Convert radius to pixels if it's a string with units
  const getRadiusInPixels = (): number => {
    if (typeof radius === 'number') {
      return radius;
    }

    // Parse string radius values
    const value = parseFloat(radius);
    
    if (radius.endsWith('rem')) {
      // Get root font size (typically 16px, but respect user settings)
      const rootFontSize = parseFloat(getComputedStyle(document.documentElement).fontSize);
      return value * rootFontSize;
    } else if (radius.endsWith('vw')) {
      // Viewport width percentage
      return (value / 100) * window.innerWidth;
    } else if (radius.endsWith('vh')) {
      // Viewport height percentage
      return (value / 100) * window.innerHeight;
    } else if (radius.endsWith('px')) {
      // Already in pixels
      return value;
    }
    
    // Default: treat as pixels
    return value || 100;
  };

  const radiusInPixels = getRadiusInPixels();

  // Calculate container size based on radius (add padding for letter height)
  const containerSize = radiusInPixels * 2 + 80;

  useEffect(() => {
    const start = rotation.get();
    const rotationMultiplier = direction === 'clockwise' ? 1 : -1;
    controls.start({
      rotate: start + (360 * rotationMultiplier),
      scale: 1,
      transition: getTransition(spinDuration, start)
    });
  }, [spinDuration, text, onHover, controls, direction]);

  const handleHoverStart = () => {
    if (!onHover || onHover === 'none') return;

    const start = rotation.get();
    const rotationMultiplier = direction === 'clockwise' ? 1 : -1;

    let transitionConfig: ReturnType<typeof getTransition> | Transition;
    let scaleVal = 1;

    switch (onHover) {
      case 'slowDown':
        transitionConfig = getTransition(spinDuration * 2, start);
        break;
      case 'speedUp':
        transitionConfig = getTransition(spinDuration / 4, start);
        break;
      case 'pause':
        transitionConfig = {
          rotate: { type: 'spring', damping: 20, stiffness: 300 },
          scale: { type: 'spring', damping: 20, stiffness: 300 }
        };
        break;
      case 'goBonkers':
        transitionConfig = getTransition(spinDuration / 20, start);
        scaleVal = 0.8;
        break;
      default:
        transitionConfig = getTransition(spinDuration, start);
    }

    controls.start({
      rotate: start + (360 * rotationMultiplier),
      scale: scaleVal,
      transition: transitionConfig
    });
  };

  const handleHoverEnd = () => {
    if (!onHover || onHover === 'none') return;

    const start = rotation.get();
    const rotationMultiplier = direction === 'clockwise' ? 1 : -1;
    controls.start({
      rotate: start + (360 * rotationMultiplier),
      scale: 1,
      transition: getTransition(spinDuration, start)
    });
  };

  return (
    <motion.div
      className={`m-0 mx-auto rounded-full relative text-center cursor-pointer origin-center ${className}`}
      style={{ 
        rotate: rotation,
        width: `${containerSize}px`,
        height: `${containerSize}px`
      }}
      initial={{ rotate: 0 }}
      animate={controls}
      onMouseEnter={handleHoverStart}
      onMouseLeave={handleHoverEnd}
    >
      {letters.map((letter, i) => {
        // Calculate angle for this letter with optional additional spacing
        const baseAngleDeg = (360 / letters.length) * i;
        const adjustedAngleDeg = baseAngleDeg + (letterSpacing * i);
        
        // Convert to radians for trigonometry
        const angleRad = (adjustedAngleDeg * Math.PI) / 180;
        
        // Calculate position on circle using trigonometry (using pixel radius)
        const x = Math.cos(angleRad) * radiusInPixels;
        const y = Math.sin(angleRad) * radiusInPixels;
        
        // Rotate each letter to face outward from center
        const letterRotation = adjustedAngleDeg + 90;
        
        const transform = `translate(${x}px, ${y}px) rotate(${letterRotation}deg)`;

        return (
          <span
            key={i}
            className={`absolute inline-block transition-all duration-500 ease-[cubic-bezier(0,0,0,1)] ${fontSize} ${textColor} ${fontWeight} ${fontFamily}`}
            style={{ 
              transform, 
              WebkitTransform: transform,
              left: '50%',
              top: '50%',
              marginLeft: '0',
              marginTop: '0'
            }}
          >
            {letter}
          </span>
        );
      })}
    </motion.div>
  );
};

export default CircularText;