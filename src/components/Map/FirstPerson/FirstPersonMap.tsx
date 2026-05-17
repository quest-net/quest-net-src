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
	canOccupyVoxelTile,
	getVoxelTileHeightKey,
	normalizeVoxelPosition,
} from "../../../utils/VoxelMovementUtilities";
import {
	ACTOR_TOKEN_DESCRIPTOR_DEFAULTS,
} from "../Actors3D/actorTokenConstants";
import { ThreeDActorLayer } from "../Actors3D/ThreeDActorLayer";
import { useActivePings } from "../hooks/useActivePings";
import { useActiveStickers } from "../hooks/useActiveStickers";
import { useLiveActorPoseOverrides } from "../hooks/useLiveActorPoseOverrides";
import { useMapState } from "../MapStateProvider";
import { ThreeDPingLayer } from "../Pings3D/ThreeDPingLayer";
import { ThreeDStickerLayer } from "../Stickers3D/ThreeDStickerLayer";
import {
	findFirstPersonActor,
	getEyeHeight,
} from "./actor";
import {
	createFirstPersonActorColliders,
	createFirstPersonCapsuleState,
	createVoxelCollisionData,
	firstPersonCapsuleToRulesPosition,
	isFirstPersonCapsuleSettled,
	stepFirstPersonCapsuleController,
	type FirstPersonActorCollider,
	type FirstPersonCapsuleState,
	type VoxelCollisionData,
} from "./capsuleController";
import {
	FIRST_PERSON_CAMERA,
	FIRST_PERSON_CONTROLS,
	MOVEMENT_STATE_UPDATE_MS,
} from "./constants";
import { FirstPersonHud, MissingActorMessage } from "./FirstPersonHud";
import {
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
	MovementOverlayState,
} from "./types";
import { useFirstPersonScene } from "./useFirstPersonScene";

const PENDING_MOVE_TIMEOUT_MS = 2000;
const ACTOR_POSE_SEND_INTERVAL_MS = 80;
const ACTOR_POSE_MIN_DISTANCE_SQ = 0.0004;
const EMPTY_FIRST_PERSON_KEYS: ReadonlySet<string> = new Set();

export default function FirstPersonMap({
	terrain,
	characters = [],
	entities = [],
	onExitFirstPerson,
}: FirstPersonMapProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
	const directionalLightRef = useRef<THREE.DirectionalLight | null>(null);
	const capsuleStateRef = useRef<FirstPersonCapsuleState | null>(null);
	const capsuleInitializedRef = useRef(false);
	const cameraPositionInitializedRef = useRef(false);
	const desiredCameraPositionRef = useRef(new THREE.Vector3());
	const yawRef = useRef(0);
	const pitchRef = useRef(0);
	const lastSentKeyRef = useRef("");
	const lastMovementInputAtRef = useRef(0);
	const spaceWasPressedRef = useRef(false);
	const pendingSyncPositionRef = useRef<Position | null>(null);
	// Tracks the last position committed to the DM and when it was sent.
	// Used to suppress rubber-banding: a state sync arriving before the DM
	// has processed our actor move will carry our old position, which
	// would normally teleport us back. We ignore snaps while this is set.
	const lastSentPositionRef = useRef<Position | null>(null);
	const lastSentAtRef = useRef(0);
	const lastPoseSentAtRef = useRef(0);
	const lastPoseSentPositionRef = useRef<THREE.Vector3 | null>(null);
	const hadFirstPersonActorRef = useRef(false);
	const lastStateUpdateRef = useRef(0);
	const activeActorRef = useRef<FirstPersonActor | null>(null);
	const actionServiceRef = useRef<ReturnType<typeof useActionService>["actionService"]>(null);
	const terrainRef = useRef(terrain);
	const voxelCollisionDataRef = useRef<VoxelCollisionData | null>(null);
	const actorCollidersRef = useRef<readonly FirstPersonActorCollider[]>([]);
	const movementCostLookupRef = useRef<Map<string, number> | null>(null);
	const canControlFirstPersonActorRef = useRef(false);
	const isCombatActiveRef = useRef(false);
	const lastPingTimeRef = useRef(0);
	const charactersRef = useRef(characters);
	const entitiesRef = useRef(entities);

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
	const liveActorPoses = useLiveActorPoseOverrides(terrain, characters, entities);
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
	const voxelCollisionData = useMemo(
		() => (terrain ? createVoxelCollisionData(terrain) : null),
		[terrain, terrainSignature]
	);
	const actorCollisionSignature = [
		...characters.map(
			(character) =>
				`c:${character.Id}:${character.Position.x},${character.Position.y},${character.Position.h}:${character.Size ?? ""}:${character.CanFly ? 1 : 0}`
		),
		...entities.map(
			(entity) =>
				`e:${entity.Id}:${entity.Position.x},${entity.Position.y},${entity.Position.h}:${entity.Size ?? ""}:${entity.CanFly ? 1 : 0}:${entity.Tags?.join(",") ?? ""}`
		),
	].join("|");
	const actorColliders = useMemo(
		() =>
			terrain && actor
				? createFirstPersonActorColliders(
						terrain,
						actor,
						characters,
						entities
				  )
				: [],
		[terrain, terrainSignature, actor?.id, actorCollisionSignature]
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
		charactersRef.current = characters;
	}, [characters]);

	useEffect(() => {
		entitiesRef.current = entities;
	}, [entities]);

	useEffect(() => {
		voxelCollisionDataRef.current = voxelCollisionData;
	}, [voxelCollisionData]);

	useEffect(() => {
		actorCollidersRef.current = actorColliders;
	}, [actorColliders]);

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
		capsuleInitializedRef.current = false;
		capsuleStateRef.current = null;
		cameraPositionInitializedRef.current = false;
		pendingSyncPositionRef.current = null;
		lastSentPositionRef.current = null;
		lastPoseSentAtRef.current = 0;
		lastPoseSentPositionRef.current = null;
		spaceWasPressedRef.current = false;
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
		const currentTerrain = terrainRef.current;
		if (
			currentTerrain &&
			!canOccupyVoxelTile(
				currentTerrain,
				normalized,
				charactersRef.current,
				entitiesRef.current,
				currentActor.id
			)
		) {
			return;
		}

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
		lastSentPositionRef.current = normalized;
		lastSentAtRef.current = Date.now();
	}, []);

	const sendCurrentActorPose = useCallback((now: number, position: THREE.Vector3) => {
		const currentActor = activeActorRef.current;
		const currentTerrain = terrainRef.current;
		const service = actionServiceRef.current;
		if (
			!currentActor ||
			!currentTerrain ||
			!service ||
			!canControlFirstPersonActorRef.current
		) {
			return;
		}

		if (now - lastPoseSentAtRef.current < ACTOR_POSE_SEND_INTERVAL_MS) {
			return;
		}

		const lastPosition = lastPoseSentPositionRef.current;
		if (
			lastPosition &&
			lastPosition.distanceToSquared(position) < ACTOR_POSE_MIN_DISTANCE_SQ
		) {
			return;
		}

		service.actorPoseService.sendActorPose({
			actorId: currentActor.id,
			terrainId: currentTerrain.Id,
			position: [position.x, position.y, position.z],
		});
		lastPoseSentAtRef.current = now;
		if (lastPosition) {
			lastPosition.copy(position);
		} else {
			lastPoseSentPositionRef.current = position.clone();
		}
	}, []);

	const flushPendingPosition = useCallback(() => {
		const pending = pendingSyncPositionRef.current;
		if (!pending) return;
		commitActorPosition(pending);
		pendingSyncPositionRef.current = null;
	}, [commitActorPosition]);

	const commitCurrentPosition = useCallback(() => {
		const currentActor = activeActorRef.current;
		const state = capsuleStateRef.current;
		if (
			currentActor &&
			state &&
			isFirstPersonCapsuleSettled(state, currentActor.actor.CanFly ?? false)
		) {
			flushPendingPosition();
		}
		spaceWasPressedRef.current = false;
	}, [flushPendingPosition]);

	const updateCameraFromBody = useCallback(
		(
			dt: number,
			positionSmoothing: number = FIRST_PERSON_CAMERA.POSITION_SMOOTHING
		) => {
			const camera = cameraRef.current;
			const currentActor = activeActorRef.current;
			const state = capsuleStateRef.current;
			if (!camera || !currentActor || !state) return;

			desiredCameraPositionRef.current.set(
				state.position.x,
				state.position.y + getEyeHeight(currentActor.actor),
				state.position.z
			);
			if (!cameraPositionInitializedRef.current) {
				camera.position.copy(desiredCameraPositionRef.current);
				cameraPositionInitializedRef.current = true;
			} else if (dt > 0) {
				const alpha = 1 - Math.exp(-positionSmoothing * dt);
				camera.position.lerp(desiredCameraPositionRef.current, alpha);
				if (
					camera.position.distanceToSquared(desiredCameraPositionRef.current) <
					0.000001
				) {
					camera.position.copy(desiredCameraPositionRef.current);
				}
			}
			camera.rotation.order = "YXZ";
			camera.rotation.y = yawRef.current;
			camera.rotation.x = pitchRef.current;
		},
		[]
	);

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
			const collision = voxelCollisionDataRef.current;
			let cameraSmoothing: number = FIRST_PERSON_CAMERA.POSITION_SMOOTHING;
			if (currentTerrain && currentActor) {
				const lastSent = lastSentPositionRef.current;
				if (lastSent) {
					const authoritative = normalizeVoxelPosition(currentActor.actor.Position);
					const confirmed =
						authoritative.x === lastSent.x &&
						authoritative.y === lastSent.y &&
						authoritative.h === lastSent.h;
					const timedOut =
						Date.now() - lastSentAtRef.current >= PENDING_MOVE_TIMEOUT_MS;
					if (confirmed || timedOut) {
						lastSentPositionRef.current = null;
						if (timedOut && !confirmed && !pendingSyncPositionRef.current) {
							capsuleStateRef.current = createFirstPersonCapsuleState(
								currentActor,
								currentTerrain
							);
							capsuleInitializedRef.current = true;
							cameraSmoothing = FIRST_PERSON_CAMERA.ACTIVE_POSITION_SMOOTHING;
						}
					}
				}
			}

			if (
				currentTerrain &&
				collision &&
				currentActor &&
				canControlFirstPersonActorRef.current
			) {
				if (!capsuleStateRef.current) {
					capsuleStateRef.current = createFirstPersonCapsuleState(
						currentActor,
						currentTerrain
					);
					capsuleInitializedRef.current = true;
				}

				const keys = input.pointerLocked ? input.keys : EMPTY_FIRST_PERSON_KEYS;
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
				let jumpPressed = false;
				if (!currentActor.actor.CanFly) {
					const spacePressed = keys.has("Space");
					jumpPressed = spacePressed && !spaceWasPressedRef.current;
					spaceWasPressedRef.current = spacePressed;
				} else {
					spaceWasPressedRef.current = false;
				}

				const state = capsuleStateRef.current;
				const wasPosition = state.position.clone();
				const wasSettled = isFirstPersonCapsuleSettled(
					state,
					currentActor.actor.CanFly ?? false
				);
				const shouldSimulate =
					input.pointerLocked ||
					hasInput ||
					jumpPressed ||
					!wasSettled ||
					pendingSyncPositionRef.current !== null;
				if (shouldSimulate) {
					cameraSmoothing = FIRST_PERSON_CAMERA.ACTIVE_POSITION_SMOOTHING;
					stepFirstPersonCapsuleController(
						currentTerrain,
						collision,
						currentActor,
						state,
						{
							forwardInput,
							rightInput,
							verticalInput,
							jumpPressed,
							yaw: yawRef.current,
							dt,
						},
						actorCollidersRef.current
					);

					const rulesPosition = firstPersonCapsuleToRulesPosition(
						currentTerrain,
						state
					);
					const settled = isFirstPersonCapsuleSettled(
						state,
						currentActor.actor.CanFly ?? false
					);
					const moved =
						wasPosition.distanceToSquared(state.position) > 0.000001;
					if (moved || hasInput || jumpPressed || !settled) {
						lastMovementInputAtRef.current = now;
					}
					if (moved) {
						sendCurrentActorPose(now, state.position);
					}
					if (moved || pendingSyncPositionRef.current) {
						updateMovementOverlay(now, rulesPosition);
						pendingSyncPositionRef.current = rulesPosition;
					}
					if (
						settled &&
						!hasInput &&
						!jumpPressed &&
						pendingSyncPositionRef.current &&
						now - lastMovementInputAtRef.current >=
							FIRST_PERSON_CONTROLS.SYNC_IDLE_DEBOUNCE_MS
					) {
						flushPendingPosition();
					}
				}
			}

			updateCameraFromBody(dt, cameraSmoothing);
		},
		[
			flushPendingPosition,
			sendCurrentActorPose,
			updateCameraFromBody,
			updateMovementOverlay,
		]
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
		capsuleInitializedRef.current = false;
		capsuleStateRef.current = null;
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
		const authoritativeState = createFirstPersonCapsuleState(actor, terrain);
		const authoritativeRules = firstPersonCapsuleToRulesPosition(
			terrain,
			authoritativeState
		);
		if (!capsuleStateRef.current || !capsuleInitializedRef.current) {
			capsuleStateRef.current = authoritativeState;
			capsuleInitializedRef.current = true;
		}
		const currentRules = firstPersonCapsuleToRulesPosition(
			terrain,
			capsuleStateRef.current
		);
		const sameTile =
			capsuleInitializedRef.current &&
			currentRules.x === authoritativeRules.x &&
			currentRules.y === authoritativeRules.y &&
			currentRules.h === authoritativeRules.h;

		// If the DM's authoritative position matches the last one we sent (confirmed),
		// or the send is old enough that we shouldn't wait any longer, clear the
		// in-flight record so normal DM corrections can snap us again.
		const lastSent = lastSentPositionRef.current;
		if (lastSent) {
			const confirmed =
				authoritative.x === lastSent.x &&
				authoritative.y === lastSent.y &&
				authoritative.h === lastSent.h;
			const timedOut = Date.now() - lastSentAtRef.current >= PENDING_MOVE_TIMEOUT_MS;
			if (confirmed || timedOut) {
				lastSentPositionRef.current = null;
			}
		}

		if (!sameTile) {
			// Suppress the snap while we have unsent local movement OR an
			// in-flight actor move that the DM hasn't confirmed yet.
			// Without this, any unrelated DM action that broadcasts state
			// before our move is processed will carry our old position and
			// rubber-band us back.
			const hasPendingMove =
				pendingSyncPositionRef.current !== null ||
				lastSentPositionRef.current !== null;
			if (!hasPendingMove) {
				capsuleStateRef.current = authoritativeState;
				capsuleInitializedRef.current = true;
				pendingSyncPositionRef.current = null;
			}
		}

		if (cameraRef.current) {
			const direction = new THREE.Vector3();
			cameraRef.current.getWorldDirection(direction);
			if (direction.lengthSq() > 0) {
				yawRef.current = Math.atan2(-direction.x, -direction.z);
			}
		}
		updateCameraFromBody(0);
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
						liveActorPoses={liveActorPoses}
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
