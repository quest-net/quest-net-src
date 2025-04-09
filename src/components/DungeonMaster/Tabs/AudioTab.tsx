import React, { useState } from 'react';
import { Plus, Trash2, GripVertical } from 'lucide-react';
import { DMViewProps, AudioTrack } from '../../../types/game';
import { Reorder } from 'framer-motion';
import VinylPlayer from '../../ui/VinylPlayer';
import Modal from '../../shared/Modal';
import {ReactComponent as Audio} from '../../ui/audio.svg';


const colorOptions = [
  { name: '⚪', value: 'bg-offwhite/60 dark:bg-grey/60' },
  { name: '🔵', value: 'bg-blue-200/60' },
  { name: '🟣', value: 'bg-purple-200/60' },
  { name: '🔴', value: 'bg-red-200/60' }
];

function isValidYoutubeUrl(url: string) {
  const pattern = /^(?:https?:\/\/)?(?:www\.|m\.)?(youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]+).*$/;
  return pattern.test(url);
}

function extractYoutubeId(url: string) {
  const fullPattern = /(?:youtube\.com\/(?:watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11}))/;
  const match = url.match(fullPattern);
  return match ? match[1] : null;
}

async function getVideoTitle(url: string): Promise<string | null> {
  try {
    const videoId = extractYoutubeId(url);
    if (!videoId) return null;

    const response = await fetch(`https://noembed.com/embed?url=https://www.youtube.com/watch?v=${videoId}`);
    const data = await response.json();
    return data.title || null;
  } catch (error) {
    console.error('Failed to fetch video title:', error);
    return null;
  }
}

export function AudioTab({ gameState, onGameStateChange }: DMViewProps) {
  const [showAddTrackModal, setShowAddTrackModal] = useState(false);
  const [newTrackUrl, setNewTrackUrl] = useState('');
  const [newTrackName, setNewTrackName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [lastPlayedTrackId, setLastPlayedTrackId] = useState<string | null>(null);

  const currentTrack = gameState.audio.playlist.find(
    track => track.id === gameState.audio.currentTrackId
  );

  const handlePlayPause = () => {
    if (gameState.audio.currentTrackId === 'silence' && lastPlayedTrackId) {
      // Resume last played track
      onGameStateChange({
        ...gameState,
        audio: {
          ...gameState.audio,
          currentTrackId: lastPlayedTrackId
        }
      });
    } else {
      // Stop playing and store last played track
      setLastPlayedTrackId(gameState.audio.currentTrackId);
      onGameStateChange({
        ...gameState,
        audio: {
          ...gameState.audio,
          currentTrackId: 'silence'
        }
      });
    }
  };

  const handleAddTrack = async () => {
    setError(null);
    setIsLoading(true);

    try {
      if (!isValidYoutubeUrl(newTrackUrl)) {
        setError('Invalid YouTube URL');
        return;
      }

      const youtubeId = extractYoutubeId(newTrackUrl);
      if (!youtubeId) {
        setError('Could not extract YouTube video ID');
        return;
      }

      let trackName = newTrackName;
      if (!trackName.trim()) {
        const title = await getVideoTitle(newTrackUrl);
        if (title) {
          trackName = title;
        } else {
          trackName = 'Untitled Track';
        }
      }

      const newTrack: AudioTrack = {
        id: crypto.randomUUID(),
        youtubeId,
        name: trackName,
        url: newTrackUrl,
        status: 'loading',
        color: colorOptions[0].value
      };

      onGameStateChange({
        ...gameState,
        audio: {
          ...gameState.audio,
          playlist: [...gameState.audio.playlist, newTrack]
        }
      });

      setNewTrackUrl('');
      setNewTrackName('');
      setShowAddTrackModal(false);
    } catch (error) {
      setError('Failed to add track. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteTrack = (trackId: string) => {
    if (trackId === 'silence') return;

    onGameStateChange({
      ...gameState,
      audio: {
        ...gameState.audio,
        currentTrackId: gameState.audio.currentTrackId === trackId ? 'silence' : gameState.audio.currentTrackId,
        playlist: gameState.audio.playlist.filter(track => track.id !== trackId)
      }
    });
  };

  return (
    <div className="relative w-full h-full p-4 flex gap-4">
        <div className="absolute inset-0  pointer-events-none -z-10">
            <Audio className="absolute -bottom-[80%] scale-75 -right-1/3 fill-grey/40 dark:fill-offwhite/40 "/>
        </div>
      {/* Left side - Vinyl Player */}
      <div className="w-1/2 flex items-center justify-center  transition-colors duration-1000">
        <div className="h-full aspect-square bg-offwhite dark:bg-grey">
          <VinylPlayer
            currentTrack={currentTrack}
            isPlaying={gameState.audio.currentTrackId !== 'silence'}
            onPlayPause={handlePlayPause}
            volume={gameState.audio.volume}
            onVolumeChange={(newVolume) => {
                onGameStateChange({
                  ...gameState,
                  audio: {
                    ...gameState.audio,
                    volume: newVolume
                  }
                });
              }}
          />
        </div>
      </div>
      <div className="w-1/2 flex flex-col pr-16">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl px-8 py-2 rounded-lg bg-grey dark:bg-offwhite text-offwhite dark:text-grey font-['BrunoAceSC']">Playlist</h2>
          <button
            onClick={() => setShowAddTrackModal(true)}
            className="px-4 py-2 rounded-full 
            bg-offwhite dark:bg-grey
            text-blue dark:text-cyan 
            border-2 border-blue dark:border-cyan border-b-4
            active:border-b-2
            active:bg-blue dark:active:bg-cyan
            active:text-offwhite dark:active:text-grey
            transition-all duration-75 text-lg
            flex items-center gap-2 font-['Mohave']" 
            >
            <Plus className="w-5 h-5" />
            Add Track
          </button>
        </div>

        <Reorder.Group
          axis="y"
          values={gameState.audio.playlist}
          onReorder={(newPlaylist) => {
            onGameStateChange({
              ...gameState,
              audio: {
                ...gameState.audio,
                playlist: newPlaylist
              }
            });
          }}
          className="flex-1 space-y-2 overflow-y-auto scrollable"
        >
          {gameState.audio.playlist.map((track) => (
            <Reorder.Item
              key={track.id}
              id={track.id}
              value={track}
              className={`
                rounded-lg p-4 flex items-center shadow-md gap-4
                ${track.color || colorOptions[0].value}
                ${track.id === gameState.audio.currentTrackId ? 'border-2 border-blue dark:border-cyan' : 'border-2 border-grey dark:border-offwhite'}
                transition-colors
              `}
            >
              <GripVertical className="cursor-move w-5 h-5 opacity-50" />
              <button
                className="flex-1 text-left font-['Mohave'] text-lg"
                onClick={() => {
                  onGameStateChange({
                    ...gameState,
                    audio: {
                      ...gameState.audio,
                      currentTrackId: track.id
                    }
                  });
                }}
              >
                {track.name}
              </button>

              {track.id !== 'silence' && (
                <>
                  <select
                    value={track.color || colorOptions[0].value}
                    onChange={(e) => {
                      onGameStateChange({
                        ...gameState,
                        audio: {
                          ...gameState.audio,
                          playlist: gameState.audio.playlist.map(t =>
                            t.id === track.id ? { ...t, color: e.target.value } : t
                          )
                        }
                      });
                    }}
                    className="bg-offwhite/50 dark:bg-grey/50 border-none text-grey dark:text-offwhite 
                      [&>option]:text-grey [&>option]:bg-offwhite 
                      dark:[&>option]:text-offwhite dark:[&>option]:bg-grey"
                  >
                    {colorOptions.map(option => (
                      <option key={option.value} value={option.value}>
                        {option.name}
                      </option>
                    ))}
                  </select>

                  <button
                    onClick={() => handleDeleteTrack(track.id)}
                    className="p-2 hover:bg-red-500/10 rounded-lg transition-colors"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                </>
              )}
            </Reorder.Item>
          ))}
        </Reorder.Group>
      </div>

      {/* Add Track Modal */}
      <Modal
        isOpen={showAddTrackModal}
        onClose={() => setShowAddTrackModal(false)}
        title="Add New Track"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-md font-medium mb-1 font-['Mohave']">Track Name (Optional)</label>
            <input
              type="text"
              value={newTrackName}
              onChange={(e) => setNewTrackName(e.target.value)}
              placeholder="Enter track name..."
              className=" font-['Mohave'] w-full px-4 py-2 rounded-lg border-2 border-grey dark:border-offwhite bg-transparent"
            />
          </div>
          <div>
            <label className="block text-md font-medium mb-1 font-['Mohave']">YouTube URL</label>
            <input
              type="text"
              value={newTrackUrl}
              onChange={(e) => setNewTrackUrl(e.target.value)}
              placeholder="https://youtube.com/watch?v=..."
              className=" font-['Mohave'] w-full px-4 py-2 rounded-lg border-2 border-grey dark:border-offwhite bg-transparent"
            />
          </div>
          {error && (
            <div className="text-red-500 dark:text-red-400 text-sm">
              {error}
            </div>
          )}
          <div className="flex justify-end gap-2 mt-4">
            <button
              onClick={() => setShowAddTrackModal(false)}
              className="font-['Mohave'] px-4 py-2 rounded-lg border-2 border-grey dark:border-offwhite hover:bg-grey/10 dark:hover:bg-offwhite/10"
            >
              Cancel
            </button>
            <button
              onClick={handleAddTrack}
              disabled={isLoading}
              className=" font-['Mohave'] px-4 py-2 rounded-lg bg-blue hover:bg-blue-600 dark:bg-cyan dark:hover:bg-cyan-600 text-white dark:text-grey disabled:opacity-50"
            >
              {isLoading ? 'Adding...' : 'Add Track'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}