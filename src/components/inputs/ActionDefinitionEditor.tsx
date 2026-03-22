// domains/CampaignSetting/ActionDefinitionEditor.tsx

import { ActionDefinition } from "../../domains/CampaignSetting/CampaignSetting";
import { useFormReadOnly } from "../../components/Form/Form";

interface ActionDefinitionEditorProps {
	actions: ActionDefinition[];
	onChange: (actions: ActionDefinition[]) => void;
	readOnly?: boolean;
}

export function ActionDefinitionEditor({
	actions,
	onChange,
	readOnly: readOnlyProp,
}: ActionDefinitionEditorProps) {
	const contextReadOnly = useFormReadOnly();
	const readOnly = readOnlyProp ?? contextReadOnly;

	const handleAdd = () => {
		const newAction: ActionDefinition = {
			Id: crypto.randomUUID(),
			Name: "New Action",
			Color: "#808080",
			Max: 1,
		};
		onChange([...actions, newAction]);
	};

	const handleDelete = (id: string) => {
		onChange(actions.filter((a) => a.Id !== id));
	};

	const handleChange = (id: string, updates: Partial<ActionDefinition>) => {
		onChange(
			actions.map((a) => (a.Id === id ? { ...a, ...updates } : a))
		);
	};

	return (
		<div className="space-y-4">
			<div className="overflow-x-auto">
				<table className="table table-sm">
					<thead>
						<tr>
							<th>Name</th>
							<th>Color</th>
							<th>Max</th>
							{!readOnly && <th className="w-12"></th>}
						</tr>
					</thead>
					<tbody>
						{actions.map((action) => (
							<tr key={action.Id}>
								<td>
									<input
										type="text"
										value={action.Name}
										onChange={(e) =>
											handleChange(action.Id, { Name: e.target.value })
										}
										disabled={readOnly}
										className="input input-bordered input-sm w-full"
										placeholder="Action Name"
									/>
								</td>
								<td>
									<input
										type="color"
										value={action.Color}
										onChange={(e) =>
											handleChange(action.Id, { Color: e.target.value })
										}
										disabled={readOnly}
										className="input input-bordered input-sm w-20"
									/>
								</td>
								<td>
									<input
										type="number"
										value={action.Max}
										onChange={(e) => {
											const val = Math.max(0, Number(e.target.value));
											handleChange(action.Id, { Max: val });
										}}
										disabled={readOnly}
										min={0}
										className="input input-bordered input-sm w-20"
									/>
								</td>
								{!readOnly && (
									<td>
										<button
											onClick={() => handleDelete(action.Id)}
											disabled={readOnly}
											className="btn btn-ghost btn-sm btn-square"
											aria-label="Delete Action"
										>
											<span className="icon-[mdi--close] h-5 w-5" />
										</button>
									</td>
								)}
							</tr>
						))}
						{actions.length === 0 && (
							<tr>
								<td
									colSpan={readOnly ? 3 : 4}
									className="text-center italic text-base-content/60"
								>
									No actions defined.
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
					Add Action
				</button>
			)}
		</div>
	);
}