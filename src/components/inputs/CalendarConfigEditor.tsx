// components/inputs/CalendarConfigEditor.tsx
import { useMemo } from "react";
import { CalendarSettings } from "../../domains/CampaignSetting/CampaignSetting";
import { useFormReadOnly } from "../Form/Form";

interface CalendarConfigEditorProps {
	value: CalendarSettings| undefined;
	onChange: (next: CalendarSettings) => void;
	readOnly?: boolean;
}

/**
 * Editor for flexible, fantasy-friendly calendar configs.
 * - daysPerWeek (0 disables weeks)
 * - daysPerMonth
 * - monthsPerYear
 * - dayNames (matches daysPerWeek)
 * - monthNames (matches monthsPerYear)
 * - weekLabel / monthLabel / yearLabel (can be empty)
 */
export function CalendarConfigEditor({
	value,
	onChange,
	readOnly: readOnlyProp,
}: CalendarConfigEditorProps) {
	const contextReadOnly = useFormReadOnly();
	const readOnly = readOnlyProp ?? contextReadOnly;
	const cfg = value;
	if (cfg == null)
	{
		return (
			<div>
				Error: No config found
			</div>
		)
	}

	// ------- helpers -------
	const clampInt = (n: number, min: number, max: number) =>
		Number.isFinite(n) ? Math.max(min, Math.min(max, Math.trunc(n))) : min;

	const normalizeDayNames = (daysPerWeek: number, current: string[]) => {
		if (daysPerWeek <= 0) return [];
		const next = current.slice(0, daysPerWeek);
		while (next.length < daysPerWeek) next.push(`Day ${next.length + 1}`);
		return next;
	};

	const normalizeMonthNames = (monthsPerYear: number, current: string[]) => {
		const next = current.slice(0, monthsPerYear);
		while (next.length < monthsPerYear) next.push(`Month ${next.length + 1}`);
		return next;
	};

	const update = (partial: Partial<CalendarSettings>) => {
		const base: CalendarSettings = { ...cfg, ...partial };

		// enforce array sizes after numeric changes
		const fixedDays = clampInt(base.daysPerWeek, 0, 64);
		const fixedMonthsPerYear = clampInt(base.monthsPerYear, 1, 64);
		const fixedDaysPerMonth = clampInt(base.daysPerMonth, 1, 366);

		const dayNames = normalizeDayNames(fixedDays, base.dayNames ?? []);
		const monthNames = normalizeMonthNames(
			fixedMonthsPerYear,
			base.monthNames ?? []
		);

		onChange({
			...base,
			daysPerWeek: fixedDays,
			daysPerMonth: fixedDaysPerMonth,
			monthsPerYear: fixedMonthsPerYear,
			dayNames,
			monthNames,
		});
	};

	const showWeeks = cfg.daysPerWeek > 0;

	// Basic preview text (no requirement, but handy)
	const preview = useMemo(() => {
		const day = cfg.dayNames?.[0] || (showWeeks ? "Day 1" : "");
		const month = cfg.monthNames?.[0] || "Month 1";
		const weekPiece = showWeeks && (cfg.weekLabel || "").trim()
			? ` • ${cfg.weekLabel} 1`
			: "";
		const yearLabel = (cfg.yearLabel || "Year").trim();
		return `${day ? day + ", " : ""}the 1st of ${month}${weekPiece}\n${yearLabel}: 1`;
	}, [cfg, showWeeks]);

	return (
		<div className="space-y-6">
			{/* Core numbers */}
			<div className="grid grid-cols-1 md:grid-cols-3 gap-4">
				<label className="form-control">
					<span className="label-text font-semibold">Days per Week (0 = no weeks)</span>
					<input
						type="number"
						className="input input-bordered"
						value={cfg.daysPerWeek}
						min={0}
						max={64}
						disabled={readOnly}
						onChange={(e) => update({ daysPerWeek: Number(e.target.value) || 0 })}
					/>
					<span className="label-text-alt">Set to 0 to disable weekday names and week math</span>
				</label>

				<label className="form-control">
					<span className="label-text font-semibold">Days per Month</span>
					<input
						type="number"
						className="input input-bordered"
						value={cfg.daysPerMonth}
						min={1}
						max={366}
						disabled={readOnly}
						onChange={(e) => update({ daysPerMonth: Number(e.target.value) || 1 })}
					/>
				</label>

				<label className="form-control">
					<span className="label-text font-semibold">Months per Year</span>
					<input
						type="number"
						className="input input-bordered"
						value={cfg.monthsPerYear}
						min={1}
						max={64}
						disabled={readOnly}
						onChange={(e) => update({ monthsPerYear: Number(e.target.value) || 1 })}
					/>
				</label>
			</div>

			{/* Labels */}
			<div className="grid grid-cols-1 md:grid-cols-3 gap-4">
				<label className="form-control">
					<span className="label-text font-semibold">Week Label (optional)</span>
					<input
						type="text"
						className="input input-bordered"
						value={cfg.weekLabel ?? ""}
						disabled={readOnly}
						placeholder="e.g., week, tenday"
						onChange={(e) => update({ weekLabel: e.target.value })}
					/>
					<span className="label-text-alt">Leave empty if your world doesn’t use weeks</span>
				</label>

				<label className="form-control">
					<span className="label-text font-semibold">Month Label (optional)</span>
					<input
						type="text"
						className="input input-bordered"
						value={cfg.monthLabel ?? ""}
						disabled={readOnly}
						placeholder="e.g., month"
						onChange={(e) => update({ monthLabel: e.target.value })}
					/>
				</label>

				<label className="form-control">
					<span className="label-text font-semibold">Year Label (optional)</span>
					<input
						type="text"
						className="input input-bordered"
						value={cfg.yearLabel ?? ""}
						disabled={readOnly}
						placeholder="e.g., Year, Solar Cycle"
						onChange={(e) => update({ yearLabel: e.target.value })}
					/>
				</label>
			</div>

			{/* Day names (conditional) */}
			<div className={`space-y-2 ${showWeeks ? "" : "opacity-60"}`}>
				<div className="flex items-center justify-between">
					<h4 className="font-semibold">Day Names ({cfg.daysPerWeek})</h4>
					{!showWeeks && <span className="text-xs opacity-60">Weeks disabled</span>}
				</div>
				<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
					{(showWeeks ? cfg.dayNames : []).map((name, i) => (
						<input
							key={i}
							type="text"
							className="input input-bordered"
							value={name}
							disabled={readOnly}
							placeholder={`Day ${i + 1}`}
							onChange={(e) => {
								const next = [...cfg.dayNames];
								next[i] = e.target.value;
								update({ dayNames: next });
							}}
						/>
					))}
					{showWeeks && cfg.dayNames.length === 0 && (
						<div className="text-sm opacity-60">No day names configured.</div>
					)}
				</div>
			</div>

			{/* Month names */}
			<div className="space-y-2">
				<h4 className="font-semibold">Month Names ({cfg.monthsPerYear})</h4>
				<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
					{cfg.monthNames.map((name, i) => (
						<input
							key={i}
							type="text"
							className="input input-bordered"
							value={name}
							disabled={readOnly}
							placeholder={`Month ${i + 1}`}
							onChange={(e) => {
								const next = [...cfg.monthNames];
								next[i] = e.target.value;
								update({ monthNames: next });
							}}
						/>
					))}
				</div>
			</div>

			{/* Tiny Preview */}
			<div className="rounded-lg border p-3 bg-base-200 whitespace-pre-line text-sm">
				<strong>Preview</strong>
				<div className="mt-1">{preview}</div>
			</div>
		</div>
	);
}

export default CalendarConfigEditor;
