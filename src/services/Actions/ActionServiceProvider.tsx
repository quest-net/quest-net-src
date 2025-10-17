// services/ActionServiceProvider.tsx

import { createContext, useContext, useState, ReactNode } from 'react';
import { ActionService } from './ActionService';

interface ActionServiceContextValue {
  actionService: ActionService | null;
  setActionService: (service: ActionService | null) => void;
}

const ActionServiceContext = createContext<ActionServiceContextValue | null>(null);

export function ActionServiceProvider({ children }: { children: ReactNode }) {
  const [actionService, setActionService] = useState<ActionService | null>(null);

  return (
    <ActionServiceContext.Provider value={{ actionService, setActionService }}>
      {children}
    </ActionServiceContext.Provider>
  );
}

export function useActionService() {
  const context = useContext(ActionServiceContext);
  if (!context) {
    throw new Error('useActionService must be used within ActionServiceProvider');
  }
  return context;
}