// components/inputs/TerrainPicker.tsx
//
// A single-select modal for choosing a terrain, styled and paged to match
// ObjectPicker / the other "picker" components. Used by the Overview and
// Inspector to pick a destination when moving actors between terrains.
//
// Stamp terrains are excluded (they are not places actors can occupy). The list
// is ordered in three tiers so the most relevant destinations surface first:
//   1. Terrains that currently have actors on them (most-occupied first).
//   2. The DM's recently-viewed terrains (recency order).
//   3. Everything else, in campaign order.
// Each card shows an occupant-count badge so the DM can see where the action is.

import { useMemo, useState } from "react";
import { useQuestContext } from "../../domains/Context/ContextProvider";
import { CampaignUtils } from "../../domains/Campaign/CampaignUtils";
import { useViewedTerrain } from "../Map/useViewedTerrain";
import { isStampTerrain } from "../../utils/terrain/editor/VoxelStampUtils";
import { Modal } from "../ui/Modal";
import { EmptyState } from "../ui/EmptyState";

interface TerrainPickerProps {
	isOpen: boolean;
	onConfirm: (terrainId: string) => void;
	onCancel: () => void;
	title?: string;
	/** Label for the confirm button. Defaults to "Move Here". */
	confirmLabel?: string;
	/** Terrain to mark as the current location (rendered with a "Current" badge). */
	currentTerrainId?: string;
}

const ITEMS_PER_PAGE = 12;

export function TerrainPicker({
	isOpen,
	onConfirm,
	onCancel,
	title = "Select Terrain",
	confirmLabel = "Move Here",
	currentTerrainId,
}: TerrainPickerProps) {
	const context = useQuestContext();
	const campaign = CampaignUtils.getActiveCampaign(context);
	const { viewedTerrainIds } = useViewedTerrain();

	const [searchQuery, setSearchQuery] = useState("");
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [currentPage, setCurrentPage] = useState(0);

	// Real terrains only, ordered: occupied (most first), then recently-viewed
	// (recency order), then the rest in campaign order.
	const sortedTerrains = useMemo(() => {
		const counts = new Map<string, number>();
		for (const c of campaign.GameState.Characters) {
			counts.set(c.Position.terrainId, (counts.get(c.Position.terrainId) ?? 0) + 1);
		}
		for (const e of campaign.GameState.Entities) {
			counts.set(e.Position.terrainId, (counts.get(e.Position.terrainId) ?? 0) + 1);
		}

		const tier = (occupants: number, recentIndex: number): number =>
			occupants > 0 ? 0 : recentIndex >= 0 ? 1 : 2;

		return campaign.VoxelTerrains
			.filter((t) => !isStampTerrain(t))
			.map((terrain) => ({
				terrain,
				occupants: counts.get(terrain.Id) ?? 0,
				recentIndex: viewedTerrainIds.indexOf(terrain.Id),
			}))
			.sort((a, b) => {
				const ta = tier(a.occupants, a.recentIndex);
				const tb = tier(b.occupants, b.recentIndex);
				if (ta !== tb) return ta - tb;
				if (ta === 0) return b.occupants - a.occupants; // most-occupied first
				if (ta === 1) return a.recentIndex - b.recentIndex; // recency order
				return 0; // campaign order (stable sort)
			});
	}, [campaign.VoxelTerrains, campaign.GameState, viewedTerrainIds]);

	const filteredTerrains = useMemo(() => {
		const query = searchQuery.trim().toLowerCase();
		if (!query) return sortedTerrains;
		return sortedTerrains.filter(({ terrain }) =>
			terrain.Name.toLowerCase().includes(query)
		);
	}, [sortedTerrains, searchQuery]);

	const totalPages = Math.ceil(filteredTerrains.length / ITEMS_PER_PAGE);
	const paginatedTerrains = useMemo(() => {
		const start = currentPage * ITEMS_PER_PAGE;
		return filteredTerrains.slice(start, start + ITEMS_PER_PAGE);
	}, [filteredTerrains, currentPage]);

	const handleSearchChange = (query: string) => {
		setSearchQuery(query);
		setCurrentPage(0);
	};

	const handleConfirm = () => {
		if (!selectedId) return;
		onConfirm(selectedId);
		setSelectedId(null);
		setSearchQuery("");
		setCurrentPage(0);
	};

	const handleCancel = () => {
		setSelectedId(null);
		setSearchQuery("");
		setCurrentPage(0);
		onCancel();
	};

	if (!isOpen) return null;

	return (
		<Modal title={title} onClose={handleCancel} size="xl" fullHeight>
				{/* Search Bar */}
				<div className="flex gap-2 mb-4">
					<input
						type="text"
						placeholder="Search terrains by name..."
						value={searchQuery}
						onChange={(e) => handleSearchChange(e.target.value)}
						className="input input-bordered input-sm flex-1"
					/>
					{searchQuery && (
						<button
							onClick={() => handleSearchChange("")}
							className="btn btn-ghost btn-sm"
						>
							<span className="icon-[mdi--close] w-4 h-4" />
						</button>
					)}
				</div>

				{/* Terrain Grid */}
				<div className="flex-1 overflow-y-auto p-2">
					{paginatedTerrains.length === 0 ? (
						<EmptyState bordered icon="icon-[mdi--terrain]">
							{searchQuery
								? "No terrains match your search"
								: "No terrains available"}
						</EmptyState>
					) : (
						<div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
							{paginatedTerrains.map(({ terrain, occupants }) => {
								const isSelected = selectedId === terrain.Id;
								const isCurrent = terrain.Id === currentTerrainId;

								return (
									<div
										key={terrain.Id}
										onClick={() => setSelectedId(terrain.Id)}
										className={`
											card bg-base-100 border-2 cursor-pointer transition-all
											${isSelected
												? "border-primary ring-2 ring-primary"
												: "border-base-300 hover:border-primary"
											}
										`}
									>
										<figure className="border-b">
											<div
												className="w-full h-32 flex items-center justify-center"
												style={{
													backgroundColor:
														terrain.PreviewColor ?? "var(--color-base-200)",
												}}
											>
												<span className="icon-[mdi--terrain] w-12 h-12 opacity-70" />
											</div>
										</figure>
										<div className="card-body p-2 gap-1">
											<h4
												className="text-xs font-semibold truncate"
												title={terrain.Name}
											>
												{terrain.Name}
											</h4>
											<div className="flex flex-wrap items-center gap-1">
												{occupants > 0 && (
													<span className="badge badge-neutral badge-xs gap-1">
														<span className="icon-[mdi--account-group] w-3 h-3" />
														{occupants}
													</span>
												)}
												{isCurrent && (
													<span className="badge badge-ghost badge-xs">
														Current
													</span>
												)}
												{isSelected && (
													<span className="badge badge-primary badge-xs">
														Selected
													</span>
												)}
											</div>
										</div>
									</div>
								);
							})}
						</div>
					)}
				</div>

				{/* Footer Actions + Pagination */}
				<div className="mt-2 flex items-center justify-between gap-2">
					{/* Left: Clear */}
					<button
						onClick={() => setSelectedId(null)}
						className="btn btn-neutral btn-sm"
						disabled={!selectedId}
					>
						Clear Selection
					</button>

					{/* Middle: Pagination */}
					<div className="flex flex-col items-center gap-1">
						{filteredTerrains.length > 0 && totalPages > 1 && (
							<div className="join">
								<button
									type="button"
									className="btn btn-sm join-item"
									onClick={() => setCurrentPage((p) => Math.max(0, p - 1))}
									disabled={currentPage === 0}
								>
									«
								</button>
								<button
									type="button"
									className="btn btn-sm join-item pointer-events-none"
								>
									Page {currentPage + 1} / {totalPages}
								</button>
								<button
									type="button"
									className="btn btn-sm join-item"
									onClick={() =>
										setCurrentPage((p) => Math.min(totalPages - 1, p + 1))
									}
									disabled={currentPage === totalPages - 1}
								>
									»
								</button>
							</div>
						)}
					</div>

					{/* Right: Cancel / Confirm */}
					<div className="flex gap-2">
						<button onClick={handleCancel} className="btn btn-sm">
							Cancel
						</button>
						<button
							onClick={handleConfirm}
							className="btn btn-primary btn-sm"
							disabled={!selectedId}
						>
							{confirmLabel}
						</button>
					</div>
				</div>
		</Modal>
	);
}
