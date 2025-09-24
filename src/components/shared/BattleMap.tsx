import React, { useState, useRef, useEffect } from 'react';
import { useCombatActions } from '../../actions/combatActions';
import { GameState } from '../../types/game';
import { selfId } from 'trystero';
import type { Room } from 'trystero/nostr';
import { imageManager } from '../../services/ImageManager';
import { getCatalogEntity } from '../../utils/referenceHelpers';

interface BattleMapProps {
  gameState: GameState;
  onGameStateChange: (newState: GameState) => void;
  room?: Room;
  isRoomCreator: boolean;
}

interface Position {
  x: number;
  y: number;
}

// ✅ NEW: Unified actor interface for both characters and resolved EntityReference
interface BattleMapActor {
  id: string;           // character.id or entityRef.instanceId for positioning
  name: string;         // resolved name
  image?: string;       // resolved image
  type: 'character' | 'entity';
  playerId?: string;    // for movement permissions (characters only)
}

const BattleMap: React.FC<BattleMapProps> = ({
  gameState,
  onGameStateChange,
  room,
  isRoomCreator
}) => {
  // Container ref for measuring
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });

  // Grid constants
  const GRID_SIZE = { width: 63, height: 63 };

  // State for drag operations
  const [draggedActorId, setDraggedActorId] = useState<string | null>(null);
  const [dragPosition, setDragPosition] = useState<Position | null>(null);
  const [hoveredActorId, setHoveredActorId] = useState<string | null>(null);

  // ✅ NEW: State for storing loaded actor images
  const [actorImages, setActorImages] = useState<Map<string, string>>(new Map());

  // Combat actions for state updates
  const combatActions = useCombatActions(room, gameState, onGameStateChange, isRoomCreator);

  // Calculate cell dimensions based on container size
  const cellWidth = containerSize.width / GRID_SIZE.width;
  const cellHeight = containerSize.height / GRID_SIZE.height;

  // ✅ UPDATED: Create unified actor array with proper EntityReference resolution
  const actors: BattleMapActor[] = [
    // Characters - map directly with character.id for positioning
    ...gameState.party.map(char => ({
      id: char.id,
      name: char.name,
      image: char.image,
      type: 'character' as const,
      playerId: char.playerId
    })),
    // Field entities - resolve EntityReference properties and use instanceId for positioning
    ...gameState.field.map(entityRef => {
      const catalogEntity = getCatalogEntity(entityRef.catalogId, gameState);
      return {
        id: entityRef.instanceId, // ✅ Use instanceId for positioning
        name: catalogEntity?.name || 'Unknown Entity',
        image: catalogEntity?.image,
        type: 'entity' as const,
        playerId: undefined // Field entities don't have player ownership
      };
    }).filter(actor => actor.name !== 'Unknown Entity') // Filter out invalid references
  ];

  // ✅ NEW: Effect to load actor images
  useEffect(() => {
    let mounted = true;

    const loadActorImages = async () => {
      const newImageMap = new Map<string, string>();
      
      await Promise.all(
        actors.map(async (actor) => {
          if (!actor.image) return;
          
          try {
            const imageFile = await imageManager.getImage(actor.image);
            if (imageFile && mounted) {
              const reader = new FileReader();
              await new Promise<void>((resolve) => {
                reader.onloadend = () => {
                  if (mounted && reader.result) {
                    newImageMap.set(actor.image!, reader.result as string);
                  }
                  resolve();
                };
                reader.readAsDataURL(imageFile);
              });
            }
          } catch (error) {
            console.error(`Failed to load image for actor ${actor.name}:`, error);
          }
        })
      );

      if (mounted) {
        setActorImages(newImageMap);
      }
    };

    loadActorImages();

    return () => {
      mounted = false;
    };
  }, [actors.map(a => a.image).join(',')]); // Dependency on image IDs

  // Update container size on resize
  useEffect(() => {
    if (!containerRef.current) return;

    const updateSize = () => {
      const container = containerRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      setContainerSize({
        width: rect.width,
        height: rect.height
      });
    };

    updateSize();

    const resizeObserver = new ResizeObserver(updateSize);
    resizeObserver.observe(containerRef.current);

    return () => {
      if (containerRef.current) {
        resizeObserver.unobserve(containerRef.current);
      }
    };
  }, []);

  // ✅ UPDATED: Watch for new actors and initialize their positions
  useEffect(() => {
    if (!gameState.combat?.isActive || !combatActions) return;

    const positionedActorIds = Object.keys(gameState.combat.positions || {});

    // Find actors without positions
    const unpositionedActors = actors.filter(
      actor => !positionedActorIds.includes(actor.id)
    );

    // Initialize positions for new actors
    if (isRoomCreator) {
      unpositionedActors.forEach(actor => {
        combatActions.initializePosition(actor.id, actor.type === 'character');
      });
    }
  }, [actors, gameState.combat?.isActive, combatActions, isRoomCreator]);

  // ✅ UPDATED: Check if user can move a piece (DM can move all, players can move own characters)
  const canMovePiece = (actorId: string) => {
    if (isRoomCreator) return true; // DM can move all pieces
    
    // Players can only move their own characters
    const actor = actors.find(a => a.id === actorId);
    return actor?.type === 'character' && actor.playerId === selfId;
  };

  // Handle mouse events for dragging
  const handleMouseDown = (actorId: string, e: React.MouseEvent) => {
    if (!canMovePiece(actorId) || !gameState.combat?.positions) return;

    e.preventDefault();
    const currentPos = gameState.combat.positions[actorId];
    if (currentPos) {
      setDragPosition({
        x: currentPos.x * cellWidth + cellWidth / 2,
        y: currentPos.y * cellHeight + cellHeight / 2
      });
    }
    setDraggedActorId(actorId);
    setHoveredActorId(null);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!draggedActorId || !containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - rect.left, containerSize.width));
    const y = Math.max(0, Math.min(e.clientY - rect.top, containerSize.height));

    setDragPosition({ x, y });
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    if (!draggedActorId || !containerRef.current || !gameState.combat?.positions) return;

    const rect = containerRef.current.getBoundingClientRect();
    const x = Math.floor((e.clientX - rect.left) / cellWidth);
    const y = Math.floor((e.clientY - rect.top) / cellHeight);

    const newX = Math.max(0, Math.min(x, GRID_SIZE.width - 1));
    const newY = Math.max(0, Math.min(y, GRID_SIZE.height - 1));

    // Check if position is taken
    const isTaken = Object.entries(gameState.combat.positions || {})
      .some(([id, pos]) => id !== draggedActorId && pos.x === newX && pos.y === newY);

    if (!isTaken) {
      const position = {
        x: newX,
        y: newY
      };

      if (isRoomCreator) {
        combatActions.movePiece(draggedActorId, position);
      } else {
        combatActions.requestMove(draggedActorId, position);
      }
    }

    setDragPosition(null);
    setDraggedActorId(null);
  };

  const handleMouseLeave = () => {
    setDragPosition(null);
    setDraggedActorId(null);
    setHoveredActorId(null);
  };

  // Get pixel position for an actor
  const getPixelPosition = (actorId: string) => {
    if (draggedActorId === actorId && dragPosition) {
      return dragPosition;
    }

    const pos = gameState.combat?.positions?.[actorId];
    if (!pos) return { x: 0, y: 0 };

    return {
      x: pos.x * cellWidth + cellWidth / 2,
      y: pos.y * cellHeight + cellHeight / 2
    };
  };

  // Piece size
  const pieceRadius = Math.max(cellWidth, cellHeight) * 1.5;

  // Render movement arrows
  const renderMovementArrows = () => {
    if (!gameState.combat) return null;

    return Object.entries(gameState.combat.positions || {})
      .filter(([_, pos]) => pos.lastMoveFrom)
      .map(([actorId, pos]) => {
        if (!pos.lastMoveFrom) return null;

        const startX = pos.lastMoveFrom.x * cellWidth + cellWidth / 2;
        const startY = pos.lastMoveFrom.y * cellHeight + cellHeight / 2;
        const endX = pos.x * cellWidth + cellWidth / 2;
        const endY = pos.y * cellHeight + cellHeight / 2;

        // Calculate vector
        const dx = endX - startX;
        const dy = endY - startY;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        // Calculate normalized direction vector
        const dirX = dx / distance;
        const dirY = dy / distance;
        
        // Adjust start and end points to be outside the circles
        const adjustedStartX = startX + dirX * pieceRadius;
        const adjustedStartY = startY + dirY * pieceRadius;
        
        // Add a small buffer to end position to prevent clipping
        const bufferDistance = pieceRadius + 6; // 4px extra buffer
        const adjustedEndX = endX - dirX * bufferDistance;
        const adjustedEndY = endY - dirY * bufferDistance;
        
        // Calculate adjusted angle and distance
        const angle = Math.atan2(adjustedEndY - adjustedStartY, adjustedEndX - adjustedStartX) * (180 / Math.PI);
        const adjustedDistance = Math.sqrt(
          Math.pow(adjustedEndX - adjustedStartX, 2) + 
          Math.pow(adjustedEndY - adjustedStartY, 2)
        );

        return (
          <div
            key={`arrow-${actorId}`}
            className="absolute bg-current opacity-50"
            style={{
              left: adjustedStartX,
              top: adjustedStartY,
              width: adjustedDistance,
              height: 1.5,
              transformOrigin: 'left center',
              transform: `rotate(${angle}deg)`,
              zIndex: 1
            }}
          >
            {/* Arrow head (smaller and better positioned) */}
            <div 
              className="absolute bg-current"
              style={{
                right: 0,
                top: 0,
                width: 8, // Reduced from 10 to 8
                height: 1.5,
                transformOrigin: 'right center',
                transform: 'rotate(30deg) translateY(-8px)' // Adjusted positioning
              }}
            />
            <div 
              className="absolute bg-current"
              style={{
                right: 0,
                bottom: 0,
                width: 8, // Reduced from 10 to 8
                height: 1.5,
                transformOrigin: 'right center',
                transform: 'rotate(-30deg) translateY(8px)' // Adjusted positioning
              }}
            />
          </div>
        );
      });
  };

  // ✅ UPDATED: Create color-coded backgrounds using resolved actor type
  const getActorBackgroundColor = (actor: BattleMapActor) => {
    if (actor.type === 'character') {
      return 'rgba(59, 130, 246, 0.7)'; // Blue for characters
    } else {
      return 'rgba(139, 92, 246, 0.7)'; // Purple for entities
    }
  };

  return (
    <div 
      ref={containerRef} 
      className="overflow-hidden rounded-lg w-full h-full relative bg-transparent border-2 border-grey dark:border-offwhite"
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
    >
      {/* Turn indicator */}
      {gameState.combat?.isActive && (
        <div className={`
          absolute top-4 left-4 px-4 py-1 z-10 rounded-lg xl:text-xs 2xl:text-md 3xl:text-xl font-['BrunoAceSC']
          ${gameState.combat.initiativeSide === 'party' 
            ? 'bg-blue dark:bg-cyan text-white dark:text-grey'
            : 'bg-purple dark:bg-pink text-white dark:text-grey'}
        `}>
          Turn {gameState.combat.currentTurn}
        </div>
      )}

      {/* Grid Pattern */}
      {containerSize.width > 0 && containerSize.height > 0 && (
        <div className="absolute inset-0">
          {/* Concentric circles */}
          {(() => {
            const centerX = containerSize.width / 2;
            const centerY = containerSize.height / 2;
            const maxRadius = Math.min(containerSize.width, containerSize.height) * 1.5;
            const numCircles = 6;

            return Array.from({ length: numCircles }).map((_, i) => {
              const radius = (maxRadius * (i + 1)) / numCircles;
              return (
                <div
                  key={`circle-${i}`}
                  className="absolute rounded-full border border-current opacity-15"
                  style={{
                    left: centerX - radius,
                    top: centerY - radius,
                    width: radius * 2,
                    height: radius * 2
                  }}
                />
              );
            });
          })()}

          {/* Center star using SVG */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <svg width="26" height="26" viewBox="0 0 26 26" className="fill-current opacity-50">
              <path d="M0,-13 L3,-3 13,0 3,3 0,13 -3,3 -13,0 -3,-3Z" transform="translate(13 13)" />
            </svg>
          </div>
        </div>
      )}

      {/* Movement Arrows */}
      {renderMovementArrows()}

      {/* Actor Pieces */}
      {actors.map(actor => {
        const pixelPos = getPixelPosition(actor.id);
        // ✅ UPDATED: Use loaded full image instead of thumbnail
        const actorImageUrl = actor.image ? actorImages.get(actor.image) : null;
        const isBeingDragged = draggedActorId === actor.id;
        
        return (
          <div
            key={actor.id}
            className={`
              absolute rounded-full overflow-hidden
              ${canMovePiece(actor.id) ? 'cursor-grab' : 'cursor-not-allowed'}
              ${isBeingDragged ? 'cursor-grabbing z-20' : 'z-10'}
               border-grey dark:border-offwhite
            `}
            style={{
              left: pixelPos.x - pieceRadius,
              top: pixelPos.y - pieceRadius,
              width: pieceRadius * 2,
              height: pieceRadius * 2,
              transition: isBeingDragged ? 'none' : 'all 0.3s ease-out',
              // Add outer glow/shadow effect
              boxShadow: '0 0 8px rgba(0,0,0,0.4)'
            }}
            onMouseDown={(e) => handleMouseDown(actor.id, e)}
            onMouseEnter={() => !draggedActorId && setHoveredActorId(actor.id)}
            onMouseLeave={() => !draggedActorId && setHoveredActorId(null)}
          >
            {/* Background image or fallback */}
            <div 
              className="w-full h-full flex items-center justify-center font-bold text-white"
              style={{
                backgroundImage: actorImageUrl ? `url(${actorImageUrl})` : 'none',
                backgroundSize: 'cover',
                backgroundPosition: 'center',
                backgroundColor: actorImageUrl ? 'transparent' : getActorBackgroundColor(actor)
              }}
            >
              {!actorImageUrl && actor.name.substring(0, 2).toUpperCase()}
            </div>
          </div>
        );
      })}

      {/* Name tooltip */}
      {hoveredActorId && (
        <div 
          className="absolute z-30 bg-black/50 dark:bg-white/50 text-white dark:text-black px-2 py-1 rounded text-sm text-center"
          style={{
            left: getPixelPosition(hoveredActorId).x - 60,
            top: getPixelPosition(hoveredActorId).y - pieceRadius - 30,
            width: 120
          }}
        >
          {/* ✅ UPDATED: Use resolved actor name */}
          {actors.find(a => a.id === hoveredActorId)?.name}
        </div>
      )}
    </div>
  );
};

export default BattleMap;