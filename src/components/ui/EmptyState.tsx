// components/ui/EmptyState.tsx
//
// The standard "nothing here" block: centered, muted, small text, with an
// optional watermark icon stacked above it. Pass `title` (+ children as the
// hint line) for the headline-and-hint form, e.g. "No notes yet / Click 'New
// Entry' to begin". `bordered` renders the dashed-box variant used for empty
// grid/list areas (pickers, libraries).

import type { ReactNode } from "react";

interface EmptyStateProps {
	/** Iconify class for a watermark icon, e.g. "icon-[mdi--image-off]". */
	icon?: string;
	/** Optional headline shown above the children (which become the hint). */
	title?: ReactNode;
	/** Dashed-border box variant for empty grid/list areas. */
	bordered?: boolean;
	/** Tighter padding for embedded table/editor empty rows. */
	compact?: boolean;
	className?: string;
	children?: ReactNode;
}

export function EmptyState({
	icon,
	title,
	bordered,
	compact,
	className,
	children,
}: EmptyStateProps) {
	return (
		<div
			className={`text-center text-sm opacity-70 ${
				bordered
					? "border-2 border-dashed border-base-300 rounded-lg py-12"
					: compact
						? "py-2"
						: "py-8"
			} ${className ?? ""}`}
		>
			{icon && <span className={`${icon} w-12 h-12 block mx-auto mb-2`} />}
			{title && <div className="text-base font-medium">{title}</div>}
			{children && <div className={title ? "mt-1" : undefined}>{children}</div>}
		</div>
	);
}
