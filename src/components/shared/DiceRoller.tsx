import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface DiceType {
  sides: number;
  lightColor: string;
  darkColor: string;
  shape: 'hexagon' | 'pentagon' | 'square' | 'triangle' | 'circle';
}

const DICE_TYPES: DiceType[] = [
    { sides: 2, lightColor: '#333233', darkColor: '#F2EEE4', shape: 'circle' },
    { sides: 4, lightColor: '#262665', darkColor: '#B6F1DF', shape: 'triangle' },
    { sides: 6, lightColor: '#1A1A97', darkColor: '#79F5DB', shape: 'square' },
    { sides: 10, lightColor: '#0D0EC9', darkColor: '#3DF8D6', shape: 'pentagon' },
    { sides: 20, lightColor: '#0002fb', darkColor: '#00FBD1', shape: 'hexagon' }
  ];

export default function DiceRoller() {
  const [isExpanded, setIsExpanded] = useState(false);
  const [collapseTimer, setCollapseTimer] = useState<NodeJS.Timeout>();
  const [lastRoll, setLastRoll] = useState<number | null>(null);
  const [isRolling, setIsRolling] = useState(false);
  const [currentDice, setCurrentDice] = useState<number | null>(null);

  const handleMouseEnter = useCallback(() => {
    if (collapseTimer) {
      clearTimeout(collapseTimer);
    }
    setIsExpanded(true);
  }, [collapseTimer]);

  const handleMouseLeave = useCallback(() => {
    const timer = setTimeout(() => {
      setIsExpanded(false);
    }, 1000);
    setCollapseTimer(timer);
  }, []);

  const rollDice = useCallback((sides: number) => {
    if (isRolling) return;
    
    setIsRolling(true);
    setCurrentDice(sides);
    
    let duration = 1000;
    let intervals = 20;
    let count = 0;
    
    const rollInterval = setInterval(() => {
      count++;
      if (sides === 2) {
        setLastRoll(count % 2 + 1);
      } else {
        setLastRoll(Math.floor(Math.random() * sides) + 1);
      }
      
      if (count >= intervals) {
        clearInterval(rollInterval);
        setIsRolling(false);
        if (sides === 2) {
          setLastRoll(Math.random() < 0.5 ? 1 : 2);
        } else {
          setLastRoll(Math.floor(Math.random() * sides) + 1);
        }
      }
    }, duration / intervals);
  }, [isRolling]);

  useEffect(() => {
    return () => {
      if (collapseTimer) {
        clearTimeout(collapseTimer);
      }
    };
  }, [collapseTimer]);

  const renderDice = (dice: DiceType, index: number, totalDice: number, reverseIndex: number) => {
    // Responsive size classes for different screen sizes
    const sizeClasses = "w-12 h-12 sm:w-15 sm:h-15 md:w-16 md:h-16 lg:w-17 lg:h-17 xl:h-18 xl:w-18 2xl:h-19 2xl:w-19 3xl:h-20 3xl:w-20 4xl:w-21 4xl:h-21";
    const viewBoxSize = {
      base: 48,
      sm: 64,
      md: 80,
      lg: 96
    };
    
    let path = '';
    
    switch (dice.shape) {
      case 'hexagon':
        path = 'M26 1.44338C27.547 0.550212 29.453 0.550212 31 1.44338L54.1458 14.8066C55.6928 15.6998 56.6458 17.3504 56.6458 19.1368V45.8632C56.6458 47.6496 55.6928 49.3002 54.1458 50.1934L31 63.5566C29.453 64.4498 27.547 64.4498 26 63.5566L2.85417 50.1934C1.30717 49.3002 0.354174 47.6496 0.354174 45.8632V19.1368C0.354174 17.3504 1.30717 15.6998 2.85417 14.8066L26 1.44338Z';
        break;
      case 'pentagon':
        path = 'M29.9549 0.502028C30.9591 0.175738 32.0409 0.175739 33.0451 0.502028L49.0579 5.70492C50.0622 6.03121 50.9373 6.66704 51.5579 7.52128L61.4544 21.1426C62.0751 21.9969 62.4093 23.0256 62.4093 24.0815V40.9185C62.4093 41.9744 62.0751 43.0031 61.4544 43.8574L51.5579 57.4787C50.9373 58.333 50.0622 58.9688 49.0579 59.2951L33.0451 64.498C32.0409 64.8243 30.9591 64.8243 29.9549 64.498L13.9421 59.2951C12.9378 58.9688 12.0627 58.333 11.4421 57.4787L1.54558 43.8574C0.924937 43.0031 0.590664 41.9744 0.590664 40.9185V24.0815C0.590664 23.0256 0.924939 21.9969 1.54558 21.1426L11.4421 7.52128C12.0627 6.66704 12.9378 6.03121 13.9421 5.70492L29.9549 0.502028Z';
        break;
      case 'square':
        path = 'M0 3C0 1.34315 1.34315 0 3 0H52C53.6569 0 55 1.34315 55 3V52C55 53.6569 53.6569 55 52 55H3C1.34315 55 0 53.6569 0 52V3Z';
        break;
      case 'triangle':
        path = 'M26.7236 1.96428C28.1798 -0.654763 31.8202 -0.654761 33.2764 1.96429L59.4875 49.1071C60.9437 51.7262 59.1235 55 56.2111 55H3.78889C0.876545 55 -0.943669 51.7262 0.512504 49.1071L26.7236 1.96428Z';
        break;
      case 'circle':
        break;
    }

    const isD2 = dice.sides === 2;
    const showStar = isD2 && lastRoll === 1 && currentDice === 2;
    const showCircle = isD2 && (lastRoll === 2 || !lastRoll);
    const animationDelay = reverseIndex * 0.1;

    const getLabel = () => {
      if (!isD2) {
        if (lastRoll !== null && currentDice === dice.sides) {
          return lastRoll;
        }
        if (!isRolling) {
          return `D${dice.sides}`;
        }
      }
      return null;
    };

    const getFontSize = () => {
      // Responsive font sizes
      if (typeof window !== 'undefined') {
        if (window.innerWidth >= 1024) return "20";
        if (window.innerWidth >= 768) return "18";
        if (window.innerWidth >= 640) return "16";
        return "16";
      }
      return "16";
    };

    return (
        <motion.div
          key={dice.sides}
          className={`relative cursor-pointer ${sizeClasses}`}
          whileHover={{ scale: 1.1 }}
          onClick={() => rollDice(dice.sides)}
          initial={{ opacity: 0, x: 50 }}
          animate={{ 
            opacity: 1, 
            x: 0,
            transition: { 
              delay: animationDelay,
              duration: 0.2
            }
          }}
          exit={{ 
            opacity: 0, 
            x: 50,
            transition: { 
              delay: reverseIndex * 0.1,
              duration: 0.2
            }
          }}
        >
          {isD2 ? (
            <div className={`${sizeClasses} relative`}>
              {showStar ? (
                <svg className="w-full h-full" viewBox="0 0 60 60">
                  <circle 
                    cx="30" 
                    cy="30" 
                    r="27" 
                    stroke={dice.lightColor}
                    className="dark:stroke-[#F2EEE4] dark:fill-[#F2EEE4]" 
                    strokeWidth="2" 
                    fill={dice.lightColor}
                    
                  />
                  <g transform="translate(8, 5.5) scale(0.3)">
                    <path
                      fillRule="evenodd"
                      clipRule="evenodd"
                      d="M73.9271 0.496735V7.99768C73.9271 43.8244 73.9271 61.7378 85.0571 72.8678C96.187 83.9977 114.1 83.9977 149.927 83.9977L149.928 83.9978C114.101 83.9978 96.1875 83.9978 85.0575 95.1278C73.9276 106.258 73.9276 124.171 73.9276 159.998V167.499H73.9249C73.2534 167.499 72.5822 167.499 71.9111 167.499H73.9242V159.998C73.9242 124.171 73.9242 106.258 62.7943 95.1276C51.8891 84.2224 34.4715 84.0022 0.0723877 83.9977C34.472 83.9933 51.8896 83.7732 62.7949 72.8679C73.9249 61.7379 73.9249 43.8246 73.9249 7.9978V0.496735H73.9271Z"
                      fill="#F2EEE4"
                      className="dark:fill-[#333233]"
                    />
                  </g>
                </svg>
              ) : (
                <svg className="w-full h-full" viewBox="0 0 60 60">
                  <circle 
                    cx="30" 
                    cy="30" 
                    r="27" 
                    stroke={dice.lightColor}
                    className="dark:stroke-[#F2EEE4] dark:fill-[#F2EEE4]" 
                    strokeWidth="2" 
                    fill={dice.lightColor}
                    
                  />
                  <circle 
                    cx="30" 
                    cy="30" 
                    r="20" 
                    stroke="#F2EEE4"
                    className="dark:stroke-[#333233]" 
                    strokeWidth="2" 
                    fill="transparent"
                  />
                </svg>
              )}
            </div>
          ) : (
            <svg className="w-full h-full" viewBox="0 0 65 65">
  {dice.shape === 'square' ? (
    <>
      <path 
        d={path} 
        className="dark:hidden"
        fill={dice.lightColor}
        transform="translate(5, 5)"  // Centers the smaller square
      />
      <path 
        d={path} 
        className="hidden dark:block"
        fill={dice.darkColor}
        transform="translate(5, 5)"
      />
    </>
  ) : dice.shape === 'triangle' ? (
    <>
      <path 
        d={path} 
        className="dark:hidden"
        fill={dice.lightColor}
        transform="translate(2.5, 5)"  // Centers the triangle
      />
      <path 
        d={path} 
        className="hidden dark:block"
        fill={dice.darkColor}
        transform="translate(2.5, 5)"
      />
    </>
  ) : ( dice.shape === 'hexagon' ? (
    <>
      <path 
        d={path} 
        className="dark:hidden"
        fill={dice.lightColor}
        transform="translate(3, 0)"  // Centers the hexagon
      />
      <path 
        d={path} 
        className="hidden dark:block"
        fill={dice.darkColor}
        transform="translate(3, 0)"
      />
    </>
    ) :
    <>
      <path 
        d={path} 
        className="dark:hidden"
        fill={dice.lightColor}
      />
      <path 
        d={path} 
        className="hidden dark:block"
        fill={dice.darkColor}
      />
    </>
  )}
  <text
    x="32.5"
    y="35"
    textAnchor="middle"
    dominantBaseline="middle"
    className="fill-[#F2EEE4] dark:fill-[#333233] select-none"
    fontSize={getFontSize()}
    fontWeight="bold"
  >
    {getLabel()}
  </text>
</svg>
          )}
        </motion.div>
      );
    };
  
    return (
      <div
        className="flex items-center"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        <AnimatePresence>
          {isExpanded && (
            <motion.div className="flex gap-2 sm:gap-3 md:gap-4 lg:gap-6 mr-2 sm:mr-3 md:mr-4 lg:mr-6">
              {DICE_TYPES.slice(0, -1).map((dice, index, array) => {
                const reverseIndex = array.length - 1 - index;
                return renderDice(dice, index, array.length, reverseIndex);
              })}
            </motion.div>
          )}
        </AnimatePresence>
        {renderDice(DICE_TYPES[DICE_TYPES.length - 1], DICE_TYPES.length - 1, DICE_TYPES.length - 1, 0)}
      </div>
    );
  }