// components/ui/PropertyRow.tsx
//
// A label/value row for property lists inside cards. Rows draw a divider
// under themselves except for the last one in the list.

import type { ReactNode } from "react";

interface PropertyRowProps {
	label: ReactNode;
	/** Extra classes for the value (e.g. "font-mono", "font-bold"). */
	valueClassName?: string;
	children?: ReactNode;
}

export function PropertyRow({
	label,
	valueClassName,
	children,
}: PropertyRowProps) {
	return (
		<div className="flex justify-between items-center py-2 border-b border-base-300 last:border-b-0">
			<span className="font-semibold">{label}</span>
			<span className={valueClassName}>{children}</span>
		</div>
	);
}
