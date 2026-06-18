// components/editors/StatOverridesEditor.tsx

import { StatSlot } from "../../domains/Actor/Actor";
import {
	StatDefinition,
	SharedInventory,
} from "../../domains/CampaignSetting/CampaignSetting";
import { RestoreRuleEditor } from "./RestoreRuleEditor";
import { useFormReadOnly } from "../Form/Form";

interface StatOverridesEditorProps {
	/** The per-actor stat slot being edited. */
	slot: StatSlot;
	/** The campaign-wide template this slot inherits from. */
	template: StatDefinition;
	/** All shared inventories (used to populate the OverflowTarget dropdown). */
	sharedInventories: SharedInventory[];
	/** Campaign stat definitions (used to label overflow target options). */
	statDefinitions: StatDefinition[];
	/** Invoked with the fully replaced slot whenever any override changes. */
	onSlotChange: (updated: StatSlot) => void;
	readOnly?: boolean;
}

/**
 * Per-stat overrides UI: lets the user override RegenRate, OverflowTarget,
 * and RestoreRule defined on the campaign StatDefinition template.
 *
 * Inheritance semantics:
 *   - A slot field set to `undefined` means "inherit from the template".
 *   - A slot field set to a concrete value overrides the template.
 *   - For OverflowTarget specifically, `null` means "explicitly disabled
 *     for this slot" (wins over a defined template target).
 */
export function StatOverridesEditor({
	slot,
	template,
	sharedInventories,
	statDefinitions,
	onSlotChange,
	readOnly: readOnlyProp,
}: StatOverridesEditorProps) {
	const contextReadOnly = useFormReadOnly();
	const readOnly = readOnlyProp ?? contextReadOnly;

	// ---- RegenRate ----
	const handleRegenChange = (raw: string) => {
		if (raw === "") {
			// Empty = inherit from template; strip the key entirely.
			const { RegenRate: _, ...rest } = slot;
			onSlotChange(rest as StatSlot);
		} else {
			const parsed = Number(raw);
			if (Number.isFinite(parsed)) {
				onSlotChange({ ...slot, RegenRate: parsed });
			}
		}
	};

	const handleRegenReset = () => {
		const { RegenRate: _, ...rest } = slot;
		onSlotChange(rest as StatSlot);
	};

	const effectiveRegen = slot.RegenRate ?? template.RegenRate;

	// ---- OverflowTarget ----
	// Three-state serialization for the <select>:
	//   "__inherit__"        → undefined (inherit template)
	//   "__disabled__"       → null (explicitly disabled for this slot)
	//   "<invId>|<statId>"   → { InventoryId, StatId } (override)
	const encodeOverflowValue = (target: StatSlot["OverflowTarget"]): string => {
		if (target === undefined) return "__inherit__";
		if (target === null) return "__disabled__";
		return `${target.InventoryId}|${target.StatId}`;
	};

	const handleOverflowChange = (v: string) => {
		if (v === "__inherit__") {
			const { OverflowTarget: _, ...rest } = slot;
			onSlotChange(rest as StatSlot);
		} else if (v === "__disabled__") {
			onSlotChange({ ...slot, OverflowTarget: null });
		} else {
			const [InventoryId, StatId] = v.split("|");
			onSlotChange({
				...slot,
				OverflowTarget: { InventoryId, StatId },
			});
		}
	};

	// Build the list of every valid (inventory, stat) combination the user
	// can point overflow to. We pull stat names from campaign definitions
	// because the inventory's StatSlot only stores an Id.
	const overflowOptions = sharedInventories.flatMap((inv) =>
		inv.Stats.map((s) => {
			const def = statDefinitions.find((d) => d.Id === s.Id);
			return {
				value: `${inv.Id}|${s.Id}`,
				label: `${inv.Name} → ${def?.Name ?? s.Id}`,
			};
		})
	);

	// Effective overflow after template/slot resolution, for display.
	const renderEffectiveOverflow = (): string => {
		let resolved: StatDefinition["OverflowTarget"];
		if (slot.OverflowTarget === undefined) {
			resolved = template.OverflowTarget;
		} else if (slot.OverflowTarget === null) {
			return "disabled";
		} else {
			resolved = slot.OverflowTarget;
		}
		if (!resolved) return "none";
		const inv = sharedInventories.find((i) => i.Id === resolved!.InventoryId);
		const statName =
			statDefinitions.find((d) => d.Id === resolved!.StatId)?.Name ??
			resolved!.StatId;
		return `${inv?.Name ?? "Unknown Inventory"} → ${statName}`;
	};

	// ---- RestoreRule ----
	const handleRestoreRuleChange = (rule: StatSlot["RestoreRule"]) => {
		if (rule === undefined) {
			// An empty rule (no rest types enabled) still means the slot is
			// actively overriding the template — keep as explicit {} to make
			// that distinction. If the user wants to return to inherit, use
			// the Reset button below.
			onSlotChange({ ...slot, RestoreRule: {} });
		} else {
			onSlotChange({ ...slot, RestoreRule: rule });
		}
	};

	const handleRestoreRuleReset = () => {
		const { RestoreRule: _, ...rest } = slot;
		onSlotChange(rest as StatSlot);
	};

	const isRestoreOverridden = slot.RestoreRule !== undefined;

	return (
		<div className="p-3 bg-base-200 rounded-lg space-y-3 text-sm">
			{/* RegenRate */}
			<div className="flex items-center gap-3 flex-wrap">
				<span className="font-medium opacity-70 min-w-24">Regen / Turn</span>
				<input
					type="number"
					value={slot.RegenRate ?? ""}
					onChange={(e) => handleRegenChange(e.target.value)}
					disabled={readOnly}
					className="input input-bordered input-sm w-24"
					placeholder={
						template.RegenRate !== undefined
							? `default: ${template.RegenRate}`
							: "none"
					}
				/>
				{slot.RegenRate !== undefined && (
					<button
						type="button"
						onClick={handleRegenReset}
						disabled={readOnly}
						className="btn btn-ghost btn-xs"
						title="Reset to campaign default"
					>
						Reset
					</button>
				)}
				<span className="text-xs opacity-70">
					Effective: {effectiveRegen ?? "none"}
				</span>
			</div>

			{/* OverflowTarget */}
			<div className="flex items-center gap-3 flex-wrap">
				<span className="font-medium opacity-70 min-w-24">Overflow</span>
				<select
					value={encodeOverflowValue(slot.OverflowTarget)}
					onChange={(e) => handleOverflowChange(e.target.value)}
					disabled={readOnly}
					className="select select-bordered select-sm flex-1 min-w-48"
				>
					<option value="__inherit__">Inherit from campaign default</option>
					<option value="__disabled__">Disabled (no overflow)</option>
					{overflowOptions.length > 0 && (
						<optgroup label="Send overflow to…">
							{overflowOptions.map((opt) => (
								<option key={opt.value} value={opt.value}>
									{opt.label}
								</option>
							))}
						</optgroup>
					)}
				</select>
				<span className="text-xs opacity-70">
					Effective: {renderEffectiveOverflow()}
				</span>
			</div>

			{/* RestoreRule */}
			<div>
				<div className="flex items-center gap-2 mb-1">
					<span className="font-medium opacity-70">Restore Rules</span>
					{!isRestoreOverridden && template.RestoreRule && (
						<span className="text-xs opacity-70 italic">
							(inheriting from campaign default)
						</span>
					)}
					{!isRestoreOverridden && !template.RestoreRule && (
						<span className="text-xs opacity-70 italic">
							(no default — set below to override)
						</span>
					)}
				</div>
				<RestoreRuleEditor
					value={slot.RestoreRule ?? template.RestoreRule}
					onChange={handleRestoreRuleChange}
					readOnly={readOnly}
				/>
				{isRestoreOverridden && (
					<button
						type="button"
						onClick={handleRestoreRuleReset}
						disabled={readOnly}
						className="btn btn-ghost btn-xs mt-1"
						title="Reset to campaign default"
					>
						Reset to default
					</button>
				)}
			</div>
		</div>
	);
}
