// components/Map/2DMap.tsx
// Minimal 2D grid renderer that mirrors Map.tsx props and behaviors

import { useMemo, useRef, useState, useLayoutEffect, useCallback } from "react";
import type { Character } from "../../domains/Character/Character";
import type { Entity } from "../../domains/Entity/Entity";
import type { Terrain } from "../../domains/Terrain/Terrain";
import { TERRAIN_COLORS } from "../../domains/Terrain/Terrain";
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
import { calculateMovementRange, findActor, hexToNum } from "./MapUtilities";

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

	// Compute tile size from container width, clamped 32..80
	const tileSize = useMemo(() => {
		if (!terrain || W === 0) return 48; // default fallback
		const ideal = Math.floor(w / W);
		return clamp(ideal, 32, 72);
	}, [w, W, terrain]);

	const gridPxW = W * tileSize;
	const gridPxH = L * tileSize;

	// Movement range (only if a controllable selection exists)
	const movementSet = useMemo(() => {
		if (!terrain || !selectedActor) return new Set<string>();
		if (!canAccessActor(selectedActor.id)) return new Set<string>();

		const actorObj = findActor(
			selectedActor.id,
			(selectedActor as any).kind,
			characters,
			entities
		);
		const ax = (actorObj as any)?.Position?.x ?? 0;
		const ay = (actorObj as any)?.Position?.y ?? 0;

		const range = calculateMovementRange(ax, ay, selectedActor.moveSpeed, W, L);
		const s = new Set<string>();
		for (const t of range) s.add(`${t.x},${t.y}`);
		return s;
	}, [terrain, selectedActor, canAccessActor, characters, entities, W, L]);

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

			const tileH = terrain.HeightMap?.[y]?.[x] ?? 0;

			const actorObj = findActor(
				selectedActor.id,
				(selectedActor as any).kind,
				characters,
				entities
			) as any;
			if (!actorObj) return;

			const canFly = !!actorObj.CanFly;
			const currentH = actorObj.Position?.h ?? 0;
			const targetH = canFly ? Math.max(tileH, currentH) : tileH;

			if ((selectedActor as any).kind === "character") {
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

		const baseType = (terrain.ColorMap?.[y]?.[x] ??
			"grey") as keyof typeof TERRAIN_COLORS;
		const baseColorNum = hexToNum(TERRAIN_COLORS[baseType]);
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
					outline: "1px solid rgba(0,0,0,0.06)",
					backgroundColor: bg,
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
					<div className="absolute left-1 top-1 pointer-events-none px-1.5 py-0.5 rounded bg-base-100/90 text-[11px] leading-4 border border-base-300 shadow">
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
			className="h-full w-full overflow-auto bg-base-200 flex items-center justify-center select-none"
			onMouseLeave={handleMouseLeaveGrid}
		>
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
	);
}
