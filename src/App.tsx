import React, { useCallback } from 'react';
import './App.css';
import GameRoom from './GameRoom';
import { Header } from './components/ui/Header';
import { ConnectionStatusType } from './types/connection';
import { CustomCursor } from './components/ui/CustomCursor';

function App() {
  const [connectionStatus, setConnectionStatus] = React.useState<ConnectionStatusType | undefined>();
  const [connectionPeers, setConnectionPeers] = React.useState<string[]>([]);
  const [connectionError, setConnectionError] = React.useState<string>('');
  const [currentRoomId, setCurrentRoomId] = React.useState<string>('');

  // Handle connection updates from GameRoom
  const handleConnectionUpdate = useCallback((
    status: ConnectionStatusType,
    peers: string[],
    error: string,
    roomId: string
  ) => {
    setConnectionStatus(status);
    setConnectionPeers(peers);
    setConnectionError(error);
    setCurrentRoomId(roomId);
  }, []);

  // Reference to GameRoom's handleRoll function
  const [handleDiceRoll, setHandleDiceRoll] = React.useState<((result: number, maxValue: number) => void) | undefined>();

  // Callback for GameRoom to set its dice roll handler
  const setDiceRollHandler = useCallback((handler: (result: number, maxValue: number) => void) => {
    setHandleDiceRoll(() => handler);
  }, []);

  return (
    <>
      <CustomCursor scale={window.innerWidth > 1920 ? 1.2 : 1} />
      <div className="App">
        <Header 
          roomId={currentRoomId}
          connectionStatus={connectionStatus}
          peers={connectionPeers}
          errorMessage={connectionError}
          onRoll={handleDiceRoll}
        />
        <GameRoom 
          onConnectionUpdate={handleConnectionUpdate} 
          onSetDiceRollHandler={setDiceRollHandler}
        />
      </div>
    </>
  );
}

export default App;