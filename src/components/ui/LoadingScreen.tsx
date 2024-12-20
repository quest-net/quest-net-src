import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';

interface LoadingScreenProps {
  message: string;
}

export default function LoadingScreen({ message }: LoadingScreenProps) {
  const [rotation, setRotation] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setRotation((prev) => prev + 60);
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  // Animation variants for the wave effect
  const textVariants = {
    hidden: { opacity: 100, y: 20 },
    visible: (i: number) => ({
      opacity: 1,
      y: 0,
      transition: {
        delay: i * 0.2, // Staggered delay
        duration: 1.0,
        ease: "circInOut",
        repeat: Infinity,
        repeatType: "reverse" as const, // Explicitly set type
      },
    }),
  };

  return (
    <div className="h-full flex flex-col items-center justify-center">
      <motion.svg
        width="128"
        height="128"
        viewBox="0 0 57 64"
        className="mb-6 fill-blue dark:fill-cyan"
        animate={{ rotate: rotation }}
        transition={{ duration: 0.2, ease: 'linear' }}
      >
        <path d="M26 1.44338C27.547 0.550212 29.453 0.550212 31 1.44338L54.1458 14.8066C55.6928 15.6998 56.6458 17.3504 56.6458 19.1368V45.8632C56.6458 47.6496 55.6928 49.3002 54.1458 50.1934L31 63.5566C29.453 64.4498 27.547 64.4498 26 63.5566L2.85417 50.1934C1.30717 49.3002 0.354174 47.6496 0.354174 45.8632V19.1368C0.354174 17.3504 1.30717 15.6998 2.85417 14.8066L26 1.44338Z" />
      </motion.svg>

      <div className="flex">
        {message.split(/(?=.)/).map((char, index) => (
          <motion.span
            key={index}
            custom={index}
            variants={textVariants}
            initial="hidden"
            animate="visible"
            className="text-grey dark:text-offwhite font-['Mohave'] font-semibold tracking-widest text-2xl"
          >
            {char === ' ' ? '\u00A0' : char} {/* Preserve spaces */}
          </motion.span>
        ))}
      </div>
    </div>
  );
}
