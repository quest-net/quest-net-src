import React, { useState } from 'react';
import { DMViewProps, Entity } from "../../../types/game";
import StatGauges from '../../Player/StatGauges';
import { Plus, Minus } from 'lucide-react';
import { useCombatActions } from '../../../actions/combatActions';
import BasicObjectView from '../../ui/BasicObjectView';
import EntityView from '../../shared/EntityView';
import Modal from '../../shared/Modal';
import { ReactComponent as NPCBackground } from '../../ui/npc.svg';
import { ReactComponent as CharBackground } from '../../ui/char.svg';

interface BattleTabProps extends DMViewProps {}

export function BattleTab({ gameState, onGameStateChange, room, isRoomCreator }: BattleTabProps) {
  const [selectedInitiative, setSelectedInitiative] = useState<'party' | 'enemies'>('party');
  const [entityToView, setEntityToView] = useState<Entity | null>(null);
  
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

  const renderCombatant = (actor: Entity, type: 'party' | 'enemy') => (
    <div 
      key={actor.id} 
      id={actor.id}
      className={`
        border-2 rounded-xl p-6 mb-4 
        ${isInCombat && initiativeSide === (type === 'party' ? 'party' : 'enemies') ? 
          'border-blue dark:border-cyan' : 
          'border-grey dark:border-offwhite'
        }
      `}
    >
      <div className="flex items-center gap-4 ">
        <div className="w-48 flex-shrink-0">
          <BasicObjectView
            name={actor.name}
            imageId={actor.image}
            size="md"
            onClick={type === 'enemy' ? () => setEntityToView(actor) : undefined}
            action={type === 'enemy' ? {
              icon: 'minus',
              onClick: () => {
                onGameStateChange({
                  ...gameState,
                  field: gameState.field.filter(e => e.id !== actor.id)
                });
              }
            } : undefined}
          />
        </div>
        <div className="flex-1">
          <StatGauges
            character={actor}
            gameState={gameState}
            onGameStateChange={onGameStateChange}
            size="medium"
            showSideLabels={true}
          />
        </div>
      </div>
    </div>
  );

  return (
    <>
      <div className="grid h-full w-full" style={{
          gridTemplateColumns: '1fr 1fr',
          gridTemplateRows: '1fr 9fr',
          gap: '0',
          padding: '1vh'
        }}>
        <div style={{ gridColumn: '1 / 3', gridRow: '1' }} className="grid grid-cols-3 items-center px-4">
          <div className="flex justify-center">
            <button
              onClick={() => !isInCombat && setSelectedInitiative('party')}
              disabled={isInCombat}
              className={`
                px-6 py-2 rounded-xl border-2 shadow-lg border-blue dark:border-cyan transition-colors text-lg font-['Mohave'] font-bold
                ${(isInCombat ? initiativeSide : selectedInitiative) === 'party'
                  ? 'bg-blue dark:bg-cyan text-white dark:text-grey'
                  : '  text-grey dark:text-offwhite'
                }
              `}
            >
              Party Initiative
            </button>
          </div>

          <div className="flex flex-col justify-center items-center gap-4">
            {!isInCombat ? (
              <button 
                onClick={handleBattleStart}
                className="px-6 py-2 bg-grey hover:bg-red/75 dark:bg-offwhite dark:hover:bg-red/75 
                          text-offwhite font-['BrunoAceSC'] dark:text-grey rounded-md text-4xl font-medium transition-colors"
              >
                Start Battle
              </button>
            ) : (
              <>
                <div className="flex items-center gap-4">
                  <button
                    onClick={handlePreviousTurn}
                    disabled={currentTurn <= 1}
                    className="p-2 rounded-full hover:bg-grey/10 dark:hover:bg-offwhite/10 
                             disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    aria-label="Previous Turn"
                  >
                    <Minus size={24} />
                  </button>
                  <div className="text-2xl font-['BrunoAceSC']">
                    Turn {currentTurn}
                  </div>
                  <button
                    onClick={handleNextTurn}
                    className="p-2 rounded-full hover:bg-grey/10 dark:hover:bg-offwhite/10 transition-colors"
                    aria-label="Next Turn"
                  >
                    <Plus size={24} />
                  </button>
                </div>
                <button
                  onClick={combatActions.endCombat}
                  className="px-4 py-1.5 bg-magenta/90 hover:bg-magenta dark:bg-red/90 dark:hover:bg-red 
                           text-white dark:text-grey rounded-md transition-colors text-sm font-medium"
                >
                  End Combat
                </button>
              </>
            )}
          </div>

          <div className="flex justify-center">
            <button
              onClick={() => !isInCombat && setSelectedInitiative('enemies')}
              disabled={isInCombat}
              className={`
                px-6 py-2 rounded-xl border-2 shadow-lg border-purple dark:border-pink transition-colors text-lg font-['Mohave'] font-bold
                ${(isInCombat ? initiativeSide : selectedInitiative) === 'enemies'
                  ? 'bg-purple dark:bg-pink text-white dark:text-grey'
                  : ' text-grey dark:text-offwhite'
                }
              `}
            >
              Enemy Initiative
            </button>
          </div>
        </div>

        <div style={{ gridColumn: '1', gridRow: '2' }} 
             className="relative p-4 overflow-y-auto scrollable border-r-2 border-grey dark:border-offwhite">
          {/* Background Character SVG with gradient */}
          <div className="absolute inset-0 pointer-events-none overflow-hidden -z-10">
            <CharBackground className="absolute -bottom-[20%] -left-[20%] w-[140%] h-[140%] fill-grey/25 dark:fill-offwhite/25" />
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

          <h3 className="text-xl mb-4 mx-36 font-['BrunoAceSC'] bg-blue text-offwhite dark:text-grey dark:bg-cyan 
                        rounded-lg p-2 text-center">
            Party Members
          </h3>
          <div className="space-y-4 bg-offwhite/80 dark:bg-grey/80">
            {gameState.party.map(character => renderCombatant(character, 'party'))}
          </div>
        </div>

        <div style={{ gridColumn: '2', gridRow: '2' }} 
             className=" relative border-l-2 border-grey dark:border-offwhite p-4 overflow-y-auto scrollable">

              {/* Background NPC SVG with gradient */}
          <div className="absolute inset-0 pointer-events-none overflow-hidden -z-10">
            <NPCBackground className="absolute -bottom-[20%] -left-[20%] w-[140%] h-[140%] fill-grey/25 dark:fill-offwhite/25" />
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
          <h3 className="text-xl mb-4 mx-36 font-['BrunoAceSC'] bg-purple text-offwhite dark:text-grey dark:bg-pink 
                        rounded-lg p-2 text-center">
            Field Enemies
          </h3>
          <div className="space-y-4 bg-offwhite/80 dark:bg-grey/80">
            {gameState.field.map(entity => renderCombatant(entity, 'enemy'))}
          </div>
        </div>
      </div>

      {/* Entity View Modal */}
      {entityToView && (
        <Modal
          isOpen={true}
          onClose={() => setEntityToView(null)}
          title={entityToView.name}
        >
          <EntityView
            entity={entityToView}
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