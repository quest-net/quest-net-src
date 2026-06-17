// domains/CampaignSetting/CampaignStats.tsx
//
// At-a-glance DM stats for the active campaign: how many of each collection
// exist, plus a few fun bits of info.
//   - "panel"   : compact card for the Campaign Settings right column.
//   - "large"   : roomier dashboard used as the General tab overview.

import type { Campaign } from "../Campaign/Campaign";

interface CampaignStatsProps {
	campaign: Campaign;
	variant?: "panel" | "large";
}

export function CampaignStats({ campaign, variant = "panel" }: CampaignStatsProps) {
	const tiles: { label: string; icon: string; count: number }[] = [
		{
			label: "Characters",
			icon: "icon-[mdi--account-group]",
			count: campaign.CharacterRoster.length,
		},
		{
			label: "Entities",
			icon: "icon-[mdi--robot]",
			count: campaign.EntityTemplates.length,
		},
		{ label: "Items", icon: "icon-[mdi--sack]", count: campaign.ItemTemplates.length },
		{ label: "Skills", icon: "icon-[mdi--star]", count: campaign.SkillTemplates.length },
		{
			label: "Statuses",
			icon: "icon-[mdi--heart-pulse]",
			count: campaign.StatusTemplates.length,
		},
		{
			label: "Images",
			icon: "icon-[mdi--image-multiple]",
			count: campaign.Images.length,
		},
		{ label: "Audios", icon: "icon-[mdi--music]", count: campaign.Audios.length },
		{
			label: "Terrains",
			icon: "icon-[mdi--terrain]",
			count: campaign.VoxelTerrains.length,
		},
		{
			label: "Scenarios",
			icon: "icon-[mdi--map-marker-multiple]",
			count: campaign.Scenarios.length,
		},
		{
			label: "Log entries",
			icon: "icon-[mdi--text-box-outline]",
			count: campaign.Log.length,
		},
	];

	const createdLabel = formatCreated(campaign.CreatedAt);
	const ageLabel = formatAge(campaign.CreatedAt);

	if (variant === "large") {
		return (
			<div className="card bg-base-100 border-2 border-base-300">
				<div className="card-body gap-4">
					<div className="flex flex-wrap items-center justify-between gap-2">
						<h3 className="text-lg font-semibold flex items-center gap-2">
							<span className="icon-[mdi--chart-box-outline] w-6 h-6" />
							At a Glance
						</h3>
						<div className="flex flex-wrap items-center gap-3 text-sm opacity-70">
							{createdLabel && <span>Created {createdLabel}</span>}
							{ageLabel && (
								<span className="badge badge-ghost">{ageLabel} old</span>
							)}
						</div>
					</div>

					<div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
						{tiles.map((tile) => (
							<div
								key={tile.label}
								className="flex flex-col items-center justify-center gap-1 rounded-lg bg-base-200/50 p-3 text-center"
							>
								<span className={`${tile.icon} w-7 h-7 opacity-70`} />
								<div className="text-2xl font-bold leading-none">
									{formatCount(tile.count)}
								</div>
								<div className="text-xs opacity-70">{tile.label}</div>
							</div>
						))}
					</div>
				</div>
			</div>
		);
	}

	// Logs aren't assets and cap at 1000, so excluding them keeps the total
	// meaningful instead of perpetually reading "999+".
	const totalAssets = tiles.reduce(
		(sum, tile) => (tile.label === "Log entries" ? sum : sum + tile.count),
		0
	);

	return (
		<div className="card bg-base-100 border-2 border-base-300">
			<div className="card-body gap-3">
				<h3 className="font-semibold flex items-center gap-2">
					<span className="icon-[mdi--chart-box-outline] w-5 h-5" />
					Campaign Stats
				</h3>

				<div className="grid grid-cols-2 gap-2">
					{tiles.map((tile) => (
						<div
							key={tile.label}
							className="flex items-center gap-2 rounded-md bg-base-200/50 px-2 py-1.5"
						>
							<span className={`${tile.icon} w-5 h-5 shrink-0 opacity-70`} />
							<div className="min-w-0">
								<div className="font-bold leading-none">
									{formatCount(tile.count)}
								</div>
								<div className="text-xs opacity-70 truncate">{tile.label}</div>
							</div>
						</div>
					))}
				</div>

				<div className="space-y-1 pt-1 border-t border-base-300 text-xs opacity-70">
					<div className="flex justify-between gap-2">
						<span>Total assets</span>
						<span className="font-mono">{formatCount(totalAssets)}</span>
					</div>
					{createdLabel && (
						<div className="flex justify-between gap-2">
							<span>Created</span>
							<span>{createdLabel}</span>
						</div>
					)}
					{ageLabel && (
						<div className="flex justify-between gap-2">
							<span>Age</span>
							<span>{ageLabel}</span>
						</div>
					)}
				</div>
			</div>
		</div>
	);
}

// Collections cap at 1000 (the log especially). Show "999+" once a count tops
// 999 rather than a misleadingly precise capped number.
function formatCount(count: number): string {
	return count > 999 ? "999+" : String(count);
}

function formatCreated(createdAt: number): string | null {
	if (!createdAt) return null;
	return new Date(createdAt).toLocaleDateString(undefined, {
		year: "numeric",
		month: "short",
		day: "numeric",
	});
}

function formatAge(createdAt: number): string | null {
	if (!createdAt) return null;
	const days = Math.floor((Date.now() - createdAt) / (1000 * 60 * 60 * 24));
	if (days < 1) return "today";
	if (days === 1) return "1 day";
	if (days < 30) return `${days} days`;
	const months = Math.floor(days / 30);
	if (months === 1) return "1 month";
	if (months < 12) return `${months} months`;
	const years = Math.floor(days / 365);
	return years === 1 ? "1 year" : `${years} years`;
}
