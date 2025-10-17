// domains/Room/PeerStatus.tsx

import { useState, useRef, useEffect } from 'react';
import { usePeerTracking } from '../../hooks/usePeerTracking';

export function PeerStatus() {
  const [isOpen, setIsOpen] = useState(false);
  const { connectionStatus, peerInfoList } = usePeerTracking();
  const windowRef = useRef<HTMLDivElement>(null);
  const badgeRef = useRef<HTMLButtonElement>(null);

  // Close window when clicking outside
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (
        windowRef.current &&
        badgeRef.current &&
        !windowRef.current.contains(event.target as Node) &&
        !badgeRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  // Determine badge color class
  const getBadgeColorClass = () => {
    return connectionStatus === 'online' ? 'badge-warning' : 'badge-success';
  };

  return (
    <div className="relative">
      {/* Badge Button */}
      <button
        ref={badgeRef}
        onClick={() => setIsOpen(!isOpen)}
        className={`badge badge-lg ${getBadgeColorClass()} gap-2 cursor-pointer hover:opacity-80 transition-opacity`}
        aria-label="Peer connection status"
      >
        {connectionStatus === 'online' ? (
          <span className="icon-[eos-icons--compass] w-5 h-5"></span>
        ) : (
          <>
            <span className="icon-[mdi--access-point-network] w-4 h-4"></span>
            {peerInfoList.length}
          </>
        )}
      </button>

      {/* Peer Info Window */}
      {isOpen && (
        <div
          ref={windowRef}
          className="absolute top-full left-0 mt-2 w-72 bg-base-100 border-2 border-base-300 rounded-lg shadow-xl z-50"
        >
          <div className="p-4">
            {/* Header */}
            <div className="flex justify-between items-center mb-3">
              <h3 className="font-bold text-lg">Connected Peers</h3>
              <span className="text-sm opacity-70">
                {peerInfoList.length} {peerInfoList.length === 1 ? 'peer' : 'peers'}
              </span>
            </div>

            {/* Peer List */}
            {peerInfoList.length === 0 ? (
              <div className="text-center py-6 opacity-50">
                <p>No peers connected</p>
              </div>
            ) : (
              <div className="space-y-2">
                {peerInfoList.map(peer => (
                  <div
                    key={peer.id}
                    className="p-3 bg-base-200 rounded-lg"
                  >
                    <div className="flex justify-between items-start">
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold truncate">{peer.name}</p>
                        <p className="text-xs opacity-60 truncate font-mono">
                          {peer.id}
                        </p>
                      </div>
                      <div className="ml-2 text-right">
                        {peer.ping !== null ? (
                          <>
                            <p className="text-sm font-mono font-bold">
                              {peer.ping}ms
                            </p>
                            <p className="text-xs opacity-60">ping</p>
                          </>
                        ) : (
                          <p className="text-xs opacity-60">measuring...</p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Connection Status Footer */}
            <div className="mt-3 pt-3 border-t border-base-300">
              <div className="flex items-center gap-2 text-sm">
                <div className={`w-2 h-2 rounded-full ${
                  connectionStatus === 'online' ? 'bg-warning' : 'bg-success'
                }`}></div>
                <span className="opacity-70">
                  Status: <span className="font-semibold capitalize">{connectionStatus}</span>
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}