// components/AttributesSection/AttributesSection.tsx

import { useState } from "react";
import { AttributeSlot } from "../../domains/Actor/Actor";
import { AttributeDefinition } from "../../domains/CampaignSetting/CampaignSetting";
import { resolveAttributes } from "../../utils/ActorResolvers";

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
				<div className="text-xs italic opacity-60 text-center py-1">
					No attributes set.
				</div>
			) : (
				<div className="grid grid-cols-2 gap-x-3 gap-y-2">
					{visibleAttributes.map((attr) => (
						<div
							key={attr.Id}
							className="flex gap-2 items-center text-sm"
						>
							<div className="font-medium w-20 shrink-0 truncate">
								{attr.Name}
							</div>
							{effectiveReadOnly ? (
								<div className="opacity-70 flex-1 text-right truncate">
									{attr.Value || (
										<span className="italic opacity-60">unset</span>
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
					))}
				</div>
			)}
		</div>
	);
}
