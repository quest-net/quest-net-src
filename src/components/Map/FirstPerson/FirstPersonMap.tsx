import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { Position } from "../../../domains/Actor/Actor";
import { CampaignActions } from "../../../domains/Campaign/CampaignActions";
import { useQuestContext } from "../../../domains/Context/ContextProvider";
import { PING_DURATION_MS } from "../../../domains/Ping/Ping";
import { usePeerTracking } from "../../../hooks/usePeerTracking";
import { useActionService } from "../../../services/Actions/ActionServiceProvider";
import { getVoxelCount } from "../../../utils/VoxelDataUtils";
import {
	getVoxelTileHeightKey,
	normalizeVoxelPosition,
} from "../../../utils/VoxelMovementUtilities";
import {
	ACTOR_TOKEN_DESCRIPTOR_DEFAULTS,
} from "../Actors3D/actorTokenConstants";
import { ThreeDActorLayer } from "../Actors3D/ThreeDActorLayer";
import { useActivePings } from "../hooks/useActivePings";
import { useActiveStickers } from "../hooks/useActiveStickers";
import { useMapState } from "../MapStateProvider";
import { ThreeDPingLayer } from "../Pings3D/ThreeDPingLayer";
import { ThreeDStickerLayer } from "../Stickers3D/ThreeDStickerLayer";
import {
	actorToGroundWorld,
	findFirstPersonActor,
	getEyeHeight,
	getFirstPersonBodyHeight,
	worldToRulesPosition,
} from "./actor";
import {
	createVoxelCollisionData,
	resolveFirstPersonMovement,
	type VoxelCollisionData,
} from "./collision";
import {
	FIRST_PERSON_CAMERA,
	FIRST_PERSON_CONTROLS,
	MOVEMENT_STATE_UPDATE_MS,
} from "./constants";
import { FirstPersonHud, MissingActorMessage } from "./FirstPersonHud";
import {
	createColumnLookup,
	createFirstPersonMovementTiles,
	createMovementCostLookup,
} from "./movement";
import {
	createTerrainSignature,
	useFirstPersonTerrain,
} from "./terrain";
import type {
	FirstPersonActor,
	FirstPersonFrameInput,
	FirstPersonMapProps,
	LegalTile,
	MovementOverlayState,
} from "./types";
import { useFirstPersonScene } from "./useFirstPersonScene";

export default function FirstPersonMap({
	terrain,
	characters = [],
	entities = [],
	onExitFirstPerson,
}: FirstPersonMapProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
	const directionalLightRef = useRef<THREE.DirectionalLight | null>(null);
	const bodyPositionRef = useRef(new THREE.Vector3());
	const bodyHRef = useRef(0);
	const bodyInitializedRef = useRef(false);
	const yawRef = useRef(0);
	const pitchRef = useRef(0);
	const lastSentKeyRef = useRef("");
	const lastMovementInputAtRef = useRef(0);
	const pendingSyncPositionRef = useRef<Position | null>(null);
	const hadFirstPersonActorRef = useRef(false);
	const lastStateUpdateRef = useRef(0);
	const activeActorRef = useRef<FirstPersonActor | null>(null);
	const actionServiceRef = useRef<ReturnType<typeof useActionService>["actionService"]>(null);
	const terrainRef = useRef(terrain);
	const voxelCollisionDataRef = useRef<VoxelCollisionData | null>(null);
	const movementColumnLookupRef = useRef(new Map<string, LegalTile[]>());
	const movementCostLookupRef = useRef<Map<string, number> | null>(null);
	const canControlFirstPersonActorRef = useRef(false);
	const isCombatActiveRef = useRef(false);
	const lastPingTimeRef = useRef(0);

	const terrainSignature = useMemo(
		() => createTerrainSignature(terrain),
		[terrain]
	);
	const context = useQuestContext();
	const { actionService } = useActionService();
	const { canAccessActor } = usePeerTracking();
	const {
		selectedActor,
		selectActor,
		toggleActorSelection,
	} = useMapState();
	const [movementOverlay, setMovementOverlay] =
		useState<MovementOverlayState>(null);
	const activeStickers = useActiveStickers();
	const { pings: activePings } = useActivePings();
	const campaign = CampaignActions.getActiveCampaign(context);
	const imageService = (actionService as any)?.imageService ?? null;
	const userRole = context.User.Role === "dm" ? "dm" : "player";
	const isDM = userRole === "dm";
	const actor = useMemo(
		() =>
			findFirstPersonActor(
				userRole,
				campaign.RoomCode,
				context.User.SelectedCharacters,
				context.User.ImpersonatedActors,
				characters,
				entities
			),
		[
			userRole,
			campaign.RoomCode,
			context.User.SelectedCharacters,
			context.User.ImpersonatedActors,
			characters,
			entities,
		]
	);
	const actorPositionX = actor?.actor.Position.x;
	const actorPositionY = actor?.actor.Position.y;
	const actorPositionH = actor?.actor.Position.h;
	const actorTurnStartX = actor?.actor.TurnStartPosition?.x;
	const actorTurnStartY = actor?.actor.TurnStartPosition?.y;
	const actorTurnStartH = actor?.actor.TurnStartPosition?.h;
	const isCombatActive = campaign.GameState.CombatState?.isActive ?? false;
	const canControlFirstPersonActor = actor ? canAccessActor(actor.id) : false;
	const restrictMovementToRange =
		userRole === "player" &&
		(campaign.Settings.MovementSettings?.restrictPlayerMovementToRange ?? false);

	const voxelCollisionData = useMemo(
		() => (terrain ? createVoxelCollisionData(terrain) : null),
		[terrain, terrainSignature]
	);

	const movementTiles = useMemo(() => {
		if (!terrain || !actor || !canControlFirstPersonActor) return [];

		return createFirstPersonMovementTiles({
			terrain,
			actor,
			characters,
			entities,
			isCombatActive,
			restrictMovementToRange,
			movementSettings: campaign.Settings.MovementSettings,
		});
	}, [
		terrain,
		actor?.id,
		canControlFirstPersonActor,
		isCombatActive,
		restrictMovementToRange,
		campaign.Settings.MovementSettings,
		actorPositionX,
		actorPositionY,
		actorPositionH,
		actorTurnStartX,
		actorTurnStartY,
		actorTurnStartH,
		actor?.actor.MoveSpeed,
		actor?.actor.CanFly,
		characters,
		entities,
	]);
	const movementColumnLookup = useMemo(
		() => createColumnLookup(movementTiles),
		[movementTiles]
	);
	const movementCostLookup = useMemo(() => {
		if (!terrain || !actor || !canControlFirstPersonActor) return null;
		return createMovementCostLookup(
			terrain,
			actor,
			isCombatActive,
			campaign.Settings.MovementSettings
		);
	}, [
		terrain,
		actor?.id,
		canControlFirstPersonActor,
		isCombatActive,
		campaign.Settings.MovementSettings,
		actorPositionX,
		actorPositionY,
		actorPositionH,
		actorTurnStartX,
		actorTurnStartY,
		actorTurnStartH,
		actor?.actor.MoveSpeed,
		actor?.actor.CanFly,
	]);
	const cutoutImageIds = useMemo(() => {
		const ids = new Set<string>();
		for (const image of campaign.Images ?? []) {
			if (image.Cutout) ids.add(image.Id);
		}
		return ids;
	}, [campaign]);
	const visibleCharacters = useMemo(
		() =>
			actor?.kind === "character"
				? characters.filter((character) => character.Id !== actor.id)
				: characters,
		[actor?.id, actor?.kind, characters]
	);
	const visibleEntities = useMemo(
		() =>
			actor?.kind === "entity"
				? entities.filter((entity) => entity.Id !== actor.id)
				: entities,
		[actor?.id, actor?.kind, entities]
	);
	const pingActiveActorId =
		context.User.Role === "player"
			? context.User.SelectedCharacters?.[campaign.RoomCode]
			: (context.User.ImpersonatedActors ?? {})[campaign.RoomCode];

	useEffect(() => {
		activeActorRef.current = actor;
	}, [actor]);

	useEffect(() => {
		actionServiceRef.current = actionService;
	}, [actionService]);

	useEffect(() => {
		terrainRef.current = terrain;
	}, [terrain]);

	useEffect(() => {
		voxelCollisionDataRef.current = voxelCollisionData;
	}, [voxelCollisionData]);

	useEffect(() => {
		movementColumnLookupRef.current = movementColumnLookup;
	}, [movementColumnLookup]);

	useEffect(() => {
		movementCostLookupRef.current = movementCostLookup;
	}, [movementCostLookup]);

	useEffect(() => {
		canControlFirstPersonActorRef.current = canControlFirstPersonActor;
	}, [canControlFirstPersonActor]);

	useEffect(() => {
		isCombatActiveRef.current = isCombatActive;
	}, [isCombatActive]);

	useEffect(() => {
		lastSentKeyRef.current = "";
		bodyInitializedRef.current = false;
		pendingSyncPositionRef.current = null;
	}, [actor?.id, actor?.kind, terrainSignature]);

	useEffect(() => {
		if (!actor) return;
		selectActor({
			id: actor.id,
			kind: actor.kind,
			moveSpeed: actor.actor.MoveSpeed ?? ACTOR_TOKEN_DESCRIPTOR_DEFAULTS.MOVE_SPEED,
		});
	}, [actor?.id, actor?.kind, actor?.actor.MoveSpeed, selectActor]);

	const commitActorPosition = useCallback((position: Position) => {
		const currentActor = activeActorRef.current;
		const service = actionServiceRef.current;
		if (!currentActor || !service || !canControlFirstPersonActorRef.current) {
			return;
		}

		const normalized = normalizeVoxelPosition(position);
		const key = `${currentActor.kind}:${currentActor.id}:${normalized.x},${normalized.y},${normalized.h}`;
		if (lastSentKeyRef.current === key) {
			return;
		}

		if (currentActor.kind === "character") {
			service.execute("character:move", {
				characterId: currentActor.id,
				position: normalized,
			});
		} else {
			service.execute("entity:move", {
				entityId: currentActor.id,
				position: normalized,
			});
		}
		lastSentKeyRef.current = key;
	}, []);

	const flushPendingPosition = useCallback(() => {
		const pending = pendingSyncPositionRef.current;
		if (!pending) return;
		commitActorPosition(pending);
		pendingSyncPositionRef.current = null;
	}, [commitActorPosition]);

	const commitCurrentPosition = useCallback(() => {
		flushPendingPosition();
	}, [flushPendingPosition]);

	const updateCameraFromBody = useCallback(() => {
		const camera = cameraRef.current;
		const currentActor = activeActorRef.current;
		if (!camera || !currentActor) return;

		camera.position.set(
			bodyPositionRef.current.x,
			bodyPositionRef.current.y + getEyeHeight(currentActor.actor),
			bodyPositionRef.current.z
		);
		camera.rotation.order = "YXZ";
		camera.rotation.y = yawRef.current;
		camera.rotation.x = pitchRef.current;
	}, []);

	const updateMovementOverlay = useCallback((now: number, rulesPosition: Position) => {
		if (!activeActorRef.current) {
			setMovementOverlay((current) => (current === null ? current : null));
			return;
		}

		if (now - lastStateUpdateRef.current < MOVEMENT_STATE_UPDATE_MS) return;
		lastStateUpdateRef.current = now;

		const currentActor = activeActorRef.current.actor;
		const lookup = movementCostLookupRef.current;
		const cost = lookup?.get(
			getVoxelTileHeightKey(rulesPosition.x, rulesPosition.y, rulesPosition.h)
		);
		const next: MovementOverlayState =
			cost === undefined
				? null
				: isCombatActiveRef.current
					? {
							kind: "combat",
							value:
								(currentActor.MoveSpeed ??
									ACTOR_TOKEN_DESCRIPTOR_DEFAULTS.MOVE_SPEED) - cost,
					  }
					: {
							kind: "exploration",
							value: cost,
					  };
		setMovementOverlay((current) =>
			current?.kind === next?.kind && current?.value === next?.value
				? current
				: next
		);
	}, []);

	const handleLookDelta = useCallback((movementX: number, movementY: number) => {
		yawRef.current -= movementX * FIRST_PERSON_CONTROLS.MOUSE_SENSITIVITY;
		pitchRef.current = THREE.MathUtils.clamp(
			pitchRef.current - movementY * FIRST_PERSON_CONTROLS.MOUSE_SENSITIVITY,
			-FIRST_PERSON_CAMERA.PITCH_LIMIT,
			FIRST_PERSON_CAMERA.PITCH_LIMIT
		);
	}, []);

	const handleFrame = useCallback(
		(now: number, dt: number, input: FirstPersonFrameInput) => {
			const currentTerrain = terrainRef.current;
			const currentActor = activeActorRef.current;
			if (
				currentTerrain &&
				currentActor &&
				canControlFirstPersonActorRef.current &&
				input.pointerLocked
			) {
				const keys = input.keys;
				const forwardInput =
					(keys.has("KeyW") ? 1 : 0) - (keys.has("KeyS") ? 1 : 0);
				const rightInput =
					(keys.has("KeyD") ? 1 : 0) - (keys.has("KeyA") ? 1 : 0);
				const verticalInput =
					currentActor.actor.CanFly
						? (keys.has("Space") ? 1 : 0) -
						  (keys.has("ShiftLeft") || keys.has("ShiftRight") ? 1 : 0)
						: 0;
				const hasInput =
					forwardInput !== 0 || rightInput !== 0 || verticalInput !== 0;

				if (hasInput) {
					const forward = new THREE.Vector3(
						-Math.sin(yawRef.current),
						0,
						-Math.cos(yawRef.current)
					);
					const right = new THREE.Vector3(
						Math.cos(yawRef.current),
						0,
						-Math.sin(yawRef.current)
					);
					const move = forward
						.multiplyScalar(forwardInput)
						.add(right.multiplyScalar(rightInput));
					if (move.lengthSq() > 0) {
						move
							.normalize()
							.multiplyScalar(
								FIRST_PERSON_CONTROLS.MOVE_UNITS_PER_SECOND * dt
							);
					}

					const candidate = bodyPositionRef.current.clone().add(move);
					const candidateH =
						bodyHRef.current +
						verticalInput * FIRST_PERSON_CONTROLS.FLY_UNITS_PER_SECOND * dt;
					const resolvedMovement = resolveFirstPersonMovement(
						currentTerrain,
						voxelCollisionDataRef.current,
						currentActor,
						bodyPositionRef.current,
						bodyHRef.current,
						candidate,
						candidateH,
						movementColumnLookupRef.current
					);

					if (resolvedMovement) {
						bodyPositionRef.current.copy(resolvedMovement.bodyPosition);
						bodyHRef.current = resolvedMovement.bodyH;
						const rulesPosition = worldToRulesPosition(
							currentTerrain,
							bodyPositionRef.current,
							bodyHRef.current
						);
						updateMovementOverlay(now, rulesPosition);
						lastMovementInputAtRef.current = now;
						pendingSyncPositionRef.current = rulesPosition;
					}
				}

				if (
					!hasInput &&
					pendingSyncPositionRef.current &&
					now - lastMovementInputAtRef.current >=
						FIRST_PERSON_CONTROLS.SYNC_IDLE_DEBOUNCE_MS
				) {
					flushPendingPosition();
				}
			}

			updateCameraFromBody();
		},
		[flushPendingPosition, updateCameraFromBody, updateMovementOverlay]
	);

	const { sceneResources, isPointerLocked } = useFirstPersonScene(
		containerRef,
		{
			onFrame: handleFrame,
			onLookDelta: handleLookDelta,
			onControlReleased: commitCurrentPosition,
		},
		cameraRef,
		directionalLightRef
	);

	useFirstPersonTerrain(
		sceneResources,
		terrain,
		terrainSignature,
		directionalLightRef
	);

	useEffect(() => {
		if (actor) {
			hadFirstPersonActorRef.current = true;
			return;
		}

		pendingSyncPositionRef.current = null;
		bodyInitializedRef.current = false;
		setMovementOverlay((current) => (current === null ? current : null));

		if (isPointerLocked && document.pointerLockElement) {
			document.exitPointerLock();
		}

		if (hadFirstPersonActorRef.current) {
			hadFirstPersonActorRef.current = false;
			onExitFirstPerson?.();
		}
	}, [actor, isPointerLocked, onExitFirstPerson]);

	useEffect(() => {
		if (!terrain || !actor) return;

		const authoritative = normalizeVoxelPosition(actor.actor.Position);
		const expectedBodyH = getFirstPersonBodyHeight(
			actor,
			terrain,
			authoritative
		);
		const currentRules = worldToRulesPosition(
			terrain,
			bodyPositionRef.current,
			bodyHRef.current
		);
		const sameTile =
			bodyInitializedRef.current &&
			currentRules.x === authoritative.x &&
			currentRules.y === authoritative.y &&
			currentRules.h === Math.round(expectedBodyH);

		if (!sameTile) {
			bodyPositionRef.current.copy(actorToGroundWorld(actor, terrain));
			bodyHRef.current = expectedBodyH;
			bodyInitializedRef.current = true;
			pendingSyncPositionRef.current = null;
		}

		if (cameraRef.current) {
			const direction = new THREE.Vector3();
			cameraRef.current.getWorldDirection(direction);
			if (direction.lengthSq() > 0) {
				yawRef.current = Math.atan2(-direction.x, -direction.z);
			}
		}
		updateCameraFromBody();
	}, [
		terrain,
		actor?.id,
		actor?.kind,
		actorPositionX,
		actorPositionY,
		actorPositionH,
		updateCameraFromBody,
	]);

	const handleActorClick = useCallback(
		(clicked: { id: string; kind: "character" | "entity"; moveSpeed: number }) => {
			toggleActorSelection(clicked);
		},
		[toggleActorSelection]
	);

	const handleActorSelect = useCallback(
		(clicked: { id: string; kind: "character" | "entity"; moveSpeed: number }) => {
			selectActor(clicked);
		},
		[selectActor]
	);

	const handlePingTile = useCallback(
		(tile: { x: number; y: number }) => {
			if (!actionService) return;
			const now = Date.now();
			if (now - lastPingTimeRef.current < PING_DURATION_MS) return;

			actionService.execute("ping:create", {
				x: tile.x,
				y: tile.y,
				actorId: pingActiveActorId,
			});
			lastPingTimeRef.current = now;
		},
		[actionService, pingActiveActorId]
	);

	return (
		<div className="relative w-full h-full">
			<div ref={containerRef} className="w-full h-full" />
			{!actor && (
				<div className="absolute inset-0 z-30">
					<MissingActorMessage onExitFirstPerson={onExitFirstPerson} />
				</div>
			)}
			{actor && (
				<FirstPersonHud
					isPointerLocked={isPointerLocked}
					movementOverlay={movementOverlay}
					onExitFirstPerson={onExitFirstPerson}
				/>
			)}
			{actor && sceneResources && terrain && getVoxelCount(terrain.Voxels) > 0 && (
				<>
					<ThreeDActorLayer
						resources={sceneResources}
						characters={visibleCharacters}
						entities={visibleEntities}
						cutoutImageIds={cutoutImageIds}
						selectedActor={selectedActor}
						terrain={terrain}
						isDM={isDM}
						imageService={imageService}
						onActorClick={handleActorClick}
						onActorSelect={handleActorSelect}
					/>
					<ThreeDStickerLayer
						resources={sceneResources}
						terrain={terrain}
						characters={visibleCharacters}
						entities={visibleEntities}
						cutoutImageIds={cutoutImageIds}
						activeStickers={activeStickers}
					/>
					<ThreeDPingLayer
						resources={sceneResources}
						terrain={terrain}
						activePings={activePings}
						onPingTile={handlePingTile}
					/>
				</>
			)}
		</div>
	);
}
