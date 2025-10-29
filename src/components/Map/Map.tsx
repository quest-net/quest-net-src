// Map.tsx - React 19 + @pixi/react v8
// Isometric map orchestrator - delegates rendering to layer components

import {
	useMemo,
	useRef,
	useState,
	useLayoutEffect,
	useCallback,
	useEffect,
} from "react";
import { Application, extend } from "@pixi/react";
import {
	Container as PixiContainer,
	Graphics as PixiGraphics,
	Sprite as PixiSprites,
	Text as PixiText,
} from "pixi.js";
import { useActionService } from "../../services/Actions/ActionServiceProvider";

extend({
	Container: PixiContainer,
	Graphics: PixiGraphics,
	Sprite: PixiSprites,
	Text: PixiText,
});

import type { Character } from "../../domains/Character/Character";
import type { Entity } from "../../domains/Entity/Entity";
import type { CombatState } from "../../domains/GameState/GameState";
import type { Scene } from "../../domains/Scene/Scene";
import type { Terrain } from "../../domains/Terrain/Terrain";

import {
	MIN_SCALE,
	MAX_SCALE,
	type Orientation,
	type AnimationState,
	type GridBounds,
	easeInOut,
	buildBaseTiles,
	projectTiles,
	lerpProjections,
	calculateGridBounds,
	centerGridInView,
	lerpCenter,
	clampPan,
	screenToTile,
	buildActorHitCandidates,
	screenToActor,
	calculateMovementRange,
	getTileIndex,
} from "./MapUtilities";

import { MapWorldLayer } from "./MapWorldLayer";
import { useActorAnimations } from "./useActorAnimations";

interface MapProps {
	characters: Character[];
	entities: Entity[];
	combatState?: CombatState;
	scene?: Scene;
	terrain?: Terrain | null;
	preview?: boolean; // disables actor selection/movement + actionService calls
	allowPanZoom?: boolean; // enable wheel + middle/right drag
	showControls?: boolean; // rotate buttons + HUD
}

const PAN_PADDING = 500;

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

export default function Map({
	characters,
	entities,
	scene,
	terrain,
	preview = false,
	allowPanZoom = true,
	showControls = true,
}: MapProps) {
	const { ref, w, h } = useMeasuredContainer<HTMLDivElement>();
	const { startAnimation, getActorPosition, hasActiveAnimations } =
		useActorAnimations();
	const { actionService } = useActionService();
	const dpr = typeof window !== "undefined" ? window.devicePixelRatio : 1;

	// Actor selection state
	const [selectedActor, setSelectedActor] = useState<{
		id: string;
		kind: "character" | "entity";
		moveSpeed: number;
	} | null>(null);

	// ============================================================================
	// ROTATION STATE & ANIMATION
	// ============================================================================
	const [orientation, setOrientation] = useState<Orientation>(0);
	const [anim, setAnim] = useState<AnimationState | null>(null);
	const DURATION = 180;

	const startRotate = (dir: 1 | -1) => {
		const now = performance.now();
		let base = orientation;
		if (anim) base = anim.t < 0.5 ? anim.from : anim.to;
		const to = ((base + (dir === 1 ? 1 : 3)) & 3) as Orientation;
		setOrientation(base);
		setAnim({ from: base, to, t: 0, start: now });
	};

	const rotateCW = () => startRotate(1);
	const rotateCCW = () => startRotate(-1);

	useEffect(() => {
		if (!anim) return;
		let raf = 0;
		const loop = () => {
			const t = Math.min(1, (performance.now() - anim.start) / DURATION);
			setAnim((prev) => (prev ? { ...prev, t } : null));
			if (t < 1) {
				raf = requestAnimationFrame(loop);
			} else {
				setOrientation(anim.to);
				setAnim(null);
			}
		};
		raf = requestAnimationFrame(loop);
		return () => cancelAnimationFrame(raf);
	}, [anim?.start]);

	// ============================================================================
	// PAN & ZOOM STATE
	// ============================================================================
	const [scale, setScale] = useState(1);
	const [pan, setPan] = useState({ x: 0, y: 0 });
	const panRef = useRef(pan);
	const scaleRef = useRef(scale);
	const centerRef = useRef({ x: 0, y: 0 });
	const boundsRef = useRef<GridBounds | null>(null);
	panRef.current = pan;
	scaleRef.current = scale;

	const [isPanning, setIsPanning] = useState(false);
	const dragStart = useRef<{ x: number; y: number } | null>(null);

	// ============================================================================
	// TILE SELECTION STATE
	// ============================================================================
	const [hoveredTile, setHoveredTile] = useState<{
		x: number;
		y: number;
	} | null>(null);

	// ============================================================================
	// TERRAIN DATA & PROJECTIONS
	// ============================================================================
	const baseTiles = useMemo(
		() => (terrain ? buildBaseTiles(terrain) : []),
		[terrain]
	);

	const fromO = anim ? anim.from : orientation;
	const toO = anim ? anim.to : orientation;
	const tNorm = anim ? easeInOut(anim.t) : 1;

	const projFrom = useMemo(
		() =>
			!terrain || baseTiles.length === 0
				? []
				: projectTiles(baseTiles, terrain.Width, terrain.Length, fromO),
		[baseTiles, terrain, fromO]
	);

	const projTo = useMemo(
		() =>
			!terrain || baseTiles.length === 0
				? []
				: projectTiles(baseTiles, terrain.Width, terrain.Length, toO),
		[baseTiles, terrain, toO]
	);

	const currentProjections = useMemo(
		() =>
			projFrom.length === 0 || projTo.length === 0
				? []
				: lerpProjections(projFrom, projTo, tNorm),
		[projFrom, projTo, tNorm]
	);

	const actorPositionsKey =
		characters
			.map(
				(c) =>
					`${c.Id}:${c.Position?.x ?? 0},${c.Position?.y ?? 0},${
						c.Position?.h ?? 0
					}`
			)
			.join("|") +
		"|" +
		entities
			.map(
				(e: any) =>
					`${e.Id}:${e.Position?.x ?? 0},${e.Position?.y ?? 0},${
						e.Position?.h ?? 0
					}`
			)
			.join("|");

	const actorHitCandidates = useMemo(
		() =>
			terrain
				? buildActorHitCandidates(
						characters,
						entities,
						terrain,
						orientation,
						anim
				  )
				: [],
		[terrain, orientation, anim, actorPositionsKey]
	);

	// Calculate movement range for selected actor
	const movementRange = useMemo(() => {
		if (!selectedActor || !terrain) return [];

		// Find the actor to get its current position
		const actor = actorHitCandidates.find((a) => a.id === selectedActor.id);
		if (!actor) return [];

		return calculateMovementRange(
			actor.x,
			actor.y,
			selectedActor.moveSpeed,
			terrain.Width,
			terrain.Length
		);
	}, [selectedActor, actorHitCandidates, terrain]);

	// ============================================================================
	// CENTERING & BOUNDS
	// ============================================================================
	const centerFrom = useMemo(
		() =>
			projFrom.length === 0
				? { cx: w / 2, cy: h / 2 }
				: centerGridInView(calculateGridBounds(projFrom), w, h),
		[projFrom, w, h]
	);

	const centerTo = useMemo(() => {
		if (projTo.length === 0) return { cx: w / 2, cy: h / 2 };
		const bounds = calculateGridBounds(projTo);
		boundsRef.current = bounds;
		return centerGridInView(bounds, w, h);
	}, [projTo, w, h]);

	const currentCenter = useMemo(
		() => lerpCenter(centerFrom, centerTo, tNorm),
		[centerFrom, centerTo, tNorm]
	);

	centerRef.current = { x: currentCenter.cx, y: currentCenter.cy };

	// ============================================================================
	// INTERACTION HANDLERS
	// ============================================================================
	const onWheel = useCallback(
		(e: WheelEvent) => {
			if (!allowPanZoom) return;
			if (!ref.current || !boundsRef.current) return;
			e.preventDefault(); // Now this will work!
			const zoomIntensity = 0.0015;
			const zoom = Math.exp(-e.deltaY * zoomIntensity);
			const newScaleUnclamped = scaleRef.current * zoom;
			const newScale = Math.max(
				MIN_SCALE,
				Math.min(MAX_SCALE, newScaleUnclamped)
			);
			const actual = newScale / scaleRef.current;
			if (actual === 1) return;

			const rect = ref.current.getBoundingClientRect();
			const mx = e.clientX - rect.left;
			const my = e.clientY - rect.top;

			const cx = centerRef.current.x;
			const cy = centerRef.current.y;
			const worldX = (mx - (cx + panRef.current.x)) / scaleRef.current;
			const worldY = (my - (cy + panRef.current.y)) / scaleRef.current;
			const nextPanX = mx - cx - worldX * newScale;
			const nextPanY = my - cy - worldY * newScale;

			const clampedPan = clampPan(
				{ x: nextPanX, y: nextPanY },
				centerRef.current,
				boundsRef.current,
				newScale,
				rect.width,
				rect.height,
				PAN_PADDING
			);

			setScale(newScale);
			setPan(clampedPan);
		},
		[allowPanZoom]
	);

	// Add this useEffect to attach the wheel listener with passive: false
	useEffect(() => {
		const element = ref.current;
		if (!element) return;

		// Attach with passive: false to allow preventDefault
		element.addEventListener("wheel", onWheel, { passive: false });

		return () => {
			element.removeEventListener("wheel", onWheel);
		};
	}, [onWheel]);

	const onMouseDown = useCallback(
		(e: React.MouseEvent<HTMLDivElement>) => {
			if (!allowPanZoom) return;
			if (e.button !== 1 && e.button !== 2) return;
			e.preventDefault();
			setIsPanning(true);
			dragStart.current = { x: e.clientX, y: e.clientY };
		},
		[allowPanZoom]
	);

	const onMouseMove = useCallback(
		(e: React.MouseEvent<HTMLDivElement>) => {
			if (!isPanning || !dragStart.current || !boundsRef.current) return;
			const dx = e.clientX - dragStart.current.x;
			const dy = e.clientY - dragStart.current.y;
			dragStart.current = { x: e.clientX, y: e.clientY };
			setPan((p) =>
				clampPan(
					{ x: p.x + dx, y: p.y + dy },
					centerRef.current,
					boundsRef.current!,
					scaleRef.current,
					w,
					h,
					PAN_PADDING
				)
			);
		},
		[isPanning, w, h]
	);

	const endPan = useCallback(() => {
		setIsPanning(false);
		dragStart.current = null;
	}, []);

	const handlePointerMove = useCallback(
		(e: React.PointerEvent<HTMLDivElement>) => {
			if (!ref.current || !terrain || isPanning) return;

			const rect = ref.current.getBoundingClientRect();
			const screenX = e.clientX - rect.left;
			const screenY = e.clientY - rect.top;

			const currentOrientation: Orientation = anim ? anim.to : orientation;
			if (!selectedActor) {
				setHoveredTile(null);
				return;
			}
			const tile = screenToTile(
				screenX,
				screenY,
				centerRef.current.x,
				centerRef.current.y,
				panRef.current.x,
				panRef.current.y,
				scaleRef.current,
				terrain.Width,
				terrain.Length,
				currentOrientation,
				terrain.HeightMap
			);

			setHoveredTile(tile);
		},
		[terrain, isPanning, anim, orientation, selectedActor]
	);

	const handlePointerDown = useCallback(
		(e: React.MouseEvent<HTMLDivElement>) => {
			if (preview) return;
			if (e.button !== 0 || !terrain || !ref.current) return;

			const rect = ref.current.getBoundingClientRect();
			const screenX = e.clientX - rect.left;
			const screenY = e.clientY - rect.top;

			const clickedActor = screenToActor(
				screenX,
				screenY,
				centerRef.current.x,
				centerRef.current.y,
				panRef.current.x,
				panRef.current.y,
				scaleRef.current,
				actorHitCandidates
			);

			// NEW: clicking the currently selected token unselects it
			if (clickedActor) {
				if (selectedActor && selectedActor.id === clickedActor.id) {
					setSelectedActor(null);
					return;
				}
				setSelectedActor({
					id: clickedActor.id,
					kind: clickedActor.kind,
					moveSpeed: clickedActor.moveSpeed,
				});
				console.log(`Selected ${clickedActor.kind}: ${clickedActor.id}`);
				return;
			}

			// existing move-on-empty-tile logic
			if (hoveredTile) {
				if (selectedActor && actionService) {
					const tileHeight =
						terrain.HeightMap?.[hoveredTile.y]?.[hoveredTile.x] ?? 0;

					const actor = actorHitCandidates.find(
						(a) => a.id === selectedActor.id
					);
					if (actor) {
						startAnimation(
							selectedActor.id,
							{ x: actor.x, y: actor.y, h: actor.h },
							{ x: hoveredTile.x, y: hoveredTile.y, h: tileHeight }
						);
					}

					if (selectedActor.kind === "character") {
						actionService.execute("character:move", {
							characterId: selectedActor.id,
							position: { x: hoveredTile.x, y: hoveredTile.y, h: tileHeight },
						});
					} else {
						actionService.execute("entity:move", {
							entityId: selectedActor.id,
							position: { x: hoveredTile.x, y: hoveredTile.y, h: tileHeight },
						});
					}

					setSelectedActor(null);
				}
			}
		},
		[
			preview,
			hoveredTile,
			terrain,
			selectedActor,
			actionService,
			actorHitCandidates,
			startAnimation,
		]
	);

	// ============================================================================
	// RENDER
	// ============================================================================
	const ready = w > 0 && h > 0;
	const cursorClass = isPanning ? "cursor-grabbing" : "cursor-default";
	// Build fast lookup sets for highlighting inside terrain paint
	const movementRangeIndices = useMemo(() => {
		if (!terrain || movementRange.length === 0) return new Set<number>();
		const set = new Set<number>();
		for (const t of movementRange)
			set.add(getTileIndex(t.x, t.y, terrain.Width));
		return set;
	}, [terrain, movementRange]);

	const hoveredIndex = useMemo(() => {
		if (!terrain || !hoveredTile) return null;
		return getTileIndex(hoveredTile.x, hoveredTile.y, terrain.Width);
	}, [terrain, hoveredTile]);
	return (
		<div
			ref={ref}
			className={`relative h-full w-full bg-base-200 overflow-hidden select-none ${cursorClass}`}
			onMouseDown={onMouseDown}
			onMouseMove={onMouseMove}
			onMouseUp={endPan}
			onMouseLeave={endPan}
			onPointerMove={handlePointerMove}
			onPointerDown={handlePointerDown}
			onContextMenu={(e) => e.preventDefault()}
		>
			{ready && (
				<Application
					resizeTo={ref}
					antialias
					autoDensity
					resolution={dpr}
					backgroundAlpha={0}
				>
					<pixiContainer
						x={currentCenter.cx + pan.x}
						y={currentCenter.cy + pan.y}
						scale={{ x: scale, y: scale }}
					>
						<MapWorldLayer
							terrain={terrain}
							baseTiles={baseTiles}
							currentProjections={currentProjections}
							orientation={orientation}
							animationState={anim}
							characters={characters}
							entities={entities}
							selectedActorId={selectedActor?.id}
							getActorPosition={getActorPosition}
							movementRangeIndices={movementRangeIndices}
							hoveredIndex={hoveredIndex}
						/>
					</pixiContainer>
				</Application>
			)}
			{showControls && (
				<>
					{/* UI Overlay */}
					<div className="absolute left-3 top-3 z-10 flex gap-2">
						<button
							type="button"
							className="btn btn-lg rounded-md bg-base-100 shadow hover:bg-base-300"
							onClick={rotateCCW}
							title="Rotate 90 degrees counter-clockwise"
						>
							⟳
						</button>
						<button
							type="button"
							className="btn btn-lg rounded-md bg-base-100 shadow hover:bg-base-300"
							onClick={rotateCW}
							title="Rotate 90 degrees clockwise"
						>
							⟲
						</button>
					</div>
				</>
			)}

			<div className="pointer-events-none absolute right-3 bottom-3 rounded-xl bg-base-100/70 px-2 py-1 text-[11px] shadow">
				<span className="opacity-70">Terrain:</span>{" "}
				<span className="font-mono">{terrain?.Name ?? "-"}</span>{" "}
				<span className="opacity-70">| Rot:</span>{" "}
				<span className="font-mono">
					{(anim ? anim.to : orientation) * 90}°
				</span>{" "}
				{anim && (
					<span className="opacity-60">({Math.round(tNorm * 100)}%)</span>
				)}
				{hoveredTile && (
					<>
						{" "}
						<span className="opacity-70">| Hover:</span>{" "}
						<span className="font-mono">
							({hoveredTile.x}, {hoveredTile.y})
						</span>
					</>
				)}
			</div>
		</div>
	);
}
