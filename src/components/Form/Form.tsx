// components/Form/Form.tsx
import { createContext, useContext, useState, useEffect, ReactNode, ReactElement, cloneElement } from 'react';
import { isDmAccess } from '../../utils/UrlParser';

// ============================================================================
// CONTEXT
// ============================================================================

type FormMode = 'create' | 'edit' | 'view';

interface FormContextValue {
  mode: FormMode;
  readOnly: boolean;
  isDirty: boolean;
  setDirty: (dirty: boolean) => void;
}

const FormContext = createContext<FormContextValue | null>(null);

export function useFormContext() {
  const context = useContext(FormContext);
  if (!context) {
    throw new Error('Form components must be used within FormWrapper');
  }
  return context;
}

// Export a hook that returns readOnly but doesn't throw if not in a form
export function useFormReadOnly(): boolean {
  const context = useContext(FormContext);
  return context?.readOnly ?? false;
}

// ============================================================================
// FORM WRAPPER (Main Component)
// ============================================================================

interface FormWrapperProps<T> {
  entityId?: string;
  initialData: T;
  onSave: (data: T) => void;
  onClose: () => void;
  createTitle: string;
  editTitle: string;
  viewTitle: string;
  children: ReactNode;
}

export function FormWrapper<T extends Record<string, any>>({
  entityId,
  initialData,
  onSave,
  onClose,
  createTitle,
  editTitle,
  viewTitle,
  children
}: FormWrapperProps<T>) {
  // Determine mode
  const mode: FormMode = !entityId ? 'create' : isDmAccess() ? 'edit' : 'view';
  const readOnly = mode === 'view';

  // State management
  const [data, setData] = useState<T>(initialData);
  const [isDirty, setDirty] = useState(mode === 'create');

  // Track changes for dirty state
  useEffect(() => {
    if (mode === 'create') {
      setDirty(true);
      return;
    }
    
    const originalData = JSON.stringify(initialData);
    const currentData = JSON.stringify(data);
    setDirty(originalData !== currentData);
  }, [data, initialData, mode]);

  const handleSave = () => {
    onSave(data);
    setDirty(false);
    onClose();
  };

  const contextValue: FormContextValue = {
    mode,
    readOnly,
    isDirty,
    setDirty
  };

  // Inject data and setData into children
  const childrenWithProps = cloneElement(children as ReactElement, {
    data,
    onChange: setData
  });

  return (
    <FormContext.Provider value={contextValue}>
      <div className="space-y-6 max-w-4xl">
        <FormHeader
          createTitle={createTitle}
          editTitle={editTitle}
          viewTitle={viewTitle}
          onSave={handleSave}
          onClose={onClose}
        />
        
        {childrenWithProps}

        {!readOnly && (
          <div className="flex justify-end gap-2">
            <button onClick={onClose} className="btn btn-neutral">
              Cancel
            </button>
            <button onClick={handleSave} className="btn btn-primary">
              {mode === 'create' ? 'Create' : 'Save Changes'}
            </button>
          </div>
        )}
      </div>
    </FormContext.Provider>
  );
}

// ============================================================================
// FORM HEADER
// ============================================================================

interface FormHeaderProps {
  createTitle: string;
  editTitle: string;
  viewTitle: string;
  onSave: () => void;
  onClose: () => void;
}

function FormHeader({ createTitle, editTitle, viewTitle, onSave, onClose }: FormHeaderProps) {
  const { mode, readOnly, isDirty } = useFormContext();
  
  const title = mode === 'create' ? createTitle : mode === 'edit' ? editTitle : viewTitle;

  return (
    <div className="flex justify-between items-center">
      <h2 className="text-2xl font-bold">{title}</h2>
      <div className="flex items-center gap-4">
        {isDirty && !readOnly && (
          <span className="text-sm text-warning italic">You have unsaved changes</span>
        )}
        {!readOnly && (
          <button onClick={onSave} className="btn btn-primary">
            {mode === 'create' ? 'Create' : 'Save Changes'}
          </button>
        )}
        <button onClick={onClose} className="btn btn-neutral">
          {readOnly ? 'Close' : 'Cancel'}
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// FORM SECTION
// ============================================================================

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
            <p>{description}</p>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}

// ============================================================================
// FORM FIELD
// ============================================================================

interface FormFieldProps {
  label: string;
  hint?: string;
  children: ReactElement;
  span?: number; // Number of grid columns to span (default: 1)
}

export function FormField({ label, hint, children, span = 1 }: FormFieldProps) {
  const { readOnly } = useFormContext();

  // Clone the child element and inject readonly/disabled props
  const childWithReadOnly = cloneElement(children, {
    disabled: readOnly || children.props.disabled,
    readOnly: readOnly || children.props.readOnly,
  });

  // Map span to Tailwind class (must be explicit for Tailwind to detect)
  const colSpanClass = {
    1: '',
    2: 'col-span-2',
    3: 'col-span-3',
    4: 'col-span-4',
  }[span] || '';

  return (
    <div className={`flex items-center gap-4 ${colSpanClass}`}>
      <label className="flex-shrink-0 min-w-[200px] font-medium">
        {label}
        {hint && <span className="text-sm text-base-content/60 ml-2">{hint}</span>}
      </label>
      <div className="flex-1">
        {childWithReadOnly}
      </div>
    </div>
  );
}

// ============================================================================
// FORM GRID
// ============================================================================

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