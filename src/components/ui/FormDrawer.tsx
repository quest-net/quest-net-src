// components/ui/FormDrawer.tsx
//
// Left-side drawer scaffold for hosting a FormWrapper-based edit form (item,
// skill, status, ...). Unlike DetailDrawer it intentionally omits a title/close
// header — the FormWrapper rendered as a child supplies its own header and
// Save/Cancel/Clone/Delete controls. Mirrors the drawer-side markup IndexView
// uses to host the same Edit components.

import type { ReactNode } from "react";

interface FormDrawerProps {
	isOpen: boolean;
	onClose: () => void;
	children: ReactNode;
}

export function FormDrawer({ isOpen, onClose, children }: FormDrawerProps) {
	return (
		<div className="drawer drawer-start z-50">
			<input
				type="checkbox"
				className="drawer-toggle"
				checked={isOpen}
				onChange={() => {}}
			/>

			<div className="drawer-side">
				<label
					className="drawer-overlay"
					onClick={onClose}
					aria-label="Close drawer"
				></label>

				<div className="bg-base-200 min-h-full w-full max-w-4xl p-6 overflow-y-auto">
					{children}
				</div>
			</div>
		</div>
	);
}
