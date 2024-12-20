import React from 'react';
import { Entity } from '../../types/game';
import BasicObjectView from '../ui/BasicObjectView';
import {ReactComponent as FieldSVG} from '../ui/field.svg';
interface FieldProps {
  field: Entity[];
}

export function Field({ field }: FieldProps) {
  if (field.length === 0) {
    return null;
  }

  // Single enemy "boss" display
  if (field.length === 1) {
    const enemy = field[0];
    const damageTaken = enemy.maxHp - enemy.hp;
    
    return (
      <div className=" relative mt-6 flex h-[95%] flex-col items-center shadow-inner shadow-offwhite dark:shadow-grey rounded-xl">
        <div className="absolute inset-0 pointer-events-none -z-10 overflow-hidden rounded-xl">
          <FieldSVG className="absolute scale-[200%] -bottom-1/2 -left-0 w-full h-full fill-grey/20 dark:fill-offwhite/20" />
        </div>
        <h2 className="font-['BrunoAceSC'] text-4xl font-bold mb-2 p-8">{enemy.name}</h2>
        <div className="w-full flex justify-center">
          <BasicObjectView
            name=""
            imageId={enemy.image}
            size="xl"
            action={damageTaken > 0 ? {
              content: -damageTaken,
              onClick: () => {},
              disabled: true
            } : undefined}
          />
        </div>
        <p className="mt-4 text-grey dark:text-offwhite text-xl font-['Mohave'] font-bold text-center max-w-xl">
          {enemy.description}
        </p>
      </div>
    );
  }

  // Multiple enemies grid display
  return (
    <div className="relative mt-6 flex h-[95%] flex-col items-center shadow-inner shadow-offwhite dark:shadow-grey rounded-xl">
      <div className="absolute inset-0 pointer-events-none -z-10 overflow-hidden rounded-xl">
          <FieldSVG className="absolute scale-[200%] -bottom-1/2 -left-0 w-full h-full fill-grey/20 dark:fill-offwhite/20" />
        </div>
      <div className="grid grid-cols-2 gap-[3.5vmin] py-8">
        {field.map(entity => {
          const damageTaken = entity.maxHp - entity.hp;
          
          return (
            <BasicObjectView
              key={entity.id}
              name={entity.name}
              imageId={entity.image}
              size="md"
              action={damageTaken > 0 ? {
                content: -damageTaken,
                onClick: () => {},
                disabled: true
              } : undefined}
            />
          );
        })}
      </div>
    </div>
  );
}