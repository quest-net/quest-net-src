// components/inputs/AttributeEditor.tsx

import { AttributeSlot } from "../../domains/Actor/Actor";
import { AttributeDefinition } from "../../domains/CampaignSetting/CampaignSetting";
import { resolveAttributes } from "../../domains/Actor/ActorResolvers";
import { useFormReadOnly } from "../Form/Form";
import { EmptyState } from "../ui/EmptyState";

interface AttributeEditorProps {
	slots: AttributeSlot[];
	definitions: AttributeDefinition[];
	onChange: (slots: AttributeSlot[]) => void;
	readOnly?: boolean;
}

/**
 * Per-actor attribute value editor.
 * Renders one row per campaign AttributeDefinition, showing the actor's
 * current value. Empty values are allowed and mean "unset" — attributes
 * with empty values are hidden in display-only contexts (character sheet,
 * inspector) but still appear here so they can be filled in.
 */
export function AttributeEditor({
	slots,
	definitions,
	onChange,
	readOnly: readOnlyProp,
}: AttributeEditorProps) {
	const contextReadOnly = useFormReadOnly();
	const readOnly = readOnlyProp ?? contextReadOnly;

	const resolved = resolveAttributes(slots, definitions);

	const handleValueChange = (id: string, newValue: string) => {
		const updated = slots.map((s) =>
			s.Id === id ? { ...s, Value: newValue } : s
		);
		onChange(updated);
	};

	const handleClear = (id: string) => {
		handleValueChange(id, "");
	};

	if (definitions.length === 0) {
		return (
			<EmptyState compact>
				No attributes defined. Add attribute definitions in Campaign Settings.
			</EmptyState>
		);
	}

	return (
		<div className="grid grid-cols-2 gap-x-6 gap-y-3">
			{resolved.map((attr) => (
				<div key={attr.Id} className="flex items-center gap-2">
					<div className="w-28 shrink-0 truncate font-medium">
						{attr.Name}
					</div>
					<input
						type="text"
						value={attr.Value}
						onChange={(e) => handleValueChange(attr.Id, e.target.value)}
						disabled={readOnly}
						className="input input-bordered input-sm flex-1 min-w-0"
						placeholder="Unset"
					/>
					{!readOnly && (
						<button
							onClick={() => handleClear(attr.Id)}
							disabled={readOnly || attr.Value === ""}
							className="btn btn-ghost btn-sm btn-square shrink-0"
							aria-label="Clear Attribute"
							title="Clear value"
						>
							<span className="icon-[mdi--close] h-5 w-5" />
						</button>
					)}
				</div>
			))}
		</div>
	);
}
