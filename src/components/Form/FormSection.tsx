// components/Form/FormSection.tsx
import { ReactNode } from 'react';

interface FormSectionProps {
  title: string;
  description?: string;
  children: ReactNode;
}

export function FormSection({ title, description, children }: FormSectionProps) {
  return (
    <div className="card border-2 bg-base-100">
      <div className="card-body space-y-4">
        <div>
          <h3 className="text-lg font-semibold">{title}</h3>
          {description && (
            <p className="mt-1">{description}</p>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}