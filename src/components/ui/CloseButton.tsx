// components/ui/CloseButton.tsx
//
// The standard circular ghost close button used in drawer and modal headers.

interface CloseButtonProps {
	onClick: () => void;
	className?: string;
}

export function CloseButton({ onClick, className }: CloseButtonProps) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={`btn btn-sm btn-circle btn-ghost shrink-0 ${className ?? ""}`}
			aria-label="Close"
		>
			<span className="icon-[mdi--close] w-4 h-4" />
		</button>
	);
}
