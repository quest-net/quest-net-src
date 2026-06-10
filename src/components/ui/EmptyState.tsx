// components/ui/EmptyState.tsx
//
// The standard "nothing here" block: centered, muted, small text, with an
// optional watermark icon. `bordered` renders the dashed-box variant used for
// empty grid/list areas (pickers).

import type { ReactNode } from "react";

interface EmptyStateProps {
	/** Iconify class for a watermark icon, e.g. "icon-[mdi--image-off]". */
	icon?: string;
	/** Dashed-border box variant for empty grid/list areas. */
	bordered?: boolean;
	className?: string;
	children: ReactNode;
}

export function EmptyState({
	icon,
	bordered,
	className,
	children,
}: EmptyStateProps) {
	return (
		<div
			className={`text-center text-sm opacity-70 ${
				bordered
					? "border-2 border-dashed border-base-300 rounded-lg py-12"
					: "py-8"
			} ${className ?? ""}`}
		>
			{icon && <span className={`${icon} w-12 h-12 inline-block mb-2`} />}
			{children}
		</div>
	);
}
