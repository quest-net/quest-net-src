// components/ui/DetailDrawer.tsx
//
// Left-side detail drawer used for slot/instance detail views (items, skills,
// statuses, ...). Provides the drawer scaffold, the title + close header, and
// vertical rhythm between its children.

import type { ReactNode } from "react";
import { CloseButton } from "./CloseButton";

interface DetailDrawerProps {
	isOpen: boolean;
	onClose: () => void;
	title: ReactNode;
	children: ReactNode;
}

export function DetailDrawer({
	isOpen,
	onClose,
	title,
	children,
}: DetailDrawerProps) {
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

				<div className="bg-base-200 min-h-full w-full max-w-3xl p-6 overflow-y-auto">
					<div className="flex justify-between items-center mb-6">
						<h2 className="text-3xl font-bold">{title}</h2>
						<CloseButton onClick={onClose} />
					</div>

					<div className="space-y-6">{children}</div>
				</div>
			</div>
		</div>
	);
}
