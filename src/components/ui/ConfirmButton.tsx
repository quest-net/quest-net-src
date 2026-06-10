// components/ui/ConfirmButton.tsx
//
// Two-click destructive button: the first click arms it (error styling +
// confirm label), the second fires onConfirm. Auto-disarms after 2 seconds.
// Key it on the subject's id if the same mounted button can switch subjects.

import { useEffect, useState } from "react";
import type { ReactNode } from "react";

interface ConfirmButtonProps {
	onConfirm: () => void;
	disabled?: boolean;
	/** Iconify class, e.g. "icon-[mdi--delete]". */
	icon?: string;
	/** Idle label. */
	children: ReactNode;
	/** Label shown while armed. */
	confirmLabel?: ReactNode;
	/** Layout classes; the btn variant is managed internally. */
	className?: string;
}

export function ConfirmButton({
	onConfirm,
	disabled,
	icon,
	children,
	confirmLabel = "Confirm?",
	className,
}: ConfirmButtonProps) {
	const [armed, setArmed] = useState(false);

	useEffect(() => {
		if (!armed) return;
		const timer = setTimeout(() => setArmed(false), 2000);
		return () => clearTimeout(timer);
	}, [armed]);

	const handleClick = () => {
		if (!armed) {
			setArmed(true);
			return;
		}
		setArmed(false);
		onConfirm();
	};

	return (
		<button
			type="button"
			onClick={handleClick}
			disabled={disabled}
			className={`btn ${armed ? "btn-error" : "btn-ghost"} ${className ?? ""}`}
		>
			{icon && <span className={`${icon} w-5 h-5`} />}
			{armed ? confirmLabel : children}
		</button>
	);
}
