// components/ui/ToggleButton.tsx
//
// Standard toggle button with the app-wide active-color convention:
// - "exclusive"   (one-of-many, radio-like selection): btn-neutral when active
// - "independent" (on/off switch, several can be on):  btn-primary when active
// Inactive: default btn, or btn-ghost via `quiet` for low-emphasis inline
// toggles (e.g. the stat-edit pencil).

import type { ButtonHTMLAttributes } from "react";

interface ToggleButtonProps
	extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> {
	active: boolean;
	kind?: "exclusive" | "independent";
	quiet?: boolean;
}

export function ToggleButton({
	active,
	kind = "exclusive",
	quiet,
	className,
	children,
	...rest
}: ToggleButtonProps) {
	const activeClass = kind === "independent" ? "btn-primary" : "btn-neutral";
	const inactiveClass = quiet ? "btn-ghost" : "";
	return (
		<button
			type="button"
			aria-pressed={active}
			className={`btn ${active ? activeClass : inactiveClass} ${className ?? ""}`}
			{...rest}
		>
			{children}
		</button>
	);
}
