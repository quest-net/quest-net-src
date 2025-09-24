import React from 'react';
import { EntityReference, GameState } from '../../types/game';
import BasicObjectView from '../ui/BasicObjectView';
import {ReactComponent as FieldSVG} from '../ui/field.svg';
import { 
  getCatalogEntity, 
  getEntityReferenceName 
} from '../../utils/referenceHelpers';

interface FieldProps {
  field: EntityReference[];  // Now expects EntityReference[] instead of Entity[]
  gameState: GameState;      // Added gameState for catalog lookups
}

export function Field({ field, gameState }: FieldProps) {
  if (field.length === 0) {
    return null;
  }

  // Single enemy "boss" display
  if (field.length === 1) {
    const entityRef = field[0];
    const catalogEntity = getCatalogEntity(entityRef.catalogId, gameState);
    if (!catalogEntity) return null;

    const entityName = getEntityReferenceName(entityRef, gameState);
    const damageTaken = catalogEntity.maxHp - entityRef.hp;
    
    return (
      <div className=" relative mt-0 flex h-[95%] flex-col items-center shadow-inner shadow-offwhite dark:shadow-grey rounded-xl">
        <div className="absolute inset-0 pointer-events-none -z-10 overflow-hidden rounded-xl">
          <FieldSVG className="absolute w-[200%] h-[250%] -translate-x-1/4 -translate-y-1/4 fill-grey/20 dark:fill-offwhite/20" />
        </div>
        <h2 className="font-['BrunoAceSC'] rounded-xl mt-6 mb-6 py-4 bg-grey text-offwhite dark:bg-offwhite dark:text-grey text-2xl 2xl:text-3xl 3xl:text-4xl font-bold  p-8">
          {entityName}
        </h2>
        <div className="w-full flex justify-center">
          <BasicObjectView
            name=""
            imageId={catalogEntity.image}
            size="size=lg 2xl:size=xl"
            action={damageTaken > 0 ? {
              content: -damageTaken,
              onClick: () => {},
              disabled: true,
              lightColor: "magenta",
              darkColor: "red"
            } : undefined}
          />
        </div>
        <p className="mt-8 text-grey dark:text-offwhite text-md 2xl:text-lg 3xl:text-xl font-['Mohave'] font-bold text-center max-w-xl">
          {catalogEntity.description}
        </p>
      </div>
    );
  }

  // Multiple enemies grid display
  return (
    <div className="relative mt-6 flex h-[95%] flex-col items-center shadow-inner shadow-offwhite dark:shadow-grey rounded-xl">
      <div className="absolute inset-0 pointer-events-none -z-10 overflow-hidden rounded-xl">
          <FieldSVG className="absolute w-[200%] h-[250%] -translate-x-1/4 -translate-y-1/4 fill-grey/20 dark:fill-offwhite/20" />
        </div>
      <div className="grid grid-cols-2 gap-[2.6vmin] 2xl:gap-[3.5vmin] py-8">
        {field.map(entityRef => {
          const catalogEntity = getCatalogEntity(entityRef.catalogId, gameState);
          if (!catalogEntity) return null;

          const entityName = getEntityReferenceName(entityRef, gameState);
          const damageTaken = catalogEntity.maxHp - entityRef.hp;
          
          return (
            <div key={entityRef.instanceId}>
              <BasicObjectView
                name={entityName}
                imageId={catalogEntity.image}
                size="size=sm 2xl:size=md 3xl:size=lg"
                action={damageTaken > 0 ? {
                  content: -damageTaken,
                  onClick: () => {},
                  disabled: true,
                  lightColor: "magenta",
                  darkColor: "red"
                } : undefined}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}