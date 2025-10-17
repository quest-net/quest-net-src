// components/Form/FormField.tsx
import { ReactNode } from 'react';

interface FormFieldProps {
  label: string;
  hint?: string;
  children: ReactNode;
}

export function FormField({ label, hint, children }: FormFieldProps) {
  return (
    <div className="form-control flex flex-row justify-between items-center w-96">
      <label>
        <span className="mr-2">{label}</span>
        {hint && <span>{hint}</span>}
      </label>
      {children}
    </div>
  );
}