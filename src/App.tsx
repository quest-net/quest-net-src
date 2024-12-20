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

  // Use useCallback to memoize the handler
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
  }, []); // Empty dependency array since we don't use any external values

  return (
    <>
    <CustomCursor scale={window.innerWidth > 1920 ? 1.2 : 1} />
    <div className="App">
      <Header 
        roomId={currentRoomId}
        connectionStatus={connectionStatus}
        peers={connectionPeers}
        errorMessage={connectionError}
      />
      <GameRoom onConnectionUpdate={handleConnectionUpdate} />
    </div>
    </>
  );
}

export default App;