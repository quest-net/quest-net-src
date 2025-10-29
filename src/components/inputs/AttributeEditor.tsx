// components/inputs/AttributeEditor.tsx
import { useFormReadOnly } from "../Form/Form";

interface AttributeEditorProps {
	attributes: Record<string, string>;
	onChange: (attributes: Record<string, string>) => void;
	readOnly?: boolean;
}

export function AttributeEditor({
	attributes,
	onChange,
	readOnly: readOnlyProp,
}: AttributeEditorProps) {
	const contextReadOnly = useFormReadOnly();
	const readOnly = readOnlyProp ?? contextReadOnly;

	const handleAdd = () => {
		// Find a unique name for the new attribute
		let newName = "New Attribute";
		let counter = 1;
		while (attributes.hasOwnProperty(newName)) {
			newName = `New Attribute ${counter++}`;
		}
		onChange({ ...attributes, [newName]: "" });
	};

	const handleDelete = (keyToDelete: string) => {
		// Use object destructuring to omit the key
		const { [keyToDelete]: _, ...remaining } = attributes;
		onChange(remaining);
	};

	const handleKeyChange = (oldKey: string, newKey: string) => {
		// Prevent empty keys or duplicate keys
		if (!newKey || (attributes.hasOwnProperty(newKey) && oldKey !== newKey)) {
			return;
		}

		// Rebuild the object to preserve order
		const newAttributes = Object.entries(attributes).reduce(
			(acc, [key, value]) => {
				acc[key === oldKey ? newKey : key] = value;
				return acc;
			},
			{} as Record<string, string>
		);

		onChange(newAttributes);
	};

	const handleValueChange = (key: string, newValue: string) => {
		onChange({ ...attributes, [key]: newValue });
	};

	return (
		<div className="space-y-4">
			<div className="overflow-x-auto">
				<table className="table table-sm">
					<thead>
						<tr>
							<th>Attribute</th>
							<th>Value</th>
							{!readOnly && <th className="w-12"></th>}
						</tr>
					</thead>
					<tbody>
						{Object.entries(attributes).map(([key, value], index) => (
							<tr key={index}>
								<td>
									<input
										type="text"
										value={key}
										onChange={(e) => handleKeyChange(key, e.target.value)}
										disabled={readOnly}
										className="input input-bordered input-sm w-full"
										placeholder="Attribute Name"
									/>
								</td>
								<td>
									<input
										type="text"
										value={value}
										onChange={(e) => handleValueChange(key, e.target.value)}
										disabled={readOnly}
										className="input input-bordered input-sm w-full"
										placeholder="Attribute Value"
									/>
								</td>
								{!readOnly && (
									<td>
										<button
											onClick={() => handleDelete(key)}
											disabled={readOnly}
											className="btn btn-ghost btn-sm btn-square"
											aria-label="Delete Attribute"
										>
											<span className="icon-[mdi--close] h-5 w-5" />
										</button>
									</td>
								)}
							</tr>
						))}
						{Object.keys(attributes).length === 0 && (
							<tr>
								<td
									colSpan={readOnly ? 2 : 3}
									className="text-center italic text-base-content/60"
								>
									No attributes defined.
								</td>
							</tr>
						)}
					</tbody>
				</table>
			</div>
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
