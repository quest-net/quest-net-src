// components/Form/Form.tsx
import {
	createContext,
	useContext,
	useState,
	useEffect,
	useRef,
	useCallback,
	useId,
	ReactNode,
	ReactElement,
	RefObject,
	cloneElement,
} from "react";
import { createPortal } from "react-dom";
import { useQuestContext } from "../../domains/Context/ContextProvider";
import { canPerformAction } from "../../services/Actions/ActionRegistry";
import { setFormDirty, clearFormDirty } from "../../utils/formDirtyRegistry";
import { FloatingActionButton } from "../ui/FloatingActionButton";

// ============================================================================
// CONTEXT
// ============================================================================

type FormMode = "create" | "edit" | "view";
type SaveBlocker = () => string | null | undefined;

interface ButtonConfig {
	showTopCancel?: boolean;
	showTopSave?: boolean;
	showBottomButtons?: boolean;
	/**
	 * When true, a floating action bar appears at the bottom-right of the
	 * viewport whenever the form's real action buttons (header and bottom row)
	 * are scrolled offscreen. Useful for long forms (settings, campaign config).
	 */
	keepButtonsVisible?: boolean;
}

interface FormContextValue {
	mode: FormMode;
	readOnly: boolean;
	isDirty: boolean;
	setDirty: (dirty: boolean) => void;
	registerSaveResolver: (resolver: (() => unknown) | null) => () => void;
	registerSaveBlocker: (blocker: SaveBlocker | null) => () => void;
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
// FLOATING ACTION BAR (keep buttons visible when scrolled offscreen)
// ============================================================================

/**
 * Tracks whether the referenced element is currently scrolled out of the
 * viewport. Returns false (i.e. "visible") while disabled or before the
 * observer has reported. Re-attaches when the ref's element changes.
 */
export function useIsOffscreen<E extends HTMLElement>(
	ref: RefObject<E | null>,
	enabled: boolean
): boolean {
	const [offscreen, setOffscreen] = useState(false);

	useEffect(() => {
		const el = ref.current;
		if (!enabled || !el) {
			setOffscreen(false);
			return;
		}
		const observer = new IntersectionObserver(
			([entry]) => setOffscreen(!entry.isIntersecting),
			{ threshold: 0 }
		);
		observer.observe(el);
		return () => observer.disconnect();
	}, [ref, enabled]);

	return enabled ? offscreen : false;
}

interface FloatingActionBarProps {
	show: boolean;
	children: ReactNode;
}

/**
 * Renders its children as free-floating elements anchored to the bottom-right
 * of the viewport via a portal (so it ignores transformed/overflow ancestors).
 * No background/container chrome — just positioning. Rendered only when `show`
 * is true.
 */
export function FloatingActionBar({ show, children }: FloatingActionBarProps) {
	if (!show) return null;
	return createPortal(
		<div className="fixed bottom-4 right-4 z-[60] flex gap-2">{children}</div>,
		document.body
	);
}

// ============================================================================
// FORM WRAPPER (Main Component)
// ============================================================================

interface FormWrapperProps<T> {
	domain: string;
	/**
	 * Permission domain for the edit/delete gates, when it differs from `domain`.
	 * Defaults to `domain`. Character/Entity forms set this to "actor" because
	 * their edit/delete go through the unified `actor:*` actions, while create
	 * stays domain-specific (`character:create` / `entity:create`).
	 */
	mutationDomain?: string;
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
	mutationDomain,
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
		keepButtonsVisible = false,
	} = buttonConfig;

	// Check permissions for this domain. Create stays on `domain`; edit/delete use
	// `mutationDomain` when provided (e.g. "actor" for Characters/Entities).
	const mutDomain = mutationDomain ?? domain;
	const canCreate = canPerformAction(context.User, `${domain}:create`);
	const canEdit = canPerformAction(context.User, `${mutDomain}:edit`);
	const canDelete =
		entityId && onDelete && canPerformAction(context.User, `${mutDomain}:delete`);

	// Determine mode based on permissions
	const mode: FormMode =
		!entityId && canCreate ? "create" : entityId && canEdit ? "edit" : "view";

	const readOnly = mode === "view";

	// State management
	const [data, setDataState] = useState<T>(initialData);
	const [isDirty, setDirty] = useState(mode === "create");
	const [saveError, setSaveError] = useState<string | null>(null);
	const dataRef = useRef<T>(initialData);
	const saveResolverRef = useRef<(() => T) | null>(null);
	const saveBlockersRef = useRef<Set<SaveBlocker>>(new Set());

	// Report this form's dirty state into the app-wide registry so concerns
	// outside the form (e.g. idle auto-refresh) can avoid discarding unsaved work.
	const formId = useId();
	useEffect(() => {
		setFormDirty(formId, isDirty && !readOnly);
		return () => clearFormDirty(formId);
	}, [formId, isDirty, readOnly]);

	// Delete confirmation state
	const [isDeleteConfirm, setIsDeleteConfirm] = useState(false);
	const [isDeleteCooldown, setIsDeleteCooldown] = useState(false);

	// Floating-button tracking: show floating actions when the real button rows
	// (header + optional bottom row) are scrolled out of view.
	const headerButtonsRef = useRef<HTMLDivElement>(null);
	const bottomButtonsRef = useRef<HTMLDivElement>(null);
	const hasBottomButtons = !readOnly && showBottomButtons;
	const headerOffscreen = useIsOffscreen(headerButtonsRef, keepButtonsVisible);
	const bottomOffscreen = useIsOffscreen(
		bottomButtonsRef,
		keepButtonsVisible && hasBottomButtons
	);
	const showFloating =
		keepButtonsVisible &&
		headerOffscreen &&
		(!hasBottomButtons || bottomOffscreen);

	useEffect(() => {
		if (mode === "create") {
			setDirty(true);
		}
	}, [mode]);

	useEffect(() => {
		dataRef.current = data;
	}, [data]);

	const setData = useCallback(
		(nextData: T) => {
			dataRef.current = nextData;
			setDataState(nextData);
			setSaveError(null);
			if (mode !== "view") {
				setDirty(true);
			}
		},
		[mode]
	);

	const registerSaveResolver = useCallback(
		(resolver: (() => unknown) | null) => {
			saveResolverRef.current = resolver as (() => T) | null;
			return () => {
				if (saveResolverRef.current === resolver) {
					saveResolverRef.current = null;
				}
			};
		},
		[]
	);

	const registerSaveBlocker = useCallback(
		(blocker: SaveBlocker | null) => {
			if (!blocker) return () => {};
			saveBlockersRef.current.add(blocker);
			return () => {
				saveBlockersRef.current.delete(blocker);
			};
		},
		[]
	);

	const resolveSaveData = (): T => {
		const resolvedData = saveResolverRef.current?.();
		if (resolvedData !== undefined) {
			const typedData = resolvedData as T;
			dataRef.current = typedData;
			setDataState(typedData);
			return typedData;
		}
		return dataRef.current;
	};

	const getSaveBlockMessage = (): string | null => {
		for (const blocker of saveBlockersRef.current) {
			const message = blocker();
			if (message) return message;
		}
		return null;
	};

	const handleSave = () => {
		const blockMessage = getSaveBlockMessage();
		if (blockMessage) {
			setSaveError(blockMessage);
			return;
		}
		onSave(resolveSaveData());
		setDirty(false);
		onClose();
	};

	const handleClone = () => {
		if (onClone) {
			const blockMessage = getSaveBlockMessage();
			if (blockMessage) {
				setSaveError(blockMessage);
				return;
			}
			onClone(resolveSaveData());
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
		registerSaveResolver,
		registerSaveBlocker,
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
					buttonsRef={headerButtonsRef}
				/>

				{saveError && !readOnly && (
					<div className="alert alert-error text-sm">
						<span className="icon-[mdi--alert-circle-outline] h-5 w-5 shrink-0" />
						<span>{saveError}</span>
					</div>
				)}

				{childrenWithProps}

				{hasBottomButtons && (
					<div ref={bottomButtonsRef} className="flex justify-between gap-2">
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

			<FloatingActionBar show={showFloating}>
				{canDelete && (
					<FloatingActionButton
						onClick={handleDelete}
						variant="error"
						disabled={isDeleteCooldown}
						data-tip={isDeleteConfirm ? "Click again to delete" : "Delete"}
						aria-label={isDeleteConfirm ? "Click again to delete" : "Delete"}
					>
						<span className="icon-[mdi--trash-can] h-5 w-5" />
					</FloatingActionButton>
				)}
				{mode === "edit" && !!onClone && (
					<FloatingActionButton
						onClick={handleClone}
						data-tip="Clone"
						aria-label="Clone"
					>
						<span className="icon-[mdi--content-copy] h-5 w-5" />
					</FloatingActionButton>
				)}
				<FloatingActionButton
					onClick={onClose}
					data-tip={readOnly ? "Close" : "Cancel"}
					aria-label={readOnly ? "Close" : "Cancel"}
				>
					<span className="icon-[mdi--close] h-5 w-5" />
				</FloatingActionButton>
				{!readOnly && (
					<FloatingActionButton
						onClick={handleSave}
						variant="primary"
						data-tip={mode === "create" ? "Create" : "Save Changes"}
						aria-label={mode === "create" ? "Create" : "Save Changes"}
					>
						<span className="icon-[mdi--content-save] h-5 w-5" />
					</FloatingActionButton>
				)}
			</FloatingActionBar>
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
	buttonsRef?: RefObject<HTMLDivElement | null>;
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
	buttonsRef,
}: FormHeaderProps) {
	const { mode, readOnly, isDirty } = useFormContext();

	const title =
		mode === "create" ? createTitle : mode === "edit" ? editTitle : viewTitle;

	return (
		<div className="flex justify-between items-center">
			<h2 className="text-2xl font-bold">{title}</h2>
			<div ref={buttonsRef} className="flex items-center gap-4">
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
					<span className="text-sm opacity-70 ml-2">{hint}</span>
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
