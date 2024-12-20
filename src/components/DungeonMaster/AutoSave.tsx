import React, { useState, useEffect, useRef } from 'react';

export default function AutoSave({ onSave, isRoomCreator }: { onSave: () => void, isRoomCreator: boolean }) {
  const [secondsUntilSave, setSecondsUntilSave] = useState(300); // Start at 5 minutes
  const shouldSaveRef = useRef(false);

  useEffect(() => {
    if (!isRoomCreator) return;

    const interval = setInterval(() => {
      setSecondsUntilSave(prev => {
        if (prev <= 1) {
          shouldSaveRef.current = true;
          console.log("Autosaved successfully");
          return 300; // Reset to 5 minutes
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [isRoomCreator]);

  // Separate effect for handling saves
  useEffect(() => {
    if (shouldSaveRef.current) {
      onSave();
      shouldSaveRef.current = false;
    }
  }, [secondsUntilSave, onSave]);

  if (!isRoomCreator) return null;

  const minutes = Math.floor(secondsUntilSave / 60);
  const seconds = secondsUntilSave % 60;
  const timeString = `${minutes}:${seconds.toString().padStart(2, '0')}`;

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => {
          onSave();
          setSecondsUntilSave(300); // Reset to 5 minutes after manual save
        }}
        className="px-3 py-0.5 text-[1.5vmin] bg-offwhite text-grey border-2 dark:border-offwhite border-grey rounded-r-md hover:bg-grey/25 dark:hover:bg-offwhite/75 transition-colors"
      >
        Save Game
      </button>
      <span className="text-[1.5vmin] text-grey dark:text-offwhite opacity-50">
        Auto-save in {timeString}
      </span>
    </div>
  );
}