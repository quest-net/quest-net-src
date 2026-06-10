import { useState } from "react";
import { Actor } from "../Actor/Actor";
import { CampaignSettings } from "../CampaignSetting/CampaignSetting";
import { resolveStat } from "../../utils/ActorResolvers";
import { LocalStorageUtilities } from "../../utils/LocalStorageUtilities";

interface AggregateStat {
	id: string;
	name: string;
	color: string;
	totalCurrent: number;
	totalMax: number;
	percentage: number;
}

export function calculateAggregateStats(
	actors: Actor[],
	settings: CampaignSettings
): AggregateStat[] {
	return settings.StatDefinitions.map((definition) => {
		let totalCurrent = 0;
		let totalMax = 0;

		for (const actor of actors) {
			const slot = actor.Stats.find((stat) => stat.Id === definition.Id);
			if (!slot || slot.Current === null) continue;

			const resolved = resolveStat(slot, definition);
			totalCurrent += resolved.Current ?? 0;
			totalMax += resolved.Max;
		}

		if (totalMax <= 0) return null;

		return {
			id: definition.Id,
			name: definition.Name,
			color: definition.Color,
			totalCurrent,
			totalMax,
			percentage: (totalCurrent / totalMax) * 100,
		};
	}).filter((stat): stat is AggregateStat => stat !== null);
}

export function AggregateStatsSummary({
	title,
	actors,
	settings,
}: {
	title: string;
	actors: Actor[];
	settings: CampaignSettings;
}) {
	const stats = calculateAggregateStats(actors, settings);

	const storageKey = `aggregateStatsSummary:expanded:${title}`;
	const [expanded, setExpanded] = useState<boolean>(
		() => LocalStorageUtilities.load<boolean>(storageKey) ?? false
	);

	const toggle = () => {
		setExpanded((prev) => {
			const next = !prev;
			LocalStorageUtilities.save(storageKey, next);
			return next;
		});
	};

	return (
		<div className="card bg-base-200 border-2 border-base-300">
			<div className="card-body p-4">
				<button
					type="button"
					onClick={toggle}
					aria-expanded={expanded}
					className="flex items-center justify-between gap-2 w-full text-left"
				>
					<h2 className="font-bold text-lg">{title}</h2>
					<span
						className={`icon-[mdi--chevron-down] h-5 w-5 opacity-70 transition-transform duration-200 ${
							expanded ? "rotate-180" : ""
						}`}
					/>
				</button>
				{expanded &&
					(stats.length === 0 ? (
						<div className="text-sm opacity-70 mt-3">No stats to summarize.</div>
					) : (
						<div className="space-y-3 mt-3">
							{stats.map((stat) => (
								<div key={stat.id} className="space-y-1">
									<div className="flex items-center justify-between gap-2">
										<span className="text-sm font-medium truncate">{stat.name}</span>
										<span className="text-sm opacity-70 shrink-0">
											{stat.totalCurrent} / {stat.totalMax} ({stat.percentage.toFixed(0)}%)
										</span>
									</div>
									<div className="relative w-full h-6 bg-base-300 rounded overflow-hidden">
										<div
											className="h-full transition-all duration-300"
											style={{
												width: `${Math.max(0, Math.min(100, stat.percentage))}%`,
												backgroundColor: stat.color,
											}}
										/>
									</div>
								</div>
							))}
						</div>
					))}
			</div>
		</div>
	);
}

export function isInteractiveCardTarget(
	target: EventTarget | null,
	card?: HTMLElement
): boolean {
	if (!(target instanceof HTMLElement)) return false;

	const nativeInteractive = target.closest(
		"button,input,select,textarea,a,[data-card-action]"
	);
	if (nativeInteractive) return true;

	const roleButton = target.closest("[role='button']");
	return Boolean(roleButton && roleButton !== card);
}
