// src/components/RoomSelector.tsx
import React from 'react';
import type { SavedRoomInfo } from '../types/game';

interface RoomSelectorProps {
  roomId: string;
  setRoomId: (id: string) => void;
  savedRooms: SavedRoomInfo[];
  onCreateRoom: () => void;
  onJoinRoom: () => void;
  onDeleteRoom: (roomId: string) => void;
}

export function RoomSelector({
  roomId,
  setRoomId,
  savedRooms,
  onCreateRoom,
  onJoinRoom,
  onDeleteRoom
}: RoomSelectorProps) {
  return (
    <div style={{ padding: '1rem', maxWidth: '40rem', margin: '0 auto' }}>
      <h1>Multiplayer Game Room</h1>
      
      <div style={{ marginBottom: '2rem' }}>
        <input
          type="text"
          value={roomId}
          onChange={(e) => setRoomId(e.target.value)}
          placeholder="Enter room name"
          style={{
            width: '100%',
            padding: '0.5rem',
            marginBottom: '1rem',
            border: '1px solid #d1d5db',
            borderRadius: '0.375rem',
          }}
        />
        <div style={{ display: 'flex', gap: '1rem' }}>
          <button
            onClick={onCreateRoom}
            disabled={!roomId.trim()}
            style={{
              padding: '0.5rem 1rem',
              backgroundColor: '#3b82f6',
              color: '#ffffff',
              border: 'none',
              borderRadius: '0.375rem',
              cursor: roomId.trim() ? 'pointer' : 'not-allowed',
              opacity: roomId.trim() ? 1 : 0.5
            }}
          >
            Create Room
          </button>
          <button
            onClick={onJoinRoom}
            disabled={!roomId.trim()}
            style={{
              padding: '0.5rem 1rem',
              backgroundColor: '#22c55e',
              color: '#ffffff',
              border: 'none',
              borderRadius: '0.375rem',
              cursor: roomId.trim() ? 'pointer' : 'not-allowed',
              opacity: roomId.trim() ? 1 : 0.5
            }}
          >
            Join Room
          </button>
        </div>
      </div>

      {savedRooms.length > 0 && (
        <div>
          <h2 style={{ 
            fontSize: '1.25rem', 
            fontWeight: 'bold', 
            marginBottom: '1rem',
            borderBottom: '1px solid #e5e7eb',
            paddingBottom: '0.5rem'
          }}>
            Saved Games
          </h2>
          <div style={{ 
            display: 'flex', 
            flexDirection: 'column',
            gap: '0.75rem'
          }}>
            {savedRooms.map((room) => (
              <div
                key={room.roomId}
                style={{
                  padding: '1rem',
                  backgroundColor: '#f9fafb',
                  borderRadius: '0.5rem',
                  border: '1px solid #e5e7eb'
                }}
              >
                <div style={{ 
                  display: 'flex', 
                  justifyContent: 'space-between', 
                  alignItems: 'center',
                  marginBottom: '0.5rem'
                }}>
                  <h3 style={{ 
                    fontSize: '1.1rem', 
                    fontWeight: 'bold',
                    margin: 0
                  }}>
                    {room.roomId}
                  </h3>
                  <span style={{ 
                    fontSize: '0.875rem', 
                    color: '#6b7280'
                  }}>
                    Last modified: {room.lastModified.toLocaleDateString()} {room.lastModified.toLocaleTimeString()}
                  </span>
                </div>
                
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button
                    onClick={() => {
                      setRoomId(room.roomId);
                      onCreateRoom();
                    }}
                    style={{
                      padding: '0.375rem 0.75rem',
                      backgroundColor: '#3b82f6',
                      color: '#ffffff',
                      border: 'none',
                      borderRadius: '0.375rem',
                      fontSize: '0.875rem',
                      cursor: 'pointer'
                    }}
                  >
                    Resume as Host
                  </button>
                  <button
                    onClick={() => {
                      setRoomId(room.roomId);
                      onJoinRoom();
                    }}
                    style={{
                      padding: '0.375rem 0.75rem',
                      backgroundColor: '#22c55e',
                      color: '#ffffff',
                      border: 'none',
                      borderRadius: '0.375rem',
                      fontSize: '0.875rem',
                      cursor: 'pointer'
                    }}
                  >
                    Join as Player
                  </button>
                  <button
                    onClick={() => onDeleteRoom(room.roomId)}
                    style={{
                      padding: '0.375rem 0.75rem',
                      backgroundColor: '#ef4444',
                      color: '#ffffff',
                      border: 'none',
                      borderRadius: '0.375rem',
                      fontSize: '0.875rem',
                      cursor: 'pointer',
                      marginLeft: 'auto'
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}