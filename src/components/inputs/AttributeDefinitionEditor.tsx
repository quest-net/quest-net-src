// components/inputs/AttributeDefinitionEditor.tsx

import { AttributeDefinition } from "../../domains/CampaignSetting/CampaignSetting";
import { useFormReadOnly } from "../Form/Form";

interface AttributeDefinitionEditorProps {
	attributes: AttributeDefinition[];
	onChange: (attributes: AttributeDefinition[]) => void;
	readOnly?: boolean;
}

export function AttributeDefinitionEditor({
	attributes,
	onChange,
	readOnly: readOnlyProp,
}: AttributeDefinitionEditorProps) {
	const contextReadOnly = useFormReadOnly();
	const readOnly = readOnlyProp ?? contextReadOnly;

	const handleAdd = () => {
		const newAttribute: AttributeDefinition = {
			Id: crypto.randomUUID(),
			Name: "New Attribute",
		};
		onChange([...attributes, newAttribute]);
	};

	const handleDelete = (id: string) => {
		onChange(attributes.filter((a) => a.Id !== id));
	};

	const handleChange = (id: string, updates: Partial<AttributeDefinition>) => {
		onChange(
			attributes.map((a) => (a.Id === id ? { ...a, ...updates } : a))
		);
	};

	return (
		<div className="space-y-4">
			{attributes.length === 0 ? (
				<div className="text-center italic text-base-content/60 py-2">
					No attributes defined.
				</div>
			) : (
				<div className="grid grid-cols-2 gap-x-6 gap-y-2">
					{attributes.map((attribute) => (
						<div key={attribute.Id} className="flex items-center gap-2">
							<input
								type="text"
								value={attribute.Name}
								onChange={(e) =>
									handleChange(attribute.Id, { Name: e.target.value })
								}
								disabled={readOnly}
								className="input input-bordered input-sm flex-1 min-w-0"
								placeholder="Attribute Name"
							/>
							{!readOnly && (
								<button
									onClick={() => handleDelete(attribute.Id)}
									disabled={readOnly}
									className="btn btn-ghost btn-sm btn-square shrink-0"
									aria-label="Delete Attribute"
								>
									<span className="icon-[mdi--close] h-5 w-5" />
								</button>
							)}
						</div>
					))}
				</div>
			)}
			{!readOnly && (
				<button
					onClick={handleAdd}
					disabled={readOnly}
					className="btn btn-sm btn-outline btn-primary"
				>
					Add Attribute
				</button>
			)}
		</div>
	);
}
