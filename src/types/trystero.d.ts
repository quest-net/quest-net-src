// src/types/trystero.d.ts

interface BaseConfig {
  appId: string;
  password?: string;
  rtcConfig?: RTCConfiguration;
}

interface TorrentConfig extends BaseConfig {
  relayUrls?: string[];
  relayRedundancy?: number;
}

interface FirebaseConfig extends BaseConfig {
  firebaseApp?: any;
  rootPath?: string;
}

interface SupabaseConfig extends BaseConfig {
  supabaseKey: string;
}

interface Room {
  leave: () => void;
  getPeers: () => Map<string, RTCPeerConnection>;
  addStream: (stream: MediaStream, targetPeers?: string | string[], metadata?: any) => void;
  removeStream: (stream: MediaStream, targetPeers?: string | string[]) => void;
  addTrack: (track: MediaStreamTrack, stream: MediaStream, targetPeers?: string | string[], metadata?: any) => void;
  removeTrack: (track: MediaStreamTrack, stream: MediaStream, targetPeers?: string | string[]) => void;
  replaceTrack: (oldTrack: MediaStreamTrack, newTrack: MediaStreamTrack, stream: MediaStream, targetPeers?: string | string[]) => void;
  onPeerJoin: (callback: (peerId: string) => void) => void;
  onPeerLeave: (callback: (peerId: string) => void) => void;
  onPeerStream: (callback: (stream: MediaStream, peerId: string, metadata?: any) => void) => void;
  onPeerTrack: (callback: (track: MediaStreamTrack, stream: MediaStream, peerId: string, metadata?: any) => void) => void;
  makeAction: <T = any>(actionId: string) => [
    (data: T, targetPeers?: string | string[] | null, metadata?: any, onProgress?: (progress: number, peerId: string) => void) => Promise<void>,
    (callback: (data: T, peerId: string, metadata?: any) => void) => void,
    (callback: (percent: number, peerId: string, metadata?: any) => void) => void
  ];
  ping: (peerId: string) => Promise<number>;
}

declare module 'trystero' {
  export const joinRoom: (config: BaseConfig, roomId: string, onError?: (details: any) => void) => Room;
  export const selfId: string;
}

declare module 'trystero/torrent' {
  export const joinRoom: (config: TorrentConfig, roomId: string, onError?: (details: any) => void) => Room;
  export const selfId: string;
  export type { Room };
}

declare module 'trystero/firebase' {
  export const joinRoom: (config: FirebaseConfig, roomId: string, onError?: (details: any) => void) => Room;
  export const selfId: string;
  export const getOccupants: (config: FirebaseConfig, roomId: string) => Promise<string[]>;
  export type { Room };
}

declare module 'trystero/supabase' {
  export const joinRoom: (config: SupabaseConfig, roomId: string, onError?: (details: any) => void) => Room;
  export const selfId: string;
  export type { Room };
}

declare module 'trystero/mqtt' {
  export const joinRoom: (config: TorrentConfig, roomId: string, onError?: (details: any) => void) => Room;
  export const selfId: string;
  export type { Room };
}

declare module 'trystero/ipfs' {
  export const joinRoom: (config: BaseConfig, roomId: string, onError?: (details: any) => void) => Room;
  export const selfId: string;
  export type { Room };
}

declare module 'trystero/nostr' {
  export const joinRoom: (config: TorrentConfig, roomId: string, onError?: (details: any) => void) => Room;
  export const selfId: string;
  export type { Room };
}