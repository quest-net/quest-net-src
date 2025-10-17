// components/Form/FormGrid.tsx
import { ReactNode } from 'react';

interface FormGridProps {
  cols?: 1 | 2 | 3 | 4;
  children: ReactNode;
}

export function FormGrid({ cols = 2, children }: FormGridProps) {
  const gridClass = {
    1: 'grid-cols-1',
    2: 'grid-cols-1 md:grid-cols-2',
    3: 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3',
    4: 'grid-cols-1 md:grid-cols-2 lg:grid-cols-4'
  }[cols];

  return (
    <div className={`grid ${gridClass} gap-4`}>
      {children}
    </div>
  );
}