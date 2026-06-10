// components/AttributesSection/AttributesSection.tsx

import { useState } from "react";
import { AttributeSlot } from "../../domains/Actor/Actor";
import { AttributeDefinition } from "../../domains/CampaignSetting/CampaignSetting";
import { resolveAttributes } from "../../utils/ActorResolvers";
import { EmptyState } from "../ui/EmptyState";

interface AttributesSectionProps {
	slots: AttributeSlot[];
	definitions: AttributeDefinition[];
	/**
	 * Map of live/debounced attribute values keyed by definition Id.
	 * When provided, used as the source of truth for input value binding
	 * (so typing feels immediate even while the underlying slot updates
	 * are debounced). Falls back to the slot's resolved value.
	 */
	localValues?: Map<string, string>;
	/**
	 * Called when the user edits an attribute value. Required for
	 * editable mode; omit (or pass readOnly) for display-only rendering.
	 */
	onChange?: (id: string, value: string) => void;
	/**
	 * When true, render every row as read-only text instead of an input.
	 * Defaults to true if no onChange is provided.
	 */
	readOnly?: boolean;
	/**
	 * When provided, numeric attribute labels become clickable and call this
	 * with a "1d20+<value>" formula to roll the attribute. Works in both edit
	 * and read-only mode (labels are only edited via campaign settings).
	 */
	onRoll?: (formula: string) => void;
}

/**
 * Builds a "1d20+<value>" style roll formula for a numeric attribute value,
 * or null if the value is not a finite number.
 */
function attributeRollFormula(rawValue: string): string | null {
	const trimmed = rawValue.trim();
	if (trimmed === "") return null;
	const n = Number(trimmed);
	if (!Number.isFinite(n)) return null;
	if (n === 0) return "1d20";
	return n > 0 ? `1d20+${n}` : `1d20-${Math.abs(n)}`;
}

/**
 * Shared "Attributes" section for the character sheet, inspector, and any
 * other actor-detail UI. Renders a header with a "Show unset" toggle and
 * a 2-column grid of attribute rows. Empty-valued attributes are hidden
 * by default; the toggle reveals all defined attributes so the user can
 * set empty ones or clear existing ones without the row vanishing.
 */
export function AttributesSection({
	slots,
	definitions,
	localValues,
	onChange,
	readOnly,
	onRoll,
}: AttributesSectionProps) {
	const [showUnsetAttributes, setShowUnsetAttributes] = useState(false);

	if (definitions.length === 0) return null;

	const effectiveReadOnly = readOnly ?? onChange === undefined;
	const allAttributes = resolveAttributes(slots, definitions);
	const visibleAttributes = showUnsetAttributes
		? allAttributes
		: allAttributes.filter((attr) => attr.Value !== "");

	return (
		<div className="space-y-2">
			<div className="flex items-center justify-between">
				<span className="text-sm font-semibold">Attributes</span>
				<label className="cursor-pointer flex items-center gap-2">
					<span className="text-xs opacity-70">Show unset</span>
					<input
						type="checkbox"
						checked={showUnsetAttributes}
						onChange={(e) => setShowUnsetAttributes(e.target.checked)}
						className="toggle toggle-xs"
					/>
				</label>
			</div>
			{visibleAttributes.length === 0 ? (
				<EmptyState compact>No attributes set.</EmptyState>
			) : (
				<div className="grid grid-cols-2 gap-x-3 gap-y-2">
					{visibleAttributes.map((attr) => {
						const currentValue =
							localValues?.get(attr.Id) ?? attr.Value;
						const rollFormula = onRoll
							? attributeRollFormula(currentValue)
							: null;
						return (
						<div
							key={attr.Id}
							className="flex gap-2 items-center text-sm"
						>
							{rollFormula ? (
								<button
									type="button"
									onClick={() => onRoll!(rollFormula)}
									title={`Roll ${attr.Name} (${rollFormula})`}
									className="font-medium w-20 shrink-0 truncate text-left cursor-pointer underline decoration-dotted decoration-base-300 underline-offset-2 transition-colors hover:text-primary hover:decoration-primary"
								>
									{attr.Name}
								</button>
							) : (
								<div className="font-medium w-20 shrink-0 truncate">
									{attr.Name}
								</div>
							)}
							{effectiveReadOnly ? (
								<div className="opacity-70 flex-1 text-right truncate">
									{attr.Value || (
										<span className="italic opacity-70">unset</span>
									)}
								</div>
							) : (
								<input
									type="text"
									value={localValues?.get(attr.Id) ?? attr.Value}
									onChange={(e) =>
										onChange?.(attr.Id, e.target.value)
									}
									className="input input-sm input-bordered flex-1 min-w-0"
									placeholder="Unset"
								/>
							)}
						</div>
						);
					})}
				</div>
			)}
		</div>
	);
}
