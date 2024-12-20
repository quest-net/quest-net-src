import React, { useState, useEffect } from 'react';
import { Dice3 } from 'lucide-react';
import { ReactComponent as Sphere } from '../components/ui/sphere.svg';
import {ReactComponent as Imagine} from '../components/ui/imagine.svg';

const adjectives = ['brave', 'wise', 'swift', 'bold', 'calm', 'deep', 'fair', 'kind', 'pure', 'sure', 'warm', 'keen', 'nova', 'clear', 'prime', 'shard', 'pale', 'void', 'zesty', 'vivid', 'sharp'];

const nouns = ['sage', 'drake', 'wolf', 'hawk', 'vale', 'peak', 'moon', 'star', 'sun', 'wind', 'rain', 'flare', 'comet', 'novae', 'quark', 'nebula', 'spire', 'pulse', 'light', 'orbit', 'ether'];



const LobbySystem = ({ onJoinRoom }: { onJoinRoom: (id: string, isHost: boolean) => void }) => {
  const [view, setView] = useState<'main' | 'create' | 'join'>('main');
  const [lobbyId, setLobbyId] = useState('');
  const [recentRooms, setRecentRooms] = useState<{id: string, timestamp: number, isHost: boolean}[]>([]);
  const [joinError, setJoinError] = useState<string | null>(null);


  // Function to generate random ID
  const generateRandomId = () => {
    const randomAdjective = adjectives[Math.floor(Math.random() * adjectives.length)];
    const randomNoun = nouns[Math.floor(Math.random() * nouns.length)];
    const randomNumber = Math.floor(Math.random() * 100);
    return `${randomAdjective}-${randomNoun}-${randomNumber}`;
  };
  // Add this useEffect to load recent rooms when component mounts
  useEffect(() => {
    const savedRooms = localStorage.getItem('recentRooms');
    if (savedRooms) {
      setRecentRooms(JSON.parse(savedRooms));
    }
  }, []);
  
  
  // Modify handleIdSubmit to save rooms
  const handleIdSubmit = (isHost: boolean) => {
    if (!lobbyId.trim()) return;
    
    setJoinError(null); // Clear any previous errors
    
    // Save to recent rooms (only if join is successful)
    const newRoom = { id: lobbyId.trim(), timestamp: Date.now(), isHost };
    
    try {
      onJoinRoom(lobbyId.trim(), isHost);
    } catch (error) {
      setJoinError(error instanceof Error ? error.message : 'Failed to join room');
      return;
    }
    
    // Only update recent rooms if join was successful
    const updatedRooms = [
      newRoom,
      ...recentRooms.filter(room => room.id !== lobbyId.trim()).slice(0, 4)
    ];
    localStorage.setItem('recentRooms', JSON.stringify(updatedRooms));
    setRecentRooms(updatedRooms);
  };

  const renderMain = () => (
    <div>
    <div className="fixed top-[24vh] flex flex-col gap-4">
      <button
        onClick={() => setView('create')}
        className=" px-[28vh] py-[5vh] text-left rounded-[0px_999px_999px_0px] 
          shadow-[0px_4px_4px_0px_rgba(0,0,0,0.25)]
          bg-[#FFFFFF] dark:bg-[#F2EEE4]
          text-[#333233] dark:text-[#333233]
          transition-colors duration-1000
          text-[3.5vh] font-['Mohave'] font-semibold"
          
      >
        Create a Lobby
      </button>
      <button
        onClick={() => setView('join')}
        className=" px-[28vh] py-[5vh] text-left rounded-[0px_999px_999px_0px] shadow-[0px_4px_4px_0px_rgba(0,0,0,0.25)]
          bg-[#333233] dark:bg-[#000000]
          text-[#F2EEE4] dark:text-[#F2EEE4]
          transition-colors duration-1000
          text-[3.5vh] font-['Mohave'] font-semibold"
      >
        Join a Lobby
      </button>
    </div>
    <div className="flex flex-col justify-center items-center absolute w-[40]  left-0 bottom-0 -z-[9]">
        <svg className="fill-blue dark:fill-cyan" width="15vh" height="15vh" viewBox="0 0 150 168" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path fillRule="evenodd" clipRule="evenodd" d="M73.9271 0.496735V7.99768C73.9271 43.8244 73.9271 61.7378 85.0571 72.8678C96.187 83.9977 114.1 83.9977 149.927 83.9977L149.928 83.9978C114.101 83.9978 96.1875 83.9978 85.0575 95.1278C73.9276 106.258 73.9276 124.171 73.9276 159.998V167.499H73.9249C73.2534 167.499 72.5822 167.499 71.9111 167.499H73.9242V159.998C73.9242 124.171 73.9242 106.258 62.7943 95.1276C51.8891 84.2224 34.4715 84.0022 0.0723877 83.9977C34.472 83.9933 51.8896 83.7732 62.7949 72.8679C73.9249 61.7379 73.9249 43.8246 73.9249 7.9978V0.496735H73.9271Z"/>
        </svg>
        <svg className="fill-blue dark:fill-cyan" width="15vh" height="15vh" viewBox="0 0 150 168" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path fillRule="evenodd" clipRule="evenodd" d="M73.9271 0.496735V7.99768C73.9271 43.8244 73.9271 61.7378 85.0571 72.8678C96.187 83.9977 114.1 83.9977 149.927 83.9977L149.928 83.9978C114.101 83.9978 96.1875 83.9978 85.0575 95.1278C73.9276 106.258 73.9276 124.171 73.9276 159.998V167.499H73.9249C73.2534 167.499 72.5822 167.499 71.9111 167.499H73.9242V159.998C73.9242 124.171 73.9242 106.258 62.7943 95.1276C51.8891 84.2224 34.4715 84.0022 0.0723877 83.9977C34.472 83.9933 51.8896 83.7732 62.7949 72.8679C73.9249 61.7379 73.9249 43.8246 73.9249 7.9978V0.496735H73.9271Z"/>
        </svg>
        <svg className="fill-blue dark:fill-cyan" width="15vh" height="15vh" viewBox="0 0 150 168" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path fillRule="evenodd" clipRule="evenodd" d="M73.9271 0.496735V7.99768C73.9271 43.8244 73.9271 61.7378 85.0571 72.8678C96.187 83.9977 114.1 83.9977 149.927 83.9977L149.928 83.9978C114.101 83.9978 96.1875 83.9978 85.0575 95.1278C73.9276 106.258 73.9276 124.171 73.9276 159.998V167.499H73.9249C73.2534 167.499 72.5822 167.499 71.9111 167.499H73.9242V159.998C73.9242 124.171 73.9242 106.258 62.7943 95.1276C51.8891 84.2224 34.4715 84.0022 0.0723877 83.9977C34.472 83.9933 51.8896 83.7732 62.7949 72.8679C73.9249 61.7379 73.9249 43.8246 73.9249 7.9978V0.496735H73.9271Z"/>
        </svg>
      </div>
      <div className="fixed inset-0 w-full h-full -z-10 overflow-hidden">
      <svg 
        className="absolute min-w-full min-h-full w-auto h-auto"
        preserveAspectRatio="xMidYMid slice"
        viewBox="2500 2350 2500 2500" 
        fill="none" 
        xmlns="http://www.w3.org/2000/svg"
      >
        <path d="M4546.45 2694.55L4711.2 2706.67L4783.59 2862.95L4691.24 3007.1L4526.5 2994.97L4454.1 2838.7L4546.45 2694.55Z" className="fill-blue dark:fill-cyan"/>
        <path d="M5010.41 5602.67L4459.94 1.19214" className="stroke-[#333233] dark:stroke-[#F2EEE4]" strokeWidth="5"/>
        <path d="M5010.41 2591.27L1.11523 4298.53" className="stroke-[#333233] dark:stroke-[#F2EEE4]" strokeWidth="5"/>
        <path d="M2001 1752.5L5010.41 3172.46" className="stroke-[#333233] dark:stroke-[#F2EEE4]" strokeWidth="5"/>
        <path d="M4092.53 5594.15L5036.81 1616.93" className="stroke-[#333233] dark:stroke-[#F2EEE4]" strokeWidth="5"/>
        <path d="M629.048 5675.38L5010.41 2407.56" className="stroke-[#333233] dark:stroke-[#F2EEE4]" strokeWidth="5"/>
        <path d="M5010.41 3418.71L1908.55 284.538" className="stroke-[#333233] dark:stroke-[#F2EEE4]" strokeWidth="5"/>
        <path d="M4554.44 2953.07L2523.69 5938.69" className="stroke-[#333233] dark:stroke-[#F2EEE4]" strokeWidth="5"/>
        <path d="M5010.41 2857.14L4735.56 2865.47" className="stroke-[#333233] dark:stroke-[#F2EEE4]" strokeWidth="5"/>
        <path d="M4567.47 2743.52L3303.07 33.6926" className="stroke-[#333233] dark:stroke-[#F2EEE4]" strokeWidth="5"/>
        <path className="fill-white dark:fill-[#333233]" d="M4592.57 2819.18L4609.96 2797.3C4611.78 2794.98 4613.76 2794.03 4615.9 2794.42C4618.11 2794.79 4619.71 2796.41 4620.7 2799.28L4638.52 2850.85C4639.17 2852.71 4639.43 2854.89 4639.28 2857.37C4639.2 2859.84 4638.82 2862.26 4638.09 2864.64C4637.43 2866.93 4636.46 2868.83 4635.22 2870.37L4646.43 2856.34L4650.15 2867.08L4621.53 2902.99C4619.66 2905.33 4617.64 2906.31 4615.49 2905.9C4613.36 2905.51 4611.79 2903.88 4610.8 2901.01L4589.26 2838.7C4588.6 2836.77 4588.31 2834.6 4588.4 2832.21C4588.48 2829.74 4588.89 2827.36 4589.62 2825.05C4590.35 2822.67 4591.32 2820.72 4592.57 2819.18ZM4635.22 2870.37L4613.68 2808.06L4596.29 2829.94L4617.82 2892.24L4635.22 2870.37ZM4646.43 2856.34L4635.22 2870.37L4624.49 2868.4L4635.7 2854.37L4646.43 2856.34ZM4635.22 2870.37L4617.82 2892.24L4607.09 2890.28L4624.49 2868.4L4635.22 2870.37ZM4613.68 2808.05L4635.22 2870.36L4624.49 2868.39L4602.95 2806.08L4613.68 2808.05ZM4616 2794.39C4613.8 2794.02 4611.78 2794.99 4609.96 2797.3L4592.57 2819.18C4591.32 2820.72 4590.35 2822.67 4589.62 2825.05C4588.89 2827.36 4588.48 2829.76 4588.4 2832.21C4588.31 2834.6 4588.6 2836.76 4589.26 2838.7L4610.8 2901.01C4611.79 2903.87 4613.36 2905.51 4615.49 2905.9L4604.76 2903.94C4602.62 2903.55 4601.06 2901.92 4600.07 2899.05L4578.53 2836.74C4577.86 2834.81 4577.58 2832.64 4577.67 2830.25C4577.75 2827.78 4578.16 2825.4 4578.89 2823.09C4579.61 2820.71 4580.59 2818.75 4581.83 2817.22L4599.23 2795.34C4601.12 2792.99 4603.13 2792.02 4605.27 2792.42L4616 2794.39Z"/>
        <path d="M4537.31 2674.83L4722.85 2688.49L4804.37 2864.48L4700.37 3026.82L4514.83 3013.16L4433.31 2837.16L4537.31 2674.83Z" className="stroke-[#333233] dark:stroke-[#F2EEE4]" strokeWidth="5" strokeMiterlimit="10"/>
        <path d="M4567.47 2743.52L4551.4 2959.75L4737.28 2866.28L4567.47 2743.52Z" className="stroke-[#333233] dark:stroke-[#F2EEE4]" strokeWidth="5"/>
      </svg>
    </div>
    </div>
  );
  const RecentRoomsList = ({ 
    onSelect, 
    forcedRole = 'default' 
  }: { 
    onSelect: (id: string, isHost: boolean) => void,
    forcedRole?: 'player' | 'dm' | 'default'
  }) => (
    <div className="mt-8 w-full max-w-md">
      <h3 className="text-lg font-medium mb-3 px-3">Recent Rooms</h3>
      <div className="space-y-2">
        {recentRooms.map(room => (
          <div 
            key={room.id}
            className="flex items-center justify-between p-3 rounded-md hover:bg-white dark:hover:bg-black transition-colors cursor-pointer"
            onClick={() => {
              // Use forcedRole if specified, otherwise use the room's original role
              const isHost = forcedRole === 'default' ? room.isHost : forcedRole === 'dm';
              onJoinRoom(room.id, isHost);
            }}
          >
            <div>
              <div className="font-medium">{room.id}</div>
              <div className="text-sm text-gray-500">
                {new Date(room.timestamp).toLocaleDateString()} {new Date(room.timestamp).toLocaleTimeString()}
              </div>
            </div>
            <span className={`px-2 py-1 text-sm rounded ${
              forcedRole === 'default' ? 
                (room.isHost ? 'bg-blue-100 text-blue-800' : 'bg-green-100 text-green-800') :
                (forcedRole === 'dm' ? 'bg-blue-100 text-blue-800' : 'bg-green-100 text-green-800')
            }`}>
              {forcedRole === 'default' ? 
                (room.isHost ? 'Host' : 'Player') :
                (forcedRole === 'dm' ? 'Host' : 'Player')}
            </span>
          </div>
        ))}
        {recentRooms.length === 0 && (
          <div className="text-center text-gray-500 py-4">
            No recent rooms
          </div>
        )}
      </div>
    </div>
  );
  const renderCreateLobby = () => (
    <div className="relative min-h-screen w-full">
      {/* Background SVG wrapper */}
    <div className="fixed inset-0 w-full h-full -z-10 overflow-hidden pointer-events-none">
      <Sphere className=" absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[80vh] h-[80vh] opacity-80 scale-[2] fill-[#333233] dark:fill-[#F2EEE4]" />
      <Imagine className="absolute -bottom-[20%] left-[12.5%] w-[75vh] h-[75vh] fill-blue dark:fill-cyan"/>
    </div>
  
      {/* Main Content Container */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="w-full max-w-lg px-8 py-12 space-y-8">
          {/* Title */}
          <h2 className="text-4xl font-['Mohave'] font-bold text-center">
            Set Lobby ID
          </h2>
  
          {/* Input Bar with Random Button */}
        <div className="relative">
          <input
            type="text"
            value={lobbyId}
            onChange={(e) => setLobbyId(e.target.value)}
            placeholder="A New Beginning?"
            className="w-full px-6 py-4 text-lg ring-text ring-2 rounded-xl focus:ring-4 bg-white dark:bg-black pr-12"
          />
          <button 
            onClick={() => setLobbyId(generateRandomId())}
            className="absolute right-3 top-1/2 -translate-y-1/2 p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
            aria-label="Generate Random ID"
          >
            <Dice3 className="w-6 h-6" />
          </button>
        </div>
  
          {/* Buttons Container */}
          <div className="flex justify-between items-center gap-4 py-4 px-8">
            <button
              onClick={() => setView('main')}
              className="px-12 py-3 bg-[#333233] dark:bg-[#F2EEE4] rounded-xl text-xl hover:bg-black dark:hover:bg-white transition-colors dark:bg
                text-[#F2EEE4] dark:text-[#333233] font-['Mohave'] font-semibold"
            >
              Back
            </button>
            <button
              onClick={() => handleIdSubmit(true)}
              disabled={!lobbyId.trim()}
              className="px-12 py-3 bg-blue dark:bg-cyan text-[#F2EEE4] dark:text-[#333233] 
                rounded-xl text-xl transition-colors disabled:bg-blue-400 dark:disabled:bg-cyan-200 
                disabled:cursor-not-allowed font-['Mohave'] font-semibold"
            >
              Start
            </button>
          </div>
  
          {/* Recent Rooms List */}
          <div className="m-8 bg-offwhite dark:bg-grey border-2 border-grey dark:border-offwhite rounded-lg" >
          <RecentRoomsList 
      onSelect={(id, isHost) => {
        onJoinRoom(id, isHost);
      }}
      forcedRole="dm"  // Force DM role in create lobby
    />
          </div>
        </div>
      </div>
    </div>
  );

  const renderJoinLobby = () => (
    <div className="relative min-h-screen w-full">
      {/* Background SVG wrapper */}
      <div className="fixed inset-0 w-full h-full -z-10 overflow-hidden pointer-events-none">
        <Sphere className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[80vh] h-[80vh] opacity-80 scale-[2] fill-[#333233] dark:fill-[#F2EEE4]" />
        <Imagine className="absolute -bottom-[20%] left-[12.5%] w-[75vh] h-[75vh] fill-blue dark:fill-cyan"/>
      </div>
  
      {/* Main Content Container */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="w-full max-w-lg px-8 py-12 space-y-8">
          {/* Title */}
          <h2 className="text-4xl font-['Mohave'] font-bold text-center">
            Join Lobby
          </h2>
  
          {/* Input Bar */}
          <input
            type="text"
            value={lobbyId}
            onChange={(e) => setLobbyId(e.target.value)}
            placeholder="Where will this journey lead?"
            className="w-full px-6 py-4 text-lg ring-text ring-2 rounded-xl focus:ring-4 bg-white dark:bg-black"
          />
  
          {/* Buttons Container */}
          <div className="flex justify-between items-center gap-4 py-4 px-8">
            <button
              onClick={() => setView('main')}
              className="px-12 py-3 bg-[#333233] dark:bg-[#F2EEE4] rounded-xl text-xl hover:bg-black dark:hover:bg-white transition-colors dark:bg
                text-[#F2EEE4] dark:text-[#333233] font-['Mohave'] font-semibold"
            >
              Back
            </button>
            <button
              onClick={() => handleIdSubmit(false)}
              disabled={!lobbyId.trim()}
              className="px-12 py-3 bg-blue dark:bg-cyan text-[#F2EEE4] dark:text-[#333233] 
                rounded-xl text-xl transition-colors disabled:bg-blue-400 dark:disabled:bg-cyan-200 
                disabled:cursor-not-allowed font-['Mohave'] font-semibold"
            >
              Join
            </button>
          </div>
  
          {/* Recent Rooms List */}
          <div className="mt-8 m-8 bg-offwhite dark:bg-grey border-2 border-grey dark:border-offwhite rounded-lg">
          <RecentRoomsList 
      onSelect={(id, isHost) => {
        onJoinRoom(id, isHost);
      }}
      forcedRole="player"  // Force player role in join lobby
    />
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="lobby-screen">
      {view === 'main' && renderMain()}
      {view === 'create' && renderCreateLobby()}
      {view === 'join' && renderJoinLobby()}
    </div>
  );
};

export default LobbySystem;