import React, { useState, useEffect, useRef } from 'react';
import { searchService, type SearchResult, type TagGroup } from '../../services/SearchService';
import { GameState } from '../../types/game';
import { Search, Tag } from 'lucide-react';
import { useDebounce } from '../../hooks/useDebounce';
import { selfId } from 'trystero';
import type { ModalControls } from '../../services/NavigationManager';

interface SearchBarProps {
  gameState: GameState;
  onResultSelect: (result: {
    id: string;
    type: 'item' | 'skill' | 'character' | 'entity' | 'image' | 'audio';
    location: {
      type: 'characters' | 'catalog' | 'inventory' | 'equipment' | 'field' | 'visuals' | 'encounters' | 'audio' | 'skills';
      containerId?: string;
      containerName?: string;
    };
  }) => void;
  placeholder?: string;
  className?: string;
  isRoomCreator: boolean;
  modalControls?: ModalControls;
}

export function SearchBar({ 
  gameState, 
  onResultSelect,
  placeholder = "Search items, characters, or tags...", 
  className = "",
  isRoomCreator,
  modalControls
}: SearchBarProps) {
  const [query, setQuery] = useState('');
  const [showResults, setShowResults] = useState(false);
  const [results, setResults] = useState<(SearchResult | TagGroup)[]>([]);
  const searchRef = useRef<HTMLDivElement>(null);
  const debouncedQuery = useDebounce(query, 300);

  // Update search index when gameState changes
  useEffect(() => {
    if (isRoomCreator) {
      // DMs get access to everything
      searchService.updateIndex(gameState);
    } else {
      // Players only get access to their own character's items and skills
      const playerCharacter = gameState.party.find(c => c.playerId === selfId);
      if (playerCharacter) {
        // Create a filtered game state for player search
        const filteredState: GameState = {
          ...gameState,
          party: [playerCharacter],
          globalCollections: {
            ...gameState.globalCollections,
            items: [],
            entities: [],
            images: [],
            skills: [],
            statusEffects: []
          },
          field: [],
          display: gameState.display,
          combat: gameState.combat,
          audio: {
            ...gameState.audio,
            playlist: []
          }
        };
        searchService.updateIndex(filteredState);
      }
    }
  }, [gameState, isRoomCreator]);

  // Perform search when debounced query changes
  useEffect(() => {
    if (debouncedQuery) {
      const searchResults = searchService.search(debouncedQuery);
      setResults(searchResults);
    } else {
      setResults([]);
    }
  }, [debouncedQuery]);

  // Handle clicks outside of search component
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setShowResults(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleResultClick = (result: SearchResult | TagGroup) => {
    console.log('[SearchBar] Result clicked:', result);
    if ('tag' in result) {
    } else {
      const { object } = result;
      
      // Always call onResultSelect to trigger navigation
      onResultSelect(object);
      
      // If it's modal content, also show the modal
      if (modalControls && object.location.containerId) {
        switch (object.location.type) {
          case 'inventory':
            modalControls.showInventoryModal(object.location.containerId);
            break;
          case 'equipment':
            modalControls.showEquipmentModal(object.location.containerId);
            break;
          case 'skills':
            modalControls.showSkillsModal(object.location.containerId);
            break;
        }
      }
    }
  
    setQuery('');
    setShowResults(false);
  };

  return (
    <div ref={searchRef} className="relative flex-1 max-w-xl mx-auto">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-grey dark:text-offwhite h-4 w-4" />
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setShowResults(true);
          }}
          onFocus={() => setShowResults(true)}
          placeholder={placeholder}
          className={`
            w-full px-10 py-2 text-sm rounded-full
            bg-white dark:bg-black
            text-gray-900 dark:text-gray-100
            border-2 border-grey dark:border-offwhite
            focus:outline-none focus:ring-2 focus:ring-blue-500
            placeholder:text-gray-400 dark:placeholder:text-gray-500
            ${className}
          `}
        />
      </div>

      {/* Results dropdown */}
      {showResults && results.length > 0 && (
        <div className="absolute w-full mt-1 bg-white dark:bg-gray-800 rounded-md shadow-lg border border-gray-200 dark:border-gray-700 max-h-96 overflow-y-auto z-50">
          {results.map((result, index) => {
            if ('tag' in result) {
              return (
                <div key={`tag-${result.tag}`} className="px-4 py-2 bg-gray-50 dark:bg-gray-700/50">
                  <div className="flex items-center gap-2">
                    <Tag className="h-4 w-4 text-blue-500" />
                    <span className="font-medium text-gray-700 dark:text-gray-300">
                      {result.tag}
                    </span>
                    <span className="text-sm text-gray-500 dark:text-gray-400">
                      ({result.objects.length} items)
                    </span>
                  </div>
                  {/* Tag group contents */}
                  <div className="divide-y divide-gray-100 dark:divide-gray-700">
                    {result.objects.map((obj, objIndex) => (
                      <div
                        key={`${obj.id}-${objIndex}`}
                        onClick={() => handleResultClick({
                          type: 'direct',
                          object: obj,
                          score: 1
                        })}
                        className="px-6 py-2 hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="font-normal">{obj.name}</span>
                            <span className="text-sm text-gray-500 dark:text-gray-400">
                              ({obj.type})
                            </span>
                          </div>
                          <span className="text-sm text-gray-400 dark:text-gray-500">
                            {obj.location.containerName
                              ? `in ${obj.location.containerName}'s ${obj.location.type}`
                              : `in ${obj.location.type}`}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            } else {
              return (
                <div
                  key={`direct-${result.object.id}-${index}`}
                  onClick={() => handleResultClick(result)}
                  className="px-4 py-2 hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="font-normal">{result.object.name}</span>
                      <span className="text-sm text-gray-500 dark:text-gray-400">
                        ({result.object.type})
                      </span>
                    </div>
                    <span className="text-sm text-gray-400 dark:text-gray-500">
                      {result.object.location.containerName
                        ? `in ${result.object.location.containerName}'s ${result.object.location.type}`
                        : `in ${result.object.location.type}`}
                    </span>
                  </div>
                </div>
              );
            }
          })}
        </div>
      )}
    </div>
  );
}