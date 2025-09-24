import React, { useCallback } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import './App.css';
import GameRoom from './GameRoom';
import { Header } from './components/ui/Header';
import { ConnectionStatusType } from './types/connection';
import { CustomCursor } from './components/ui/CustomCursor';
import { StandaloneCharacterSheet } from './components/character/StandaloneCharacterSheet';

function App() {
  const APP_VERSION = '1.0.1';
  // Quick cache-busting check
  (() => {
    const storedVersion = localStorage.getItem('app-version');
    if (storedVersion !== APP_VERSION) {
      localStorage.setItem('app-version', APP_VERSION);
      // Force hard reload to clear cache
      window.location.reload();
    }
  })();

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
    <Router>
      <CustomCursor scale={window.innerWidth > 1920 ? 1.2 : 1} />
      <div className="App">
        <Routes>
          {/* Main Game Route */}
          <Route path="/" element={
            <>
              <Header 
                roomId={currentRoomId}
                connectionStatus={connectionStatus}
                peers={connectionPeers}
                errorMessage={connectionError}
                onRoll={handleDiceRoll}
                version={APP_VERSION}
              />
              <GameRoom 
                onConnectionUpdate={handleConnectionUpdate} 
                onSetDiceRollHandler={setDiceRollHandler}
              />
            </>
          } />
          
          {/* Character Sheet Route */}
          <Route path="/character/:characterId" element={<StandaloneCharacterSheet />} />
        </Routes>
      </div>
    </Router>
  );
}

export default App;