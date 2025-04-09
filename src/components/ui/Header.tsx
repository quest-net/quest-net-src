import React from 'react';
import { SlidingToggle } from './ThemeToggle';
import type { ConnectionStatusType } from '../../types/connection';
import DiceRoller from '../shared/DiceRoller';

interface HeaderProps {
  roomId?: string;
  connectionStatus?: ConnectionStatusType;
  peers?: string[];
  errorMessage?: string;
  onRoll?: (result: number, maxValue: number) => void;
}

export function Header({ roomId, connectionStatus, peers = [], errorMessage, onRoll }: HeaderProps) {
  const getStatusColor = () => {
    switch (connectionStatus) {
      case 'connected':
        return 'var(--color-blue)';
      case 'connecting':
      case 'reconnecting':
        return 'var(--color-purple)';
      case 'error':
        return 'var(--color-magenta)';
      default:
        return 'var(--color-text)';
    }
  };

  const getConnectionStatusDisplay = () => {
    if (!connectionStatus || !roomId) return null;
    
    const statusText = connectionStatus === 'connected'
      ? `Connected ${peers.length === 0 
          ? "(No other peers)" 
          : `(${peers.length} peer${peers.length === 1 ? '' : 's'})`}`
      : connectionStatus === 'connecting'
      ? "Connecting..."
      : connectionStatus === 'reconnecting'
      ? "Reconnecting..."
      : connectionStatus === 'error'
      ? `Error: ${errorMessage}`
      : "Disconnected";

    const currentColor = getStatusColor();

    return (
      <div className="flex gap-0 mt-2 items-center">
        <div 
          className="flex items-center gap-2 font-bold px-2 rounded-l-md text-[1.8vmin] font-['Mohave'] transition-colors duration-300"
          style={{
            color: currentColor
          }}
        >
          <div 
            className={`w-2 h-2 rounded-full transition-colors  duration-300 ${
              (connectionStatus === 'connecting' || connectionStatus === 'reconnecting') 
                ? 'animate-pulse' 
                : ''
            }`}
            style={{ backgroundColor: currentColor }}
          />
          <span>{statusText}</span>
        </div>

        {roomId && (
          <div 
            className="text-[1.8vmin] font-['Mohave'] font-bold px-3 rounded-r-md transition-colors duration-300"
            style={{
                color: 'var(--color-blue)',
             }}
          >
            | Room: {roomId}
          </div>
        )}
      </div>
    );
  };
  const getRightElement = () => {
    if (!roomId) {
      return <SlidingToggle/>;
    }
    return <DiceRoller onRoll={onRoll} />;
  };

  return (
    <div className="Header">
      <div className="title-container flex items-center">
        <div className="flex flex-col items-start">
          <div className="flex flex-row items-center">
            <h1 className="headerTitle">Quest-Net</h1>
            {getConnectionStatusDisplay()}
          </div>
          <svg 
            className="headerLine fill-[#333233] dark:fill-[#F2EEE4]" 
            width="825" 
            height="42" 
            viewBox="0 0 825 42" 
            xmlns="http://www.w3.org/2000/svg"
          >
            <path d="M0.792741 21L21 41.2073L41.2073 21L21 0.792741L0.792741 21ZM821 24.5C822.933 24.5 824.5 22.933 824.5 21C824.5 19.067 822.933 17.5 821 17.5V24.5ZM21 24.5H821V17.5H21V24.5Z"/>
          </svg>
          
        </div>
      </div>
        {getRightElement()}
    </div>
  );
}