// components/editors/StatDefinitionEditor.tsx
import { useState } from "react";
import { StatDefinition } from "../../domains/CampaignSetting/CampaignSetting";
import { useFormReadOnly } from "../Form/Form";
import { RestoreRuleEditor } from "./RestoreRuleEditor";
import { Modal } from "../ui/Modal";
import { EmptyState } from "../ui/EmptyState";

interface StatDefinitionsEditorProps {
	stats: StatDefinition[];
	onChange: (stats: StatDefinition[]) => void;
	readOnly?: boolean;
}

export function StatDefinitionsEditor({
	stats,
	onChange,
	readOnly: readOnlyProp,
}: StatDefinitionsEditorProps) {
	const contextReadOnly = useFormReadOnly();
	const readOnly = readOnlyProp ?? contextReadOnly;

	const [editingStatId, setEditingStatId] = useState<string | null>(null);

	const handleAdd = () => {
		const newStat: StatDefinition = {
			Id: crypto.randomUUID(),
			Name: "New Stat",
			Color: "#808080",
			Max: 10,
		};
		onChange([...stats, newStat]);
	};

	const handleDelete = (id: string) => {
		onChange(stats.filter((s) => s.Id !== id));
	};

	const handleChange = (id: string, updates: Partial<StatDefinition>) => {
		onChange(
			stats.map((s) => (s.Id === id ? { ...s, ...updates } : s))
		);
	};

	const editingStat = stats.find((s) => s.Id === editingStatId);

	return (
		<div className="space-y-4">
			<div className="overflow-x-auto">
				<table className="table table-sm">
					<thead>
						<tr>
							<th>Name</th>
							<th>Color</th>
							<th>Max</th>
							<th>Regen Rate</th>
							<th>Restore Rules</th>
							{!readOnly && <th className="w-12"></th>}
						</tr>
					</thead>
					<tbody>
						{stats.map((stat) => {
							return (
								<tr key={stat.Id}>
									<td>
										<input
											type="text"
											value={stat.Name}
											onChange={(e) =>
												handleChange(stat.Id, { Name: e.target.value })
											}
											disabled={readOnly}
											className="input input-bordered input-sm w-full"
											placeholder="Stat Name"
										/>
									</td>
									<td>
										<input
											type="color"
											value={stat.Color}
											onChange={(e) =>
												handleChange(stat.Id, { Color: e.target.value })
											}
											disabled={readOnly}
											className="input input-bordered input-sm w-20"
										/>
									</td>
									<td>
										<input
											type="number"
											value={stat.Max}
											onChange={(e) => {
												const val = Math.max(0, Number(e.target.value));
												handleChange(stat.Id, { Max: val });
											}}
											disabled={readOnly}
											min={0}
											className="input input-bordered input-sm w-20"
										/>
									</td>
									<td>
										<input
											type="number"
											value={stat.RegenRate ?? ""}
											onChange={(e) => {
												const raw = e.target.value;
												const val =
													raw === "" ? undefined : Math.max(0, Number(raw));
												handleChange(stat.Id, {
													RegenRate:
														val !== undefined && Number.isFinite(val)
															? val
															: undefined,
												});
											}}
											disabled={readOnly}
											min={0}
											className="input input-bordered input-sm w-20"
											placeholder="None"
										/>
									</td>
									<td>
										{stat.RestoreRule ? (
											<button className="btn btn-primary btn-sm w-16"
												title="Edit restore rules"
												disabled={readOnly}
												onClick={() => setEditingStatId(stat.Id)}
											>Set</button>
										) : (
											<button className="btn btn-neutral btn-sm w-16"
												title="Edit restore rules"
												disabled={readOnly}
												onClick={() => setEditingStatId(stat.Id)}
											>None</button>
										)}
									</td>
									{!readOnly && (
										<td>
											<button
												onClick={() => handleDelete(stat.Id)}
												disabled={readOnly}
												className="btn btn-ghost btn-sm btn-square"
												aria-label="Delete Stat"
											>
												<span className="icon-[mdi--close] h-5 w-5" />
											</button>
										</td>
									)}
								</tr>
							);
						})}
						{stats.length === 0 && (
							<tr>
								<td colSpan={readOnly ? 5 : 6}>
									<EmptyState compact>No stats defined.</EmptyState>
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
					Add Stat
				</button>
			)}

			{/* Modal for editing RestoreRule */}
			{editingStat && (
				<Modal
					title={`Restore Rules for ${editingStat.Name}`}
					onClose={() => setEditingStatId(null)}
					actions={
						<button
							onClick={() => setEditingStatId(null)}
							className="btn btn-primary"
						>
							Done
						</button>
					}
				>
					<RestoreRuleEditor
						value={editingStat.RestoreRule}
						onChange={(rule) => {
							handleChange(editingStat.Id, { RestoreRule: rule });
						}}
						readOnly={readOnly}
					/>
				</Modal>
			)}
		</div>
	);
}
