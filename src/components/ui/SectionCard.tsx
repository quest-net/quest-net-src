// components/ui/SectionCard.tsx
//
// The standard bordered content card with an optional small title.

import type { ReactNode } from "react";

interface SectionCardProps {
	title?: ReactNode;
	children: ReactNode;
	className?: string;
}

export function SectionCard({ title, children, className }: SectionCardProps) {
	return (
		<div
			className={`card bg-base-100 border-2 border-base-300 ${className ?? ""}`}
		>
			<div className="card-body p-4 space-y-3">
				{title && <h3 className="card-title text-sm">{title}</h3>}
				{children}
			</div>
		</div>
	);
}
