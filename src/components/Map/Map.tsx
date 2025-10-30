// Map.tsx - React 19 + @pixi/react v8
// Isometric map orchestrator - delegates rendering to layer components

import {
	useMemo,
	useRef,
	useState,
	useLayoutEffect,
	useCallback,
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
	type Orientation,
	easeInOut,
	buildBaseTiles,
	projectTiles,
	lerpProjections,
	calculateGridBounds,
	centerGridInView,
	lerpCenter,
	screenToTile,
	buildActorHitCandidates,
	screenToActor,
	calculateMovementRange,
	getTileIndex,
} from "./MapUtilities";

import { MapWorldLayer } from "./MapWorldLayer";
import { useActorAnimations } from "./hooks/useActorAnimations";
import {
	useMapRotation,
	useMapPanZoom,
	useMapInteraction,
	useMapSelection,
} from "./hooks";

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
	terrain,
	preview = false,
	allowPanZoom = true,
	showControls = true,
}: MapProps) {
	const { ref, w, h } = useMeasuredContainer<HTMLDivElement>();
	const { startAnimation, getActorPosition } = useActorAnimations();
	const { actionService } = useActionService();
	const dpr = typeof window !== "undefined" ? window.devicePixelRatio : 1;

	// Custom hooks for state management
	const { orientation, animationState, rotateCW, rotateCCW } = useMapRotation();
	const {
		scale,
		pan,
		panRef,
		scaleRef,
		centerRef,
		updateCenter,
		updateBounds,
		handleZoom,
		applyPan,
	} = useMapPanZoom();
	const {
		selectedActor,
		hoveredTile,
		toggleActorSelection,
		clearSelection,
		updateHoveredTile,
	} = useMapSelection();
	const { isPanning, handlers } = useMapInteraction({
		containerRef: ref,
		allowPanZoom,
		onPan: applyPan,
		onZoom: handleZoom,
	});

	// ============================================================================
	// TERRAIN DATA & PROJECTIONS
	// ============================================================================
	const baseTiles = useMemo(
		() => (terrain ? buildBaseTiles(terrain) : []),
		[terrain]
	);

	const fromO = animationState ? animationState.from : orientation;
	const toO = animationState ? animationState.to : orientation;
	const tNorm = animationState ? easeInOut(animationState.t) : 1;

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
						animationState
				  )
				: [],
		[terrain, orientation, animationState, actorPositionsKey]
	);

	// Calculate movement range for selected actor
	const movementRange = useMemo(() => {
		if (!selectedActor || !terrain) return [];

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
		updateBounds(bounds);
		return centerGridInView(bounds, w, h);
	}, [projTo, w, h, updateBounds]);

	const currentCenter = useMemo(
		() => lerpCenter(centerFrom, centerTo, tNorm),
		[centerFrom, centerTo, tNorm]
	);

	// Update center ref when it changes
	updateCenter(currentCenter.cx, currentCenter.cy);

	// ============================================================================
	// POINTER INTERACTION HANDLERS
	// ============================================================================
	const handlePointerMove = useCallback(
		(e: React.PointerEvent<HTMLDivElement>) => {
			if (!ref.current || !terrain || isPanning) return;

			const rect = ref.current.getBoundingClientRect();
			const screenX = e.clientX - rect.left;
			const screenY = e.clientY - rect.top;

			const currentOrientation: Orientation = animationState
				? animationState.to
				: orientation;

			if (!selectedActor) {
				updateHoveredTile(null);
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

			updateHoveredTile(tile);
		},
		[
			terrain,
			isPanning,
			animationState,
			orientation,
			selectedActor,
			updateHoveredTile,
			centerRef,
			panRef,
			scaleRef,
		]
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

			// Handle actor selection/deselection
			if (clickedActor) {
				toggleActorSelection({
					id: clickedActor.id,
					kind: clickedActor.kind,
					moveSpeed: clickedActor.moveSpeed,
				});
				console.log(`Selected ${clickedActor.kind}: ${clickedActor.id}`);
				return;
			}

			// Handle movement on empty tile
			if (hoveredTile && selectedActor && actionService) {
				const tileHeight =
					terrain.HeightMap?.[hoveredTile.y]?.[hoveredTile.x] ?? 0;

				const actor = actorHitCandidates.find((a) => a.id === selectedActor.id);
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

				clearSelection();
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
			toggleActorSelection,
			clearSelection,
			centerRef,
			panRef,
			scaleRef,
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
			{...handlers}
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
							animationState={animationState}
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
					{(animationState ? animationState.to : orientation) * 90}°
				</span>{" "}
				{animationState && (
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