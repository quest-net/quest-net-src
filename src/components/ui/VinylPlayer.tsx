import React, { useState, useEffect } from 'react';
import { Play, Square } from 'lucide-react';
import {ReactComponent as RecordPattern} from '../ui/record_pattern.svg';

interface VinylPlayerProps {
  currentTrack?: {
    id: string;
    name: string;
  };
  isPlaying: boolean;
  onPlayPause: () => void;
  volume: number;
  onVolumeChange: (value: number) => void;
}

const VerticalVolumeSlider = ({ value, onChange }: { value: number; onChange: (value: number) => void }) => (

    
    <div className="flex flex-col items-center justify-center gap-2 h-full w-full relative">
      {/* Container for the rotated slider */}
      <div className="absolute top-[88%] left-[85%] w-[39vh] h-[8%] 
        -rotate-90 origin-left ">
        <input
  type="range"
  min="0"
  max="100"
  step="10"
  value={value}
  onChange={(e) => onChange(Number(e.target.value))}
  style={{
    background: `linear-gradient(to right, var(--color-blue) ${value}%, var(--color-bg) ${value}%)`
  }}
  className="absolute top-0 left-0 w-full h-4 rounded appearance-none border-4 border-blue dark:border-cyan
    [&::-webkit-slider-thumb]:appearance-none
    [&::-webkit-slider-thumb]:w-5
    [&::-webkit-slider-thumb]:h-12
    [&::-webkit-slider-thumb]:rounded-full
    [&::-webkit-slider-thumb]:bg-offwhite
    [&::-webkit-slider-thumb]:dark:bg-grey
    [&::-webkit-slider-thumb]:cursor-pointer
    [&::-webkit-slider-thumb]:shadow-[0_0_0_4px_#0002FB]
    [&::-webkit-slider-thumb]:dark:shadow-[0_0_0_4px_#00FBD1]
    [&::-webkit-slider-thumb]:transition-[background-color,box-shadow]
    [&::-webkit-slider-thumb:hover]:bg-blue
    [&::-webkit-slider-thumb:hover]:dark:bg-cyan
    [&::-webkit-slider-thumb:active]:bg-blue
    [&::-webkit-slider-thumb:active]:dark:bg-cyan
    [&::-moz-range-thumb]:w-5
    [&::-moz-range-thumb]:h-12
    [&::-moz-range-thumb]:rounded-full
    [&::-moz-range-thumb]:bg-offwhite
    [&::-moz-range-thumb]:dark:bg-grey
    [&::-moz-range-thumb]:cursor-pointer
    [&::-moz-range-thumb]:border-4
    [&::-moz-range-thumb]:border-blue
    [&::-moz-range-thumb]:dark:border-cyan
    [&::-moz-range-thumb]:transition-colors
    [&::-moz-range-thumb:hover]:bg-blue
    [&::-moz-range-thumb:hover]:dark:bg-cyan
    [&::-moz-range-thumb:active]:bg-blue
    [&::-moz-range-thumb:active]:dark:bg-cyan
    [&::-webkit-slider-runnable-track]:rounded-full
    [&::-moz-range-track]:rounded-full
    dark:[&::-moz-range-track]:bg-grey"
/>
      </div>
      {/* Volume percentage - not rotated */}
      <div className="absolute bottom-0 left-1/2 -translate-x-1/2">
        <span className="font-['Mohave'] text-lg">{value}%</span>
      </div>
    </div>
  );

export default function VinylPlayer({ currentTrack, isPlaying, onPlayPause, volume, onVolumeChange }: VinylPlayerProps) {
  const [rotation, setRotation] = useState(0);

  // Rotate the record continuously when playing
  useEffect(() => {
    let animationFrame: number;
    let lastTimestamp: number;
    const rotateSpeed = 0.05; // Rotations per second

    const animate = (timestamp: number) => {
      if (!lastTimestamp) lastTimestamp = timestamp;
      const delta = timestamp - lastTimestamp;
      
      if (isPlaying) {
        setRotation(prev => (prev + rotateSpeed * delta) % 360);
      }
      
      lastTimestamp = timestamp;
      animationFrame = requestAnimationFrame(animate);
    };

    if (isPlaying) {
      animationFrame = requestAnimationFrame(animate);
    }

    return () => {
      if (animationFrame) {
        cancelAnimationFrame(animationFrame);
      }
    };
  }, [isPlaying]);

  return (
    <div className="relative w-full h-full border-4 border-grey dark:border-offwhite rounded-lg overflow-hidden">
      {/* Record player base */}
      <div className="absolute inset-4">
        <div className="absolute inset-0 left-[15%] top-[15%]">
          <RecordPattern className="w-full h-full text-grey dark:text-offwhite scale-[200%]" />
        </div>

        {/* Volume Slider - positioned on the far right */}
        <div className="absolute w-[8%] top-[5%] right-[2%] h-[60%] bg-offwhite dark:bg-grey dark:border-cyan border-blue border-4 rounded-xl p-4">
          <VerticalVolumeSlider value={volume} onChange={onVolumeChange} />
        </div>
        {/* Vinyl record */}
        <div 
          className={`
            absolute top-2 left-2 w-[calc(85%-1rem)] overflow-hidden aspect-square rounded-full bg-grey dark:bg-black
            transform
          `}
          style={{ 
            transform: `rotate(${rotation}deg)`,
            transformOrigin: 'center',
          }}
        >
          {/* Grooves */}
          <div className="absolute inset-0">
            {/* Create 6 concentric circles with varying sizes */}
            <div className="absolute inset-[26%] border-[0.5rem] border-offwhite rounded-full" />
            <div className="absolute inset-[22%] border-[0.5rem] border-offwhite rounded-full" />
            <div className="absolute inset-[18%] border-[0.5rem] border-offwhite rounded-full" />
            <div className="absolute inset-[14%] border-[0.5rem] border-offwhite rounded-full" />
            <div className="absolute inset-[10%] border-[0.5rem] border-offwhite rounded-full" />
            <div className="absolute inset-[6%] border-[0.5rem] border-offwhite rounded-full" />
            
            {/* Overlay to mask part of the circles */}
            <div 
              className="absolute inset-0 bg-grey dark:bg-black origin-center"
              style={{
                clipPath: 'polygon(0% 0%, 50% 0%, 50% 50%,100% 50%,100% 100%, 0 100%)'
              }}
            />
          </div>

          {/* Center label */}
          <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-1/3 aspect-square rounded-full bg-offwhite dark:bg-offwhite flex items-center justify-center">
            <div 
              className="text-grey dark:text-grey text-center font-['Mohave'] text-2xl font-bold px-4"
              style={{ 
                transformOrigin: 'center',
              }}
            >
              {currentTrack?.name || 'Silence'}
            </div>
          </div>
        </div>
        
        {/* Tone Arm */}
        <div 
          className="absolute bottom-[10%] right-[18.5%] w-[45%] h-[2%] origin-right "
          style={{
            transform: 'rotate(0deg)',
          }}
        >
          {/* Main arm */}
          <div className="absolute right-0 w-[61%] h-full bg-blue dark:bg-cyan rounded-full" />
          
          {/* bent part */}
          <div className="absolute left-0 top-[10%] origin-bottom-right w-[41%] h-full rounded-full bg-blue dark:bg-cyan"
          style={{
            transform: 'rotate(30deg)',}} />
            {/* needle part */}
            <div className="absolute -left-[15%] -top-[550%] w-[20%] origin-bottom-right h-[300%] rounded-xl bg-offwhite"
          style={{
            transform: 'rotate(30deg)',}} />
        </div>

        {/* Play/Stop button */}
        <button
          onClick={onPlayPause}
          className="absolute bottom-[2.5%] right-[2.5%] w-[17.5%] h-[17.5%] rounded-full border-[16px] border-blue dark:border-cyan bg-offwhite dark:bg-grey flex items-center justify-center transition-colors hover:bg-white dark:hover:bg-black"
        >
          {isPlaying ? (
            <Square className="w-[70%] h-[70%]  text-blue dark:text-cyan" />
          ) : (
            <Play className="w-[70%] h-[70%]  text-blue dark:text-cyan" />
          )}
        </button>
      </div>
    </div>
  );
}