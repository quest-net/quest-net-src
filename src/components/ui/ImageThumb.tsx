// components/ui/ImageThumb.tsx
//
// The standard image thumbnail container: a rounded, clipped, centered box.
// Pass sizing through className (e.g. "w-full aspect-square").

import type { ReactNode } from "react";

interface ImageThumbProps {
	className?: string;
	children?: ReactNode;
}

export function ImageThumb({ className, children }: ImageThumbProps) {
	return (
		<div
			className={`bg-base-300 rounded-lg overflow-hidden flex items-center justify-center ${className ?? ""}`}
		>
			{children}
		</div>
	);
}
