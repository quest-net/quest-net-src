// src/types/connection.ts
export const ConnectionStatus = {
    DISCONNECTED: 'disconnected',
    CONNECTING: 'connecting',
    CONNECTED: 'connected',
    RECONNECTING: 'reconnecting',
    ERROR: 'error'
  } as const;
  
  export type ConnectionStatusType = typeof ConnectionStatus[keyof typeof ConnectionStatus];
  