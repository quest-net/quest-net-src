// components/ui/CostWarning.tsx
//
// Warning shown when an actor lacks the stat/action points an item or skill
// costs. The activation still goes through; the cost is reduced to what the
// actor has.

interface CostWarningProps {
	/** What is being activated ("Item", "Skill") — used in the explanation. */
	kind: string;
	/** Name of the lacking stat/action resource. */
	name: string;
	current: number;
	required: number;
}

export function CostWarning({ kind, name, current, required }: CostWarningProps) {
	return (
		<div className="alert alert-warning text-sm py-2">
			<span className="icon-[mdi--alert] w-4 h-4" />
			<span>
				Not enough {name} ({current} / {required})
				<br />
				<span className="text-xs opacity-70">
					{kind} will still activate but cost will be reduced
				</span>
			</span>
		</div>
	);
}
