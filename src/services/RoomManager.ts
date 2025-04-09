// src/services/RoomManager.ts
import { joinRoom, Room } from 'trystero/mqtt';
import { EventEmitter } from 'events';

const config = {
  appId: 'quest-net'
};


class RoomManager {
  private static instance: RoomManager;
  private room?: Room;
  private currentRoomId?: string;
  public events: EventEmitter;
  private connectedPeers: Set<string>;
  private connectionCheckInterval?: NodeJS.Timeout;

  private constructor() {
    this.events = new EventEmitter();
    this.connectedPeers = new Set();
  }

  public static getInstance(): RoomManager {
    if (!RoomManager.instance) {
      RoomManager.instance = new RoomManager();
    }
    return RoomManager.instance;
  }

  private startConnectionCheck() {
    // Clear any existing interval
    if (this.connectionCheckInterval) {
      clearInterval(this.connectionCheckInterval);
    }

    // Check connections every second
    this.connectionCheckInterval = setInterval(() => {
      if (!this.room) return;

      const currentPeers = Object.entries(this.room.getPeers())
        .filter(([_, connection]) => connection.connectionState === 'connected')
        .map(([peerId]) => peerId);

      // Update connected peers
      const newPeers = new Set(currentPeers);
      
      // Check for disconnected peers
      Array.from(this.connectedPeers).forEach(peerId => {
        if (!newPeers.has(peerId)) {
          console.log(`[RoomManager] Peer disconnected: ${peerId}`);
          // Emit leave event before clearing party data
          this.events.emit('peerLeave', peerId);
          this.events.emit('peerDisconnected', peerId);
        }
      });

      // Check for new peers
      currentPeers.forEach(peerId => {
        if (!this.connectedPeers.has(peerId)) {
          console.log(`[RoomManager] New peer connected: ${peerId}`);
          this.events.emit('peerJoin', peerId);
        }
      });

      // Update the stored peer list
      if (currentPeers.length !== this.connectedPeers.size) {
        this.connectedPeers = newPeers;
        this.events.emit('peersChanged', currentPeers);
        console.log(`[RoomManager] Updated peers:`, currentPeers);
      }
    }, 1000);
  }

  public joinRoom(roomId: string): Room {
    if (this.room && this.currentRoomId === roomId) {
      return this.room;
    }

    if (this.room) {
      this.leaveRoom();
    }

    console.log(`[RoomManager] Joining room: ${roomId}`);
    this.room = joinRoom(config, roomId);
    this.currentRoomId = roomId;
    this.connectedPeers.clear();

    // Get initial peers that are already connected
    const peerConnections = this.room.getPeers();
    Object.entries(peerConnections).forEach(([peerId, connection]) => {
      if (connection.connectionState === 'connected') {
        this.connectedPeers.add(peerId);
        console.log(`[RoomManager] Initial connected peer: ${peerId}`);
      }

      // Monitor each peer connection
      connection.addEventListener('connectionstatechange', () => {
        console.log(`[RoomManager] Peer ${peerId} connection state: ${connection.connectionState}`);
        if (connection.connectionState === 'connected') {
          if (!this.connectedPeers.has(peerId)) {
            this.connectedPeers.add(peerId);
            this.events.emit('peerJoin', peerId);
            this.events.emit('peersChanged', Array.from(this.connectedPeers));
          }
        } else if (connection.connectionState === 'disconnected' || 
                  connection.connectionState === 'failed' || 
                  connection.connectionState === 'closed') {
          if (this.connectedPeers.has(peerId)) {
            this.connectedPeers.delete(peerId);
            this.events.emit('peerLeave', peerId);
            this.events.emit('peerDisconnected', peerId); 
            this.events.emit('peersChanged', Array.from(this.connectedPeers));
          }
        }
      });
    });

    // Start connection monitoring
    this.startConnectionCheck();

    return this.room;
  }

  public leaveRoom() {
    if (this.connectionCheckInterval) {
      clearInterval(this.connectionCheckInterval);
      this.connectionCheckInterval = undefined;
    }

    if (this.room) {
      console.log(`[RoomManager] Leaving room: ${this.currentRoomId}`);
      this.room.leave();
      this.room = undefined;
      this.currentRoomId = undefined;
      this.connectedPeers.clear();
      this.events.emit('roomLeft');
      this.events.emit('peersChanged', []);
    }
  }

  public getConnectedPeers(): string[] {
    return Array.from(this.connectedPeers);
  }

  public getRoom(): Room | undefined {
    return this.room;
  }

  public getCurrentRoomId(): string | undefined {
    return this.currentRoomId;
  }
}

export const roomManager = RoomManager.getInstance();