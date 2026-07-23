import { HERO_OCCLUSION_RADIUS_SETTING } from "./AppSetting";

interface HeroOcclusionRadiusControlProps {
	value: number;
	disabled?: boolean;
	compact?: boolean;
	onChange: (radius: number) => void;
}

function closestPresetIndex(radius: number): number {
	let closestIndex = 0;
	let closestDistance = Infinity;
	for (let index = 0; index < HERO_OCCLUSION_RADIUS_SETTING.PRESETS.length; index++) {
		const distance = Math.abs(
			HERO_OCCLUSION_RADIUS_SETTING.PRESETS[index].value - radius
		);
		if (distance < closestDistance) {
			closestIndex = index;
			closestDistance = distance;
		}
	}
	return closestIndex;
}

function formatRadius(radius: number): string {
	return Number.isInteger(radius)
		? radius.toString()
		: radius.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

export function HeroOcclusionRadiusControl({
	value,
	disabled = false,
	compact = false,
	onChange,
}: HeroOcclusionRadiusControlProps) {
	const presets = HERO_OCCLUSION_RADIUS_SETTING.PRESETS;
	const selectedIndex = closestPresetIndex(value);
	const exactPreset = presets.find(
		(preset) => Math.abs(preset.value - value) < 0.0001
	);
	const valueText = exactPreset
		? `${exactPreset.label}, ${formatRadius(value)} tiles`
		: `Custom, ${formatRadius(value)} tiles`;

	return (
		<label
			className={`flex items-center gap-3 ${disabled ? "opacity-50" : ""}`}
		>
			<span
				className="h-2.5 w-2.5 shrink-0 rounded-full border-2 border-current opacity-60"
				aria-hidden="true"
			/>
			<div className="relative min-w-0 flex-1">
				<input
					type="range"
					min={0}
					max={presets.length - 1}
					step={1}
					value={selectedIndex}
					onChange={(event) =>
						onChange(presets[Number(event.target.value)].value)
					}
					disabled={disabled}
					className={`range range-primary relative z-10 w-full ${
						compact ? "range-sm" : ""
					}`}
					aria-label="See-through terrain area"
					aria-valuetext={valueText}
				/>
				<div
					className="pointer-events-none absolute inset-x-2 top-1/2 z-20 flex -translate-y-1/2 justify-between"
					aria-hidden="true"
				>
					{presets.map((preset) => (
						<span
							key={preset.label}
							className="h-2 w-px bg-base-content/45"
						/>
					))}
				</div>
			</div>
			<span
				className="h-5 w-5 shrink-0 rounded-full border-2 border-current opacity-60"
				aria-hidden="true"
			/>
		</label>
	);
}
