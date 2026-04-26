// components/Form/Form.tsx
import {
	createContext,
	useContext,
	useState,
	useEffect,
	ReactNode,
	ReactElement,
	cloneElement,
} from "react";
import { useQuestContext } from "../../domains/Context/ContextProvider";
import { canPerformAction } from "../../services/Actions/ActionRegistry";

// ============================================================================
// CONTEXT
// ============================================================================

type FormMode = "create" | "edit" | "view";

interface ButtonConfig {
	showTopCancel?: boolean;
	showTopSave?: boolean;
	showBottomButtons?: boolean;
}

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
		throw new Error("Form components must be used within FormWrapper");
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
	domain: string;
	entityId?: string;
	initialData: T;
	onSave: (data: T) => void;
	onClose: () => void;
	onClone?: (data: T) => void;
	onDelete?: () => void;
	createTitle: string;
	editTitle: string;
	viewTitle: string;
	children: ReactNode;
	buttonConfig?: ButtonConfig;
	/**
	 * When true, the form wrapper stretches to fill its container instead of
	 * being constrained to max-w-4xl. Use for editors that need a full-page
	 * layout (e.g. TerrainEdit's editor + preview split).
	 */
	fullWidth?: boolean;
}

export function FormWrapper<T extends Record<string, any>>({
	domain,
	entityId,
	initialData,
	onSave,
	onClose,
	onClone,
	onDelete,
	createTitle,
	editTitle,
	viewTitle,
	children,
	buttonConfig = {},
	fullWidth = false,
}: FormWrapperProps<T>) {
	const context = useQuestContext();
	
	// Destructure button config with defaults
	const {
		showTopCancel = true,
		showTopSave = true,
		showBottomButtons = true,
	} = buttonConfig;

	// Check permissions for this domain
	const canCreate = canPerformAction(context.User, `${domain}:create`);
	const canEdit = canPerformAction(context.User, `${domain}:edit`);
	const canDelete =
		entityId && onDelete && canPerformAction(context.User, `${domain}:delete`);

	// Determine mode based on permissions
	const mode: FormMode =
		!entityId && canCreate ? "create" : entityId && canEdit ? "edit" : "view";

	const readOnly = mode === "view";

	// State management
	const [data, setData] = useState<T>(initialData);
	const [isDirty, setDirty] = useState(mode === "create");

	// Delete confirmation state
	const [isDeleteConfirm, setIsDeleteConfirm] = useState(false);
	const [isDeleteCooldown, setIsDeleteCooldown] = useState(false);

	// Track changes for dirty state
	useEffect(() => {
		if (mode === "create") {
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

	const handleClone = () => {
		if (onClone) {
			onClone(data);
		}
	};

	const handleDelete = () => {
		if (!isDeleteConfirm) {
			// First click - enter confirmation mode
			setIsDeleteConfirm(true);
			setIsDeleteCooldown(true);
			setTimeout(() => setIsDeleteCooldown(false), 500);
		} else {
			// Second click - execute delete
			if (onDelete) {
				onDelete();
				onClose();
			}
		}
	};

	const contextValue: FormContextValue = {
		mode,
		readOnly,
		isDirty,
		setDirty,
	};

	// Inject data and setData into children
	const childrenWithProps = cloneElement(children as ReactElement<any>, {
		data,
		onChange: setData,
	});

	return (
		<FormContext.Provider value={contextValue}>
			<div className={`space-y-6 ${fullWidth ? "w-full" : "max-w-4xl"}`}>
				<FormHeader
					createTitle={createTitle}
					editTitle={editTitle}
					viewTitle={viewTitle}
					onSave={handleSave}
					onClose={onClose}
					onClone={handleClone}
					showClone={mode === "edit" && !!onClone}
					showCancel={showTopCancel}
					showSave={showTopSave}
				/>

				{childrenWithProps}

				{!readOnly && showBottomButtons && (
					<div className="flex justify-between gap-2">
						<div>
							{canDelete && (
								<button
									onClick={handleDelete}
									className="btn btn-error"
									disabled={isDeleteCooldown}
								>
									{isDeleteConfirm ? "Click again to delete" : "Delete"}
								</button>
							)}
						</div>
						<div className="flex gap-2">
							<button onClick={onClose} className="btn btn-neutral">
								Cancel
							</button>
							<button onClick={handleSave} className="btn btn-primary">
								{mode === "create" ? "Create" : "Save Changes"}
							</button>
						</div>
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
	onClone: () => void;
	showClone: boolean;
	showCancel: boolean;
	showSave: boolean;
}

function FormHeader({
	createTitle,
	editTitle,
	viewTitle,
	onSave,
	onClose,
	onClone,
	showClone,
	showCancel,
	showSave,
}: FormHeaderProps) {
	const { mode, readOnly, isDirty } = useFormContext();

	const title =
		mode === "create" ? createTitle : mode === "edit" ? editTitle : viewTitle;

	return (
		<div className="flex justify-between items-center">
			<h2 className="text-2xl font-bold">{title}</h2>
			<div className="flex items-center gap-4">
				{isDirty && !readOnly && (
					<span className="text-sm text-warning italic">
						You have unsaved changes
					</span>
				)}
				{showClone && (
					<button onClick={onClone} className="btn btn-outline">
						Clone
					</button>
				)}
				{!readOnly && showSave &&(
					<button onClick={onSave} className="btn btn-primary">
						{mode === "create" ? "Create" : "Save Changes"}
					</button>
				)}
				{showCancel && (
					<button onClick={onClose} className="btn btn-neutral">
						{readOnly ? "Close" : "Cancel"}
					</button>
				)}
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

export function FormSection({
	title,
	description,
	children,
}: FormSectionProps) {
	return (
		<div className="card border-2 bg-base-100">
			<div className="card-body space-y-4">
				<div>
					<h3 className="text-lg font-semibold">{title}</h3>
					{description && <p>{description}</p>}
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
	const childWithReadOnly = cloneElement(children as ReactElement<any>, {
		disabled: readOnly || (children as ReactElement<any>).props.disabled,
		readOnly: readOnly || (children as ReactElement<any>).props.readOnly,
	});

	// Map span to Tailwind class (must be explicit for Tailwind to detect)
	const colSpanClass =
		{
			1: "",
			2: "col-span-2",
			3: "col-span-3",
			4: "col-span-4",
		}[span] || "";

	return (
		<div className={`flex items-center gap-4 ${colSpanClass}`}>
			<label className="shrink-0 min-w-[200px] font-medium">
				{label}
				{hint && (
					<span className="text-sm text-base-content/60 ml-2">{hint}</span>
				)}
			</label>
			<div className="flex-1">{childWithReadOnly}</div>
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
		1: "grid-cols-1",
		2: "grid-cols-1 md:grid-cols-2",
		3: "grid-cols-1 md:grid-cols-2 lg:grid-cols-3",
		4: "grid-cols-1 md:grid-cols-2 lg:grid-cols-4",
	}[cols];

	return <div className={`grid ${gridClass} gap-4`}>{children}</div>;
}
