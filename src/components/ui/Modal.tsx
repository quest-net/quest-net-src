// components/ui/Modal.tsx
//
// Shared modal scaffold: dialog + modal-box with optional title row, actions
// and backdrop. Rendered through a portal to <body> so ancestors with
// backdrop-filter (e.g. the map toolbar) can never become the containing
// block and trap the fixed overlay.

import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { CloseButton } from "./CloseButton";

export type ModalSize = "sm" | "md" | "lg" | "xl";

const SIZE_CLASSES: Record<ModalSize, string> = {
	sm: "max-w-md",
	md: "",
	lg: "max-w-2xl",
	xl: "max-w-5xl",
};

interface ModalProps {
	title?: ReactNode;
	/** Enables the header close button and backdrop click-to-close.
	 *  Omit for modals that must be dismissed through an explicit action. */
	onClose?: () => void;
	size?: ModalSize;
	/** Stretch the box to 90vh with a flex-column body, for modals whose
	 *  middle section scrolls (picker grids). */
	fullHeight?: boolean;
	/** Buttons for the modal-action footer row. */
	actions?: ReactNode;
	children: ReactNode;
}

export function Modal({
	title,
	onClose,
	size = "md",
	fullHeight,
	actions,
	children,
}: ModalProps) {
	return createPortal(
		<dialog className="modal modal-open">
			<div
				className={`modal-box ${SIZE_CLASSES[size]} ${
					fullHeight ? "max-h-[90vh] flex flex-col" : ""
				}`}
			>
				{(title || onClose) && (
					<div className="flex justify-between items-center gap-2 mb-4">
						<h3 className="font-bold text-lg flex items-center gap-2">
							{title}
						</h3>
						{onClose && <CloseButton onClick={onClose} />}
					</div>
				)}
				{children}
				{actions && <div className="modal-action">{actions}</div>}
			</div>
			{onClose && <div className="modal-backdrop" onClick={onClose} />}
		</dialog>,
		document.body
	);
}
