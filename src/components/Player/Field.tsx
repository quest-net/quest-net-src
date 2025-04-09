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
      <div className=" relative mt-0 flex h-[95%] flex-col items-center shadow-inner shadow-offwhite dark:shadow-grey rounded-xl">
        <div className="absolute inset-0 pointer-events-none -z-10 overflow-hidden rounded-xl">
          <FieldSVG className="absolute w-[200%] h-[250%] -translate-x-1/4 -translate-y-1/4 fill-grey/20 dark:fill-offwhite/20" />
        </div>
        <h2 className="font-['BrunoAceSC'] rounded-xl mt-6 mb-6 py-4 bg-grey text-offwhite dark:bg-offwhite dark:text-grey text-2xl 2xl:text-3xl 3xl:text-4xl font-bold  p-8">{enemy.name}</h2>
        <div className="w-full flex justify-center">
          <BasicObjectView
            name=""
            imageId={enemy.image}
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
          {enemy.description}
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
        {field.map(entity => {
          const damageTaken = entity.maxHp - entity.hp;
          
          return (
            <div>
            <BasicObjectView
              key={entity.id}
              name={entity.name}
              imageId={entity.image}
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