// components/ui/FloatingActionButton.tsx
//
// Standard circular action used inside floating action bars.

import type { ButtonHTMLAttributes } from "react";

type FloatingActionButtonVariant = "neutral" | "primary" | "error";

const VARIANT_CLASSES: Record<FloatingActionButtonVariant, string> = {
	neutral: "btn-neutral",
	primary: "btn-primary",
	error: "btn-error",
};

interface FloatingActionButtonProps
	extends ButtonHTMLAttributes<HTMLButtonElement> {
	variant?: FloatingActionButtonVariant;
}

export function FloatingActionButton({
	variant = "neutral",
	className,
	children,
	...rest
}: FloatingActionButtonProps) {
	return (
		<button
			type="button"
			className={`btn btn-circle ${VARIANT_CLASSES[variant]} shadow-lg opacity-70 transition-transform hover:scale-105 tooltip tooltip-left ${
				className ?? ""
			}`}
			{...rest}
		>
			{children}
		</button>
	);
}
