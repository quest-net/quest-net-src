// components/inputs/InitiativeSettingsEditor.tsx

import { useFormReadOnly } from "../Form/Form";
import {
	InitiativeSettings,
	InitiativeSource,
	StatDefinition,
	AttributeDefinition,
} from "../../domains/CampaignSetting/CampaignSetting";

interface InitiativeSettingsEditorProps {
	value: InitiativeSettings | undefined;
	statDefinitions: StatDefinition[];
	attributeDefinitions: AttributeDefinition[];
	onChange: (value: InitiativeSettings | undefined) => void;
	readOnly?: boolean;
}

/**
 * Encodes an InitiativeSource as a stable select-option string of the form
 * "kind:id" (or just "moveSpeed" for the field). Used as the <option> value.
 */
function encodeSource(source: InitiativeSource): string {
	switch (source.kind) {
		case "moveSpeed":
			return "moveSpeed";
		case "stat":
			return `stat:${source.statId}`;
		case "attribute":
			return `attribute:${source.attributeId}`;
	}
}

function decodeSource(encoded: string): InitiativeSource | null {
	if (encoded === "moveSpeed") return { kind: "moveSpeed" };
	if (encoded.startsWith("stat:")) {
		return { kind: "stat", statId: encoded.slice(5) };
	}
	if (encoded.startsWith("attribute:")) {
		return { kind: "attribute", attributeId: encoded.slice(10) };
	}
	return null;
}

export function InitiativeSettingsEditor({
	value,
	statDefinitions,
	attributeDefinitions,
	onChange,
	readOnly: readOnlyProp,
}: InitiativeSettingsEditorProps) {
	const contextReadOnly = useFormReadOnly();
	const readOnly = readOnlyProp ?? contextReadOnly;

	const sources = value?.Sources ?? [];

	// Build the option list once. Stats and attributes share the dropdown so a
	// "STR" attribute and a "STR" stat would collide on label only — we tag the
	// kind in the visible label to keep them distinguishable.
	const options: { value: string; label: string }[] = [
		{ value: "moveSpeed", label: "Move Speed" },
		...statDefinitions.map((s) => ({
			value: `stat:${s.Id}`,
			label: `${s.Name} (stat)`,
		})),
		...attributeDefinitions.map((a) => ({
			value: `attribute:${a.Id}`,
			label: `${a.Name} (attribute)`,
		})),
	];

	const updateSource = (index: number, encoded: string) => {
		const decoded = decodeSource(encoded);
		if (!decoded) return;
		const next = [...sources];
		next[index] = decoded;
		onChange({ Sources: next });
	};

	const addTiebreaker = () => {
		// Default new entries to Move Speed since it always exists and is a number.
		onChange({ Sources: [...sources, { kind: "moveSpeed" }] });
	};

	const removeSource = (index: number) => {
		const next = sources.filter((_, i) => i !== index);
		// If the user removed the last source, drop InitiativeSettings entirely
		// so the rest of the app treats initiative as "not configured".
		onChange(next.length === 0 ? undefined : { Sources: next });
	};

	const moveSource = (index: number, direction: -1 | 1) => {
		const target = index + direction;
		if (target < 0 || target >= sources.length) return;
		const next = [...sources];
		[next[index], next[target]] = [next[target], next[index]];
		onChange({ Sources: next });
	};

	// Empty state — invite the DM to configure a primary source.
	if (sources.length === 0) {
		return (
			<div className="space-y-3">
				<p className="text-sm opacity-70">
					Initiative ordering is not configured. Pick a source to start.
				</p>
				<button
					type="button"
					onClick={() =>
						onChange({ Sources: [{ kind: "moveSpeed" }] })
					}
					disabled={readOnly}
					className="btn btn-sm btn-primary gap-2"
				>
					<span className="icon-[mdi--plus] w-4 h-4" />
					Configure Initiative
				</button>
			</div>
		);
	}

	return (
		<div className="space-y-3">
			{sources.map((source, index) => {
				const isPrimary = index === 0;
				return (
					<div key={index} className="flex items-center gap-2">
						<div className="text-sm opacity-70 w-24 shrink-0">
							{isPrimary ? "Primary" : `Tiebreaker ${index}`}
						</div>
						<select
							value={encodeSource(source)}
							onChange={(e) => updateSource(index, e.target.value)}
							disabled={readOnly}
							className="select select-bordered select-sm flex-1"
						>
							{options.map((opt) => (
								<option key={opt.value} value={opt.value}>
									{opt.label}
								</option>
							))}
						</select>
						<button
							type="button"
							onClick={() => moveSource(index, -1)}
							disabled={readOnly || index === 0}
							className="btn btn-ghost btn-sm btn-square"
							title="Move up"
						>
							<span className="icon-[mdi--chevron-up] w-4 h-4" />
						</button>
						<button
							type="button"
							onClick={() => moveSource(index, 1)}
							disabled={readOnly || index === sources.length - 1}
							className="btn btn-ghost btn-sm btn-square"
							title="Move down"
						>
							<span className="icon-[mdi--chevron-down] w-4 h-4" />
						</button>
						<button
							type="button"
							onClick={() => removeSource(index)}
							disabled={readOnly}
							className="btn btn-ghost btn-sm btn-square text-error"
							title="Remove"
						>
							<span className="icon-[mdi--close] w-4 h-4" />
						</button>
					</div>
				);
			})}

			<button
				type="button"
				onClick={addTiebreaker}
				disabled={readOnly}
				className="btn btn-sm btn-outline gap-2"
			>
				<span className="icon-[mdi--plus] w-4 h-4" />
				Add tiebreaker
			</button>

			<div className="text-xs opacity-60">
				Highest value goes first. If two members tie on every source, they share an
				order number — pick between them however you like.
			</div>
		</div>
	);
}
