import React, { useState } from 'react';
import { DMViewProps, Entity, EntityReference } from "../../../types/game";
import StatGauges from '../../Player/StatGauges';
import { ChevronLeft, ChevronRight, Minus } from 'lucide-react';
import { useCombatActions } from '../../../actions/combatActions';
import BasicObjectView from '../../ui/BasicObjectView';
import EntityView from '../../shared/EntityView';
import Modal from '../../shared/Modal';
import { ReactComponent as NPCBackground } from '../../ui/npc.svg';
import { ReactComponent as CharBackground } from '../../ui/char.svg';
import BattleMap from '../../shared/BattleMap';
import { getCatalogEntity } from '../../../utils/referenceHelpers';

interface BattleTabProps extends DMViewProps {}

export function BattleTab({ gameState, onGameStateChange, room, isRoomCreator }: BattleTabProps) {
  const [selectedInitiative, setSelectedInitiative] = useState<'party' | 'enemies'>('party');
  // ✅ UPDATED: Changed to store instanceId instead of full entity
  const [entityToView, setEntityToView] = useState<string | null>(null);
  
  const isInCombat = gameState.combat?.isActive ?? false;
  const currentTurn = gameState.combat?.currentTurn ?? 0;
  const initiativeSide = gameState.combat?.initiativeSide ?? 'party';

  const combatActions = useCombatActions(room, gameState, onGameStateChange, isRoomCreator);
  
  const handleBattleStart = () => {
    combatActions.startCombat(selectedInitiative);
  };

  const handleNextTurn = () => {
    combatActions.nextTurn();
  };

  const handlePreviousTurn = () => {
    combatActions.previousTurn();
  };

  // ✅ UPDATED: Support both Character and EntityReference with unified interface
  const renderCombatant = (actor: Entity | EntityReference, type: 'party' | 'enemy') => {
    // Determine if this is a character (Entity) or field entity (EntityReference)
    const isEntityReference = 'instanceId' in actor;
    const isCharacter = type === 'party';

    // Get display properties and StatGauges-compatible object
    let displayId: string, displayName: string, displayImage: string | undefined;
    let statGaugesActor: Entity;
    
    if (isEntityReference) {
      // Field entity - resolve from catalog and merge with instance data
      const catalogEntity = getCatalogEntity(actor.catalogId, gameState);
      displayId = actor.instanceId;
      displayName = catalogEntity?.name || 'Unknown Entity';
      displayImage = catalogEntity?.image;
      
      // ✅ FIXED: Create Entity-compatible object for StatGauges
      statGaugesActor = {
        ...catalogEntity!,
        hp: actor.hp,
        sp: actor.sp,
        // Use instanceId as id for StatGauges (it needs an id field)
        id: actor.instanceId
      };
    } else {
      // Character - direct access
      displayId = actor.id;
      displayName = actor.name;
      displayImage = actor.image;
      statGaugesActor = actor;
    }

    return (
      <div
        key={displayId} // ✅ Fixed: Use instanceId for EntityReference
        id={displayId}
        className={`
          border-0 rounded-xl p-2 mb-4 
          ${isInCombat && initiativeSide === (type === 'party' ? 'party' : 'enemies') ? 
            'border-blue dark:border-cyan' : 
            'border-grey dark:border-offwhite'
          }
        `}
      >
        <div className="flex items-center gap-2">
          <div className="flex-shrink-0">
            <BasicObjectView
              name={displayName}
              imageId={displayImage}
              size="size=md xl:size=sm 2xl:size=md 3xl:size=lg"
              onClick={type === 'enemy' ? () => setEntityToView(displayId) : undefined}
            />
          </div>
          <div className="flex-1 flex items-center gap-0">
            <div className="flex-1">
              <StatGauges
                character={statGaugesActor} // ✅ FIXED: Use resolved Entity-compatible object
                gameState={gameState}
                onGameStateChange={onGameStateChange}
                size="medium"
                showSideLabels={true}
                room={room}
                isRoomCreator={true}
              />
            </div>
            {type === 'enemy' && (
              <button
                onClick={() => {
                  onGameStateChange({
                    ...gameState,
                    // ✅ FIXED: Use instanceId for EntityReference filtering
                    field: gameState.field.filter(e => e.instanceId !== displayId)
                  });
                }}
                className="
                  w-12 h-12
                  rotate-45
                  border-2
                  border-magenta
                  dark:border-red
                  text-red
                  dark:text-red
                  bg-offwhite
                  dark:bg-grey
                  rounded
                  flex
                  items-center
                  justify-center
                  hover:border-4
                  transition-all
                "
              >
                <div className="-rotate-45">
                  <Minus className="w-6 h-6" strokeWidth={3} />
                </div>
              </button>
            )}
          </div>
        </div>
      </div>
    );
  };

  // ✅ Helper function to get EntityReference for modal
  const getEntityReferenceForModal = (instanceId: string): EntityReference | undefined => {
    return gameState.field.find(e => e.instanceId === instanceId);
  };

  return (
    <>
      <div className="grid h-full w-full" style={{
          gridTemplateColumns: '2fr 3fr 2fr',
          gridTemplateRows: '1fr 9fr',
          gap: '0',
          padding: '1vh'
        }}>
        {/* Top Bar */}
        <div className='grid grid-rows-1 grid-cols-1'>
          <div className="flex justify-center">
            <button
              onClick={() => !isInCombat && setSelectedInitiative('party')}
              disabled={isInCombat}
              className={`
                px-6 py-2 m-6 rounded-xl border-2 shadow-lg border-blue dark:border-cyan transition-colors text-lg font-['Mohave'] font-bold
                ${(isInCombat ? initiativeSide : selectedInitiative) === 'party'
                  ? 'bg-blue dark:bg-cyan text-white dark:text-grey'
                  : 'text-grey dark:text-offwhite'
                }
              `}
            >
              Party Initiative
            </button>
          </div>
        </div>

        <div className="flex justify-center">
          {!isInCombat ? (
            <button 
              onClick={handleBattleStart}
              className="px-6 py-2 m-6 bg-grey hover:bg-magenta dark:bg-offwhite dark:hover:bg-red
                        text-offwhite font-['BrunoAceSC'] dark:text-grey rounded-md text-4xl font-medium transition-colors"
            >
              Start Battle
            </button>
          ) : null}
        </div>

        <div className="flex justify-center">
          <button
            onClick={() => !isInCombat && setSelectedInitiative('enemies')}
            disabled={isInCombat}
            className={`
              px-6 py-2 m-6 rounded-xl border-2 shadow-lg border-purple dark:border-pink transition-colors text-lg font-['Mohave'] font-bold
              ${(isInCombat ? initiativeSide : selectedInitiative) === 'enemies'
                ? 'bg-purple dark:bg-pink text-white dark:text-grey'
                : 'text-grey dark:text-offwhite'
              }
            `}
          >
            Enemy Initiative
          </button>
        </div>

        {/* Party Members Column */}
        <div style={{ gridColumn: '1', gridRow: '2' }} 
             className="relative p-4 overflow-y-auto scrollable border-r-2 border-grey dark:border-offwhite">
          <div className="absolute inset-0 pointer-events-none overflow-hidden -z-10">
            <CharBackground className="absolute -bottom-[100%] -left-[20%] w-[300%] h-[300%] fill-grey/25 dark:fill-offwhite/25" />
            <div 
              className="absolute inset-0" 
              style={{
                background: `linear-gradient(to right, 
                  var(--color-background) 0%, 
                  transparent 20%, 
                  transparent 50%, 
                  var(--color-background) 100%)`
              }}
            />
          </div>
          <div className="space-y-4 bg-offwhite/80 dark:bg-grey/80">
            {gameState.party.map(character => renderCombatant(character, 'party'))}
          </div>
        </div>

        {/* Battle Map and Controls Column */}
        {isInCombat && (
          <div style={{ gridColumn: '2', gridRow: '2' }} className="relative p-4">
            <div className="flex items-center justify-center gap-4 mb-4">
              <button
                onClick={handlePreviousTurn}
                disabled={currentTurn <= 1}
                className="border-2 border-b-4 border-grey dark:border-offwhite p-4 active:border-b-2 rounded-lg hover:bg-grey/10 dark:hover:bg-offwhite/10 
                        disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                aria-label="Previous Turn"
              >
                <ChevronLeft size={32} />
              </button>

              <div className={`
                px-6 py-4 rounded-lg font-['BrunoAceSC'] text-3xl
                ${gameState.combat?.initiativeSide === 'party' 
                  ? 'bg-blue dark:bg-cyan text-white dark:text-grey'
                  : 'bg-purple dark:bg-pink text-white dark:text-grey'}
              `}>
                Turn {currentTurn}
              </div>

              <button
                onClick={handleNextTurn}
                className="border-2 border-b-4 border-grey dark:border-offwhite p-4 rounded-lg active:border-b-2 hover:bg-grey/10 dark:hover:bg-offwhite/10 transition-colors"
                aria-label="Next Turn"
              >
                <ChevronRight size={32} />
              </button>
            </div>

            <div className="h-[calc(60%)]">
              <BattleMap
                gameState={gameState}
                onGameStateChange={onGameStateChange}
                room={room}
                isRoomCreator={true}
              />
            </div>
            <div className="flex mt-2 justify-end">
              <button
                onClick={combatActions.endCombat}
                className="px-6 py-2 bg-magenta/90 hover:bg-magenta dark:bg-red/90 dark:hover:bg-red 
                        text-white dark:text-grey rounded-md transition-colors text-xl font-medium font-['Mohave']"
              >
                End Combat
              </button>
            </div>
          </div>
        )}

        {/* Enemies Column */}
        <div style={{ gridColumn: '3', gridRow: '2' }} 
             className="relative border-l-2 border-grey dark:border-offwhite p-4 overflow-y-auto scrollable">
          <div className="absolute inset-0 pointer-events-none overflow-hidden -z-10">
            <NPCBackground className="absolute -bottom-[100%] -left-[20%] w-[300%] h-[300%] fill-grey/25 dark:fill-offwhite/25" />
            <div
              className="absolute inset-0" 
              style={{
                background: `linear-gradient(to right, 
                  var(--color-background) 0%, 
                  transparent 20%, 
                  transparent 50%, 
                  var(--color-background) 100%)`
              }}
            />
          </div>
          <div className="space-y-4 bg-offwhite/80 dark:bg-grey/80">
            {/* ✅ UPDATED: Field entities are now EntityReference[] */}
            {gameState.field.map(entityRef => renderCombatant(entityRef, 'enemy'))}
          </div>
        </div>
      </div>

      {/* ✅ UPDATED: Entity View Modal using new dual-interface */}
      {entityToView && getEntityReferenceForModal(entityToView) && (
        <Modal
          isOpen={true}
          onClose={() => setEntityToView(null)}
        >
          <EntityView
            entityReference={getEntityReferenceForModal(entityToView)!} // ✅ Safe to use ! since we checked above
            onClose={() => setEntityToView(null)}
            gameState={gameState}
            onGameStateChange={onGameStateChange}
            room={room}
          />
        </Modal>
      )}
    </>
  );
}