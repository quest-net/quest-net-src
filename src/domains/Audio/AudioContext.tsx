// domains/Audio/AudioContext.tsx
import { createContext, useContext, useState, ReactNode } from "react";

interface AudioContextValue {
  currentTrackIndex: number;
  setCurrentTrackIndex: (index: number) => void;
}

const AudioContext = createContext<AudioContextValue | null>(null);

export function AudioStateProvider({ children }: { children: ReactNode }) {
  const [currentTrackIndex, setCurrentTrackIndex] = useState(0);

  return (
    <AudioContext.Provider value={{ currentTrackIndex, setCurrentTrackIndex }}>
      {children}
    </AudioContext.Provider>
  );
}

export function useAudioState() {
  const context = useContext(AudioContext);
  if (!context) {
    throw new Error("useAudioState must be used within AudioStateProvider");
  }
  return context;
}