// components/Map/2DMap.tsx
// Minimal 2D grid renderer that mirrors Map.tsx props and behaviors

import { useMemo, useRef, useState, useLayoutEffect, useCallback } from "react";
import type { Character } from "../../domains/Character/Character";
import type { Entity } from "../../domains/Entity/Entity";
import type { Terrain } from "../../domains/Terrain/Terrain";
import { getTerrainColorByIndex } from "../../domains/Terrain/Terrain";
import { useActionService } from "../../services/Actions/ActionServiceProvider";
import { usePeerTracking } from "../../hooks/usePeerTracking";
import { useMapState } from "./MapStateProvider";
import { ImageDisplay } from "../../domains/Image/ImageDisplay";
import {
	applyElevationTint,
	normalizeHeight,
	RANGE_COLOR,
	HOVER_COLOR,
	ELEV_TOP_STRENGTH,
} from "./Terrain";
import {
	calculateMovementRange,
	findActor,
	hexToNum,
	calculateTargetHeight,
	isTileOccupiedAtHeight,
} from "./MapUtilities";
import { CampaignActions } from "../../domains/Campaign/CampaignActions";
import { useQuestContext } from "../../domains/Context/ContextProvider";
import { isItemEntity } from "../../domains/Item/ItemDropUtils";

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------
export type TwoDMapProps = {
	characters: Character[];
	entities: Entity[];
	terrain?: Terrain | null;
	preview?: boolean; // disables selection/movement
	allowPanZoom?: boolean; // ignored in 2D v1
	showControls?: boolean; // ignored in 2D v1
};

// ----------------------------------------------------------------------------
// Local utilities
// ----------------------------------------------------------------------------
function clamp(v: number, min: number, max: number) {
	return Math.max(min, Math.min(max, v));
}

function numToCssHex(n: number): string {
	return `#${n.toString(16).padStart(6, "0")}`;
}

function useMeasuredContainer<T extends HTMLElement>() {
	const ref = useRef<T | null>(null);
	const [size, setSize] = useState({ w: 0, h: 0 });

	useLayoutEffect(() => {
		const el = ref.current;
		if (!el) return;
		const r = el.getBoundingClientRect();
		setSize({ w: Math.max(1, r.width), h: Math.max(1, r.height) });

		const ro = new ResizeObserver((entries) => {
			const cr = entries[0]?.contentRect;
			if (cr) setSize({ w: Math.max(1, cr.width), h: Math.max(1, cr.height) });
		});
		ro.observe(el);
		return () => ro.disconnect();
	}, []);

	return { ref, ...size };
}

// ----------------------------------------------------------------------------
// Component
// ----------------------------------------------------------------------------
export default function TwoDMap({
	characters,
	entities,
	terrain,
	preview = false,
}: TwoDMapProps) {
	const { actionService } = useActionService();
	const { canAccessActor } = usePeerTracking();
	const context = useQuestContext();
	const {
		selectedActor,
		selectActor,
		toggleActorSelection,
		clearSelection,
		hoveredTile,
		updateHoveredTile,
	} = useMapState();
	const { ref, w } = useMeasuredContainer<HTMLDivElement>();

	// Safety checks
	const W = terrain?.Width ?? 0;
	const L = terrain?.Length ?? 0;

	// Compute tile size from container width, clamped 32..72
	const tileSize = useMemo(() => {
		if (!terrain || W === 0) return 48; // default fallback
		const ideal = Math.floor(w / W);
		return clamp(ideal, 32, 72);
	}, [w, W, terrain]);

	const gridPxW = W * tileSize;
	const gridPxH = L * tileSize;

	// Get selected actor's current position and flying ability
	const selectedActorInfo = useMemo(() => {
		if (!selectedActor || !terrain) return null;

		const actorObj = findActor(
			selectedActor.id,
			selectedActor.kind,
			characters,
			entities
		);

		if (!actorObj) return null;

		return {
			x: actorObj.Position?.x ?? 0,
			y: actorObj.Position?.y ?? 0,
			h: actorObj.Position?.h ?? 0,
			canFly: actorObj.CanFly ?? false,
			moveSpeed: actorObj.MoveSpeed ?? 5
		};
	}, [selectedActor, terrain, characters, entities]);

	// Movement range (only if a controllable selection exists)
	const movementSet = useMemo(() => {
		if (!terrain || !selectedActor || !selectedActorInfo)
			return new Set<string>();
		if (!canAccessActor(selectedActor.id)) return new Set<string>();

		// Get campaign settings for movement costs
		const campaign = CampaignActions.getActiveCampaign(context);
		const { heightCostLookup, flyingIgnoresHeight } =
			campaign.Settings.MovementSettings;

		const { tiles: allTiles } = calculateMovementRange(
			selectedActorInfo.x,
			selectedActorInfo.y,
			selectedActorInfo.h,
			selectedActorInfo.moveSpeed,
			selectedActorInfo.canFly,
			W,
			L,
			terrain.HeightMap,
			heightCostLookup,
			flyingIgnoresHeight
		);

		// Convert to set for quick lookup
		const s = new Set<string>();
		for (const t of allTiles) s.add(`${t.x},${t.y}`);
		return s;
	}, [
		terrain,
		selectedActor,
		selectedActorInfo,
		canAccessActor,
		W,
		L,
		context,
	]);

	// Cycle state for stacked tiles
	const cycleRef = useRef<Map<string, number>>(new Map());

	const handleTileClick = useCallback(
		(x: number, y: number) => {
			if (!terrain || preview) return;

			// Actors at tile (characters first, then entities)
			const hereChars = (characters || []).filter(
				(c) => c.Position?.x === x && c.Position?.y === y
			);
			const hereEnts = (entities || []).filter(
				(e: any) => e.Position?.x === x && e.Position?.y === y
			);

			const actorsHere = [
				...hereChars.map((c) => ({
					id: c.Id,
					kind: "character" as const,
					moveSpeed: c.MoveSpeed ?? 5,
				})),
				...hereEnts.map((e: any) => ({
					id: e.Id,
					kind: "entity" as const,
					moveSpeed: e.MoveSpeed ?? 5,
				})),
			];

			// If there are actors on this tile, cycle selection among them
			if (actorsHere.length > 0) {
				const key = `${x},${y}`;
				const idx = cycleRef.current.get(key) ?? 0;
				const next = actorsHere[idx % actorsHere.length];

				// If only one, toggle selection; if multiple, explicitly select next
				if (actorsHere.length === 1) {
					toggleActorSelection(next);
				} else {
					selectActor(next);
					cycleRef.current.set(key, idx + 1);
				}
				return;
			}

			// Otherwise, attempt a move if we have a selected, authorized actor
			if (!selectedActor || !canAccessActor(selectedActor.id) || !actionService)
				return;

			const actorObj = findActor(
				selectedActor.id,
				selectedActor.kind,
				characters,
				entities
			);
			if (!actorObj) return;

			const currentH = actorObj.Position?.h ?? 0;
			const canFly = actorObj.CanFly ?? false;

			// Use the helper function for target height calculation
			const targetH = calculateTargetHeight(x, y, currentH, canFly, terrain);

			// Check occupancy - item entities can move freely onto occupied tiles
			if (
				!isItemEntity(actorObj) &&
				isTileOccupiedAtHeight(
					x,
					y,
					targetH,
					characters,
					entities,
					selectedActor.id
				)
			) {
				return; // Position is occupied, can't move here
			}

			// Valid move - execute it
			if (selectedActor.kind === "character") {
				actionService.execute("character:move", {
					characterId: selectedActor.id,
					position: { x, y, h: targetH },
				});
			} else {
				actionService.execute("entity:move", {
					entityId: selectedActor.id,
					position: { x, y, h: targetH },
				});
			}

			clearSelection();
		},
		[
			terrain,
			preview,
			characters,
			entities,
			selectedActor,
			canAccessActor,
			actionService,
			toggleActorSelection,
			selectActor,
			clearSelection,
		]
	);

	const handleTileEnter = useCallback(
		(x: number, y: number) => {
			updateHoveredTile({ x, y });
		},
		[updateHoveredTile]
	);

	const handleMouseLeaveGrid = useCallback(() => {
		updateHoveredTile(null);
	}, [updateHoveredTile]);

	// Rendering helpers --------------------------------------------------------
	const renderTile = (x: number, y: number) => {
		if (!terrain) return null;

		const colorIndex = terrain.ColorMap?.[y]?.[x] ?? 6; // Default to grey (index 6)
		const baseColorNum = hexToNum(getTerrainColorByIndex(colorIndex));
		const hVal = terrain.HeightMap?.[y]?.[x] ?? 0;
		const hNorm = normalizeHeight(hVal);
		const tinted = applyElevationTint(baseColorNum, hNorm, ELEV_TOP_STRENGTH);
		const bg = numToCssHex(tinted);

		const isHovered = hoveredTile && hoveredTile.x === x && hoveredTile.y === y;
		const inRange = movementSet.has(`${x},${y}`);

		// Gather actors for stack and badges
		const hereChars = (characters || []).filter(
			(c) => c.Position?.x === x && c.Position?.y === y
		);
		const hereEnts = (entities || []).filter(
			(e: any) => e.Position?.x === x && e.Position?.y === y
		);
		const actorsHere: Array<{
			id: string;
			name?: string;
			img?: string;
			h: number;
		}> = [
				...hereChars.map((c) => ({
					id: c.Id,
					name: c.Name,
					img: c.Image,
					h: c.Position?.h ?? 0,
				})),
				...hereEnts.map((e: any) => ({
					id: e.Id,
					name: e.Name,
					img: e.Image,
					h: e.Position?.h ?? 0,
				})),
			];

		const maxH = actorsHere.reduce((m, a) => Math.max(m, a.h), 0);
		const showAltBadge = maxH > hVal;

		const avatarPx = Math.round(tileSize * 0.62);
		const overlap = Math.round(avatarPx * 0.28);

		// Up to 3 visible
		const visible = actorsHere.slice(0, 3);
		const extraCount = Math.max(0, actorsHere.length - visible.length);

		return (
			<div
				key={`${x},${y}`}
				className="relative"
				style={{
					width: tileSize,
					height: tileSize,
					outline: "2px solid rgba(0,0,0,0.1)",
					backgroundColor: bg,
					cursor: "pointer",
				}}
				onClick={() => handleTileClick(x, y)}
				onMouseEnter={() => handleTileEnter(x, y)}
			>
				{/* Stacked avatars */}
				{visible.length > 0 && (
					<div
						className="absolute left-1 bottom-1 flex items-center"
						style={{ height: avatarPx }}
					>
						{visible.map((a, i) => (
							<div
								key={a.id}
								style={{
									width: avatarPx,
									height: avatarPx,
									marginLeft: i === 0 ? 0 : -overlap,
								}}
								className="rounded-md border border-base-300 shadow-sm overflow-hidden"
							>
								{a.img ? (
									<ImageDisplay
										imageId={a.img}
										alt={a.name}
										title={a.name}
										className="w-full h-full object-cover"
									/>
								) : (
									<div className="w-full h-full bg-base-300 flex justify-center items-center">
										<span className="icon-[solar--mask-sad-bold] w-6 h-6"></span>
									</div>
								)}
							</div>
						))}
						{extraCount > 0 && (
							<div
								style={{
									width: avatarPx,
									height: avatarPx,
									marginLeft: -overlap,
								}}
								className="rounded-md bg-base-300 border border-base-300 grid place-items-center text-xs font-semibold"
							>
								+{extraCount}
							</div>
						)}
					</div>
				)}

				{/* Name label on tile hover */}
				{isHovered && visible.length > 0 && (
					<div
						className="absolute left-1/2 -translate-x-1/2 top-1 pointer-events-none px-1.5 py-0.5 rounded bg-base-100/90 text-[11px] leading-4 border border-base-300 shadow whitespace-nowrap z-50"
						style={{
							maxWidth: "300px",
							overflow: "hidden",
							textOverflow: "ellipsis",
						}}
					>
						{visible.map((v) => v.name || "Unnamed").join(", ")}
						{extraCount > 0 ? ` +${extraCount}` : ""}
					</div>
				)}

				{/* Altitude badge (top-right) */}
				{showAltBadge && (
					<div className="absolute top-0 right-0 m-0.5 px-1 rounded bg-base-100/80 text-[10px] leading-4 border border-base-300">
						h:{maxH}
					</div>
				)}

				{/* Movement / hover overlays */}
				{inRange && (
					<div
						className="absolute inset-0 pointer-events-none"
						style={{
							boxShadow: `inset 0 0 0 2px ${numToCssHex(RANGE_COLOR)}`,
							opacity: 0.5,
						}}
					/>
				)}
				{isHovered && (
					<div
						className="absolute inset-0 pointer-events-none"
						style={{
							boxShadow: `inset 0 0 0 4px ${numToCssHex(HOVER_COLOR)}`,
							opacity: 0.6,
						}}
					/>
				)}
			</div>
		);
	};

	// Render -------------------------------------------------------------------
	if (!terrain || W === 0 || L === 0) {
		return (
			<div
				ref={ref}
				className="h-full w-full overflow-auto bg-base-200 flex items-center justify-center"
			>
				<div className="text-sm opacity-60">No terrain</div>
			</div>
		);
	}

	return (
		<div
			ref={ref}
			className="h-full w-full overflow-auto bg-base-200 select-none"
			onMouseLeave={handleMouseLeaveGrid}
		>
			<div className="min-h-full min-w-full flex items-center justify-center p-4">
				<div style={{ width: gridPxW, height: gridPxH }} className="relative">
					<div
						className="grid"
						style={{
							gridTemplateColumns: `repeat(${W}, ${tileSize}px)`,
							gridAutoRows: `${tileSize}px`,
						}}
					>
						{Array.from({ length: L }).map((_, y) => (
							<>{Array.from({ length: W }).map((__, x) => renderTile(x, y))}</>
						))}
					</div>
				</div>
			</div>
		</div>
	);
}
