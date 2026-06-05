// components/Map/DmMapToolbar.tsx
//
// The DM's full-width map toolbar (world mode only). Left side carries the map
// controls (first-person, camera mode, actor X-ray); a divider separates them
// from a row of terrain tabs.
//
// The tabs are deliberately rectangular with solid backgrounds rather than the
// app's `tabs-lift` style: a lift tab bleeds into the content below it, and the
// content here is the 3D map, which can be any colour. Solid tabs stay legible
// over anything.
//
// The tab set is every terrain that currently has actors on it (stamps
// excluded), plus the viewed terrain. Ordering is *stable* — terrains keep
// their place in the campaign list (character-bearing ones grouped first) so
// switching tabs never reshuffles them. Tabs that don't fit collapse into an
// ellipsis dropdown at the far right.
//
// Hovering a tab reveals the names of the actors on that terrain (up to five,
// characters before entities). Switching tab is purely local view state (see
// useViewedTerrain / docs/multi-terrain-world.md §5.2).

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CameraPreference } from "./MapScene";
import { CameraModeDropdown } from "./CameraModeDropdown";
import { useViewedTerrain } from "./useViewedTerrain";
import { useActionService } from "../../services/Actions/ActionServiceProvider";
import { CaptureModal } from "../../domains/Scenario/CaptureModal";
import { isStampTerrain } from "../../utils/terrain/editor/VoxelStampUtils";
import { isItemEntity } from "../../domains/Item/ItemDropUtils";
import type { Campaign } from "../../domains/Campaign/Campaign";
import type { VoxelTerrain } from "../../domains/VoxelTerrain/VoxelTerrain";

// Space (px) reserved for the ellipsis dropdown when tabs overflow, and the
// horizontal gap between tabs (matches the gap-1 utility = 0.25rem).
const ELLIPSIS_RESERVE = 44;
const TAB_GAP = 4;
const MAX_TOOLTIP_NAMES = 5;

const TAB_BASE =
	"inline-flex h-10 w-36 items-center gap-1.5 px-3 text-sm font-medium whitespace-nowrap transition-colors";
const TAB_ACTIVE = "bg-primary border-base-300 text-primary-content shadow-sm";
const TAB_INACTIVE =
	"border-base-300 bg-base-100 text-base-content/80 hover:bg-base-200 hover:text-base-content";

interface DmMapToolbarProps {
	campaign: Campaign;
	cameraPreference: CameraPreference;
	onCameraPreferenceChange: (mode: CameraPreference) => void;
	xRayActors: boolean;
	onToggleXRay: () => void;
	showFirstPersonButton: boolean;
	onEnterFirstPerson: () => void;
}

function TabInner({ name }: { name: string }) {
	return (
		<>
			<span className="icon-[mdi--terrain] h-4 w-4 shrink-0 opacity-70" />
			<span className="min-w-0 flex-1 truncate text-left">{name}</span>
		</>
	);
}

export function DmMapToolbar({
	campaign,
	cameraPreference,
	onCameraPreferenceChange,
	xRayActors,
	onToggleXRay,
	showFirstPersonButton,
	onEnterFirstPerson,
}: DmMapToolbarProps) {
	const { viewedTerrainId, viewedTerrainIds, setViewedTerrain, clearViewedTerrain } =
		useViewedTerrain();

	const [captureOpen, setCaptureOpen] = useState(false);
	const { actionService } = useActionService();

	const characters = campaign.GameState.Characters;
	const entities = campaign.GameState.Entities;

	// "Bring party here": one-click consolidation of the multi-step Overview move
	// flow. Targets the terrain the DM is currently viewing and moves every party
	// member (characters only) that isn't already standing on it. partyToMove is
	// empty when the whole party is already here, which disables the button.
	const viewedTerrain = viewedTerrainId
		? campaign.VoxelTerrains.find((t) => t.Id === viewedTerrainId)
		: undefined;
	const partyToMove = viewedTerrainId
		? characters.filter((c) => c.Position.terrainId !== viewedTerrainId)
		: [];
	const handleBringPartyHere = () => {
		if (!actionService || !viewedTerrainId || partyToMove.length === 0) return;
		actionService.execute("terrain:moveActors", {
			actorIds: partyToMove.map((c) => c.Id),
			toTerrainId: viewedTerrainId,
		});
	};

	const hasCharacterOn = (terrainId: string): boolean =>
		characters.some((c) => c.Position.terrainId === terrainId);

	// Terrains that currently hold actors. These always get a tab and can't be
	// dismissed (they would just reappear). Recently-viewed *empty* terrains are
	// the dismissible ones.
	const occupiedSet = useMemo(() => {
		const occupied = new Set<string>();
		for (const c of characters) occupied.add(c.Position.terrainId);
		for (const e of entities) occupied.add(e.Position.terrainId);
		return occupied;
	}, [characters, entities]);

	const isDismissible = (terrainId: string): boolean =>
		!occupiedSet.has(terrainId);

	// Tab set: every actor-occupied terrain (stamps excluded), then the DM's
	// recently-viewed empty terrains in recency order. Occupied terrains lead —
	// character-bearing first, then entity-only — so the tabs stay stable while
	// actors move; recent empties trail behind and carry a dismiss button. The
	// active terrain always gets a tab even if it is empty and not yet in the
	// recent list (e.g. just navigated to from the terrain index).
	const tabs = useMemo<VoxelTerrain[]>(() => {
		const real = campaign.VoxelTerrains.filter((t) => !isStampTerrain(t));
		const byId = new Map(real.map((t) => [t.Id, t] as const));

		const occupiedReal = real.filter((t) => occupiedSet.has(t.Id));
		const ordered = [
			...occupiedReal.filter((t) => hasCharacterOn(t.Id)),
			...occupiedReal.filter((t) => !hasCharacterOn(t.Id)),
		];

		for (const id of viewedTerrainIds) {
			if (occupiedSet.has(id)) continue;
			const terrain = byId.get(id);
			if (terrain && !ordered.some((t) => t.Id === id)) ordered.push(terrain);
		}

		if (viewedTerrainId && !ordered.some((t) => t.Id === viewedTerrainId)) {
			const terrain = byId.get(viewedTerrainId);
			if (terrain) ordered.push(terrain);
		}

		return ordered;
		// hasCharacterOn closes over `characters`, listed in the deps below.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [campaign.VoxelTerrains, characters, occupiedSet, viewedTerrainIds, viewedTerrainId]);

	// One line per occupant: characters first, then entities; dropped items are
	// not actors worth naming, so they are filtered out. Capped at five names
	// with a trailing "+N more" line. Empty when nobody is on the terrain (the
	// caller then skips the tooltip entirely).
	const occupantLines = (terrainId: string): string[] => {
		const names = [
			...characters
				.filter((c) => c.Position.terrainId === terrainId)
				.map((c) => c.Name),
			...entities
				.filter((e) => e.Position.terrainId === terrainId && !isItemEntity(e))
				.map((e) => e.Name),
		];
		if (names.length === 0) return [];
		const shown = names.slice(0, MAX_TOOLTIP_NAMES);
		if (names.length > MAX_TOOLTIP_NAMES) {
			shown.push(`+${names.length - MAX_TOOLTIP_NAMES} more`);
		}
		return shown;
	};

	// --- Overflow handling --------------------------------------------------
	// A hidden measurement row holds every tab at its natural width; we read
	// those widths to decide how many fit and route the rest to the dropdown.
	const containerRef = useRef<HTMLDivElement>(null);
	const measureRef = useRef<HTMLDivElement>(null);
	const [visibleCount, setVisibleCount] = useState(tabs.length);

	const signature = tabs
		.map((t) => `${t.Id}:${t.Name}:${isDismissible(t.Id) ? 1 : 0}`)
		.join("|");

	useLayoutEffect(() => {
		const container = containerRef.current;
		const measure = measureRef.current;
		if (!container || !measure) return;

		const recompute = () => {
			const widths = Array.from(measure.children).map(
				(el) => (el as HTMLElement).getBoundingClientRect().width
			);
			const n = widths.length;
			const available = container.clientWidth;

			const totalAll = widths.reduce(
				(sum, w, i) => sum + w + (i > 0 ? TAB_GAP : 0),
				0
			);
			if (totalAll <= available) {
				setVisibleCount(n);
				return;
			}

			const budget = available - ELLIPSIS_RESERVE;
			let used = 0;
			let count = 0;
			for (let i = 0; i < n; i++) {
				const needed = used + (count > 0 ? TAB_GAP : 0) + widths[i];
				if (needed <= budget) {
					used = needed;
					count++;
				} else {
					break;
				}
			}
			setVisibleCount(Math.max(1, count));
		};

		recompute();
		const observer = new ResizeObserver(recompute);
		observer.observe(container);
		return () => observer.disconnect();
	}, [signature]);

	const visibleTabs = tabs.slice(0, visibleCount);
	const overflowTabs = tabs.slice(visibleCount);

	return (
		<div className="absolute inset-x-0 top-0 z-40 flex items-center gap-2 border-b-2 border-base-300 bg-base-200/50 px-2 backdrop-blur-sm">
			{/* Map controls */}
			<div className="join shrink-0 shadow-sm">
				{showFirstPersonButton && (
					<button
						className="btn btn-sm btn-neutral join-item tooltip tooltip-bottom"
						data-tip="First-person mode"
						onClick={onEnterFirstPerson}
						aria-label="Enter first-person mode"
					>
						<span className="icon-[mdi--camera-control] w-5 h-5" />
					</button>
				)}
				<CameraModeDropdown
					value={cameraPreference}
					onChange={onCameraPreferenceChange}
					showFreecam
					joinItem
				/>
				<button
					className={`btn btn-sm join-item tooltip tooltip-bottom ${
						xRayActors ? "btn-primary" : "btn-neutral"
					}`}
					data-tip={xRayActors ? "Disable actor X-Ray" : "Actor X-Ray"}
					onClick={onToggleXRay}
					aria-label="Toggle actor X-Ray"
					aria-pressed={xRayActors}
				>
					<span
						className={`${
							xRayActors
								? "icon-[mdi--account-search]"
								: "icon-[mdi--account-search-outline]"
						} w-5 h-5`}
					/>
				</button>
				<button
					className="btn btn-sm btn-neutral join-item tooltip tooltip-bottom"
					data-tip="Capture scenario"
					onClick={() => setCaptureOpen(true)}
					aria-label="Capture scenario"
				>
					<span className="icon-[mdi--camera] w-5 h-5" />
				</button>
				<button
					className="btn btn-sm btn-neutral join-item tooltip tooltip-bottom"
					data-tip={`Bring party to ${viewedTerrain?.Name ?? "this terrain"}`}
					onClick={handleBringPartyHere}
					disabled={partyToMove.length === 0}
					aria-label="Bring party to this terrain"
				>
					<span className="icon-[mdi--map-marker-account] w-5 h-5" />
				</button>
			</div>

			{/* Terrain tabs. The strip itself is NOT overflow-clipped so tab
			    tooltips can spill below the toolbar; only the hidden measurement
			    row is clipped (in its own box) so its full width can't widen the
			    page. visibleTabs is pre-sliced to fit, so the strip never spills. */}
			<div ref={containerRef} className="relative min-w-0 flex-1">
				<div className="pointer-events-none absolute inset-0 overflow-hidden">
					<div
						ref={measureRef}
						aria-hidden
						className="invisible absolute left-0 top-0 flex gap-1"
					>
						{tabs.map((terrain) => (
							<span key={terrain.Id} className="flex items-stretch">
								<span
									className={`${TAB_BASE} ${TAB_INACTIVE} ${isDismissible(terrain.Id) ? "" : "border-r"}`}
								>
									<TabInner name={terrain.Name} />
								</span>
								{isDismissible(terrain.Id) && (
									<span className="inline-flex h-10 items-center border-r px-1.5">
										<span className="icon-[mdi--close] h-3.5 w-3.5" />
									</span>
								)}
							</span>
						))}
					</div>
				</div>

				<div role="tablist" className="border-l flex">
					{visibleTabs.map((terrain) => {
						const active = terrain.Id === viewedTerrainId;
						const dismissible = isDismissible(terrain.Id);
						const lines = occupantLines(terrain.Id);
						return (
							<div
								key={terrain.Id}
								className={`flex items-stretch ${lines.length ? "tooltip tooltip-bottom" : ""}`}
							>
								{lines.length > 0 && (
									<div className="tooltip-content">
										{lines.map((line, i) => (
											<div key={i} className="whitespace-nowrap">
												{line}
											</div>
										))}
									</div>
								)}
								<button
									role="tab"
									className={`${TAB_BASE} ${active ? TAB_ACTIVE : TAB_INACTIVE} ${dismissible ? "" : "border-r"}`}
									onClick={() => setViewedTerrain(terrain.Id)}
									aria-selected={active}
								>
									<TabInner name={terrain.Name} />
								</button>
								{dismissible && (
									<button
										type="button"
										className={`inline-flex h-10 items-center border-r border-base-300 px-1.5 transition-colors ${
											active
												? "bg-primary text-primary-content/70 hover:text-primary-content"
												: "bg-base-100 text-base-content/40 hover:bg-base-200 hover:text-base-content"
										}`}
										onClick={() => clearViewedTerrain(terrain.Id)}
										aria-label={`Remove ${terrain.Name} from recent terrains`}
										title="Remove from recent terrains"
									>
										<span className="icon-[mdi--close] h-3.5 w-3.5" />
									</button>
								)}
							</div>
						);
					})}
				</div>
			</div>

			{/* Overflow dropdown */}
			{overflowTabs.length > 0 && (
				<div className="dropdown dropdown-bottom dropdown-end shrink-0">
					<button
						tabIndex={0}
						type="button"
						className="btn btn-sm btn-ghost"
						aria-label="More terrains"
						title="More terrains"
					>
						<span className="icon-[mdi--dots-horizontal] w-5 h-5" />
					</button>
					<ul
						tabIndex={0}
						className="dropdown-content menu z-50 mt-1 max-h-80 w-56 flex-nowrap overflow-y-auto rounded-box border border-base-300 bg-base-200 p-1 shadow-lg"
					>
						{overflowTabs.map((terrain) => (
							<li key={terrain.Id} className="flex flex-row items-center">
								<button
									type="button"
									className={`min-w-0 flex-1 ${terrain.Id === viewedTerrainId ? "active" : ""}`}
									onClick={() => {
										setViewedTerrain(terrain.Id);
										(document.activeElement as HTMLElement | null)?.blur();
									}}
									title={occupantLines(terrain.Id).join("\n") || undefined}
								>
									<span className="icon-[mdi--terrain] h-4 w-4 opacity-70" />
									<span className="truncate">{terrain.Name}</span>
								</button>
								{isDismissible(terrain.Id) && (
									<button
										type="button"
										className="shrink-0 px-2"
										onClick={() => clearViewedTerrain(terrain.Id)}
										aria-label={`Remove ${terrain.Name} from recent terrains`}
										title="Remove from recent terrains"
									>
										<span className="icon-[mdi--close] h-4 w-4 opacity-70" />
									</button>
								)}
							</li>
						))}
					</ul>
				</div>
			)}

			<CaptureModal isOpen={captureOpen} onClose={() => setCaptureOpen(false)} />
		</div>
	);
}
