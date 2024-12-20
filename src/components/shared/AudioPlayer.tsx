import React, { useEffect, useRef, useState } from 'react';
import { GameState } from '../../types/game';

declare global {
  interface Window {
    YT: {
      Player: any;
      PlayerState: any;
    };
    onYouTubeIframeAPIReady: () => void;
  }
}

interface AudioPlayerProps {
  gameState: GameState;
  isDM?: boolean;
}

export function AudioPlayer({ gameState, isDM = false }: AudioPlayerProps) {
  const playerRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const playerElementId = useRef(`youtube-player-${Math.random().toString(36).substr(2, 9)}`);
  const [isAPIReady, setIsAPIReady] = useState(false);

  // Load YouTube API
  useEffect(() => {
    // Reset state when component mounts
    setIsAPIReady(false);

    if (window.YT) {
      setIsAPIReady(true);
      return;
    }

    const loadAPI = () => {
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      const firstScriptTag = document.getElementsByTagName('script')[0];
      firstScriptTag.parentNode?.insertBefore(tag, firstScriptTag);
    };

    window.onYouTubeIframeAPIReady = () => {
      setIsAPIReady(true);
    };

    loadAPI();

    return () => {
      window.onYouTubeIframeAPIReady = () => {};
    };
  }, []);

  // Cleanup function
  const cleanupPlayer = () => {
    try {
      if (playerRef.current?.destroy) {
        playerRef.current.destroy();
      }
      // Manually remove the iframe if it exists
      const iframe = document.getElementById(playerElementId.current);
      if (iframe?.parentNode) {
        iframe.parentNode.removeChild(iframe);
      }
      playerRef.current = null;
    } catch (error) {
      console.error('Error cleaning up YouTube player:', error);
    }
  };

  // Initialize player
  useEffect(() => {
    if (!isAPIReady || !containerRef.current || !window.YT) return;

    // Clean up any existing player first
    cleanupPlayer();

    // Create a new div for the player
    const playerDiv = document.createElement('div');
    playerDiv.id = playerElementId.current;
    containerRef.current.appendChild(playerDiv);

    try {
      playerRef.current = new window.YT.Player(playerElementId.current, {
        height: '0',
        width: '0',
        playerVars: {
          autoplay: 0,
          controls: 0,
          disablekb: 1,
          fs: 0,
          modestbranding: 1,
          playsinline: 1,
          quality: 'small',
        },
        events: {
          onReady: () => {
            console.log('YouTube player ready');
            if (playerRef.current?.setVolume) {
              playerRef.current.setVolume(gameState.audio.volume);
            }
          },
          onStateChange: (event: any) => {
            if (event.data === window.YT.PlayerState.ENDED) {
              if (playerRef.current?.getPlayerState) {
                playerRef.current.playVideo();
              }
            }
          },
          onError: (event: any) => {
            console.error('YouTube player error:', event);
            cleanupPlayer();
          }
        }
      });
    } catch (error) {
      console.error('Failed to initialize YouTube player:', error);
      cleanupPlayer();
    }

    // Cleanup on unmount or when dependencies change
    return cleanupPlayer;
  }, [isAPIReady]);

  // Handle track changes
  useEffect(() => {
    if (!playerRef.current?.loadVideoById) return;

    const currentTrack = gameState.audio.playlist.find(
      track => track.id === gameState.audio.currentTrackId
    );

    try {
      if (!currentTrack || currentTrack.id === 'silence') {
        playerRef.current.stopVideo();
      } else {
        playerRef.current.loadVideoById({
          videoId: currentTrack.youtubeId,
          startSeconds: 0,
          suggestedQuality: 'small'
        });
      }
    } catch (error) {
      console.error('Error changing track:', error);
    }
  }, [gameState.audio.currentTrackId]);

  // Handle volume changes
  useEffect(() => {
    if (!playerRef.current?.setVolume) return;

    try {
      playerRef.current.setVolume(gameState.audio.volume);
    } catch (error) {
      console.error('Error setting volume:', error);
    }
  }, [gameState.audio.volume]);

  return (
    <div 
      ref={containerRef} 
      style={{ width: 0, height: 0, overflow: 'hidden', position: 'absolute' }}
      data-testid="audio-player-container"
    />
  );
}