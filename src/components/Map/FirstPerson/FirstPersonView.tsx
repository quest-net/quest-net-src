// components/Map/FirstPerson/FirstPersonView.tsx
//
// First-person logic for the shared map scene. Unlike the old FirstPersonMap,
// this does NOT create its own renderer/scene/terrain -- MapScene owns the
// persistent scene and the actor/sticker/ping layers. This component plugs the
// capsule simulation, pointer-look, and position commits into the shared
// MapModeController (which owns the first-person camera + input), and renders
// only the first-person HUD / missing-actor message.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { Position } from "../../../domains/Actor/Actor";
import type { VoxelTerrain } from "../../../domains/VoxelTerrain/VoxelTerrain";
import { CampaignUtils } from "../../../domains/Campaign/CampaignUtils";
import { useQuestContext } from "../../../domains/Context/ContextProvider";
import { usePeerTracking } from "../../../hooks/usePeerTracking";
import { useActionService } from "../../../services/Actions/ActionServiceProvider";
import { shouldRestrictPlayerMovementToRange } from "../../../domains/VoxelTerrain/VoxelMovementUtilities";
import { roundVoxelPosition } from "../../../domains/VoxelTerrain/VoxelTerrainQueries";
import { ACTOR_TOKEN_DESCRIPTOR_DEFAULTS } from "../Actors3D/actorTokenConstants";
import { useMapState } from "../MapStateProvider";
import {
	actorPositionToGroundWorld,
	findFirstPersonActor,
	getEyeHeight,
} from "./actor";
import {
	applyRangeContainment,
	createFirstPersonCapsuleState,
	firstPersonCapsuleToRulesPosition,
	isFirstPersonCapsuleSettled,
	stepFirstPersonCapsuleController,
	type FirstPersonCapsuleState,
} from "./capsuleController";
import {
	tileKey,
	tileHeightKey,
	type VoxelTerrainIndex,
} from "../../../utils/terrain/data/VoxelTerrainIndex";
import {
	FIRST_PERSON_CAMERA,
	FIRST_PERSON_CONTROLS,
	MOVEMENT_STATE_UPDATE_MS,
} from "./constants";
import { FirstPersonHud, MissingActorMessage } from "./FirstPersonHud";
import { createMovementCostLookup } from "./movement";
import type { TerrainLinkInteractionFocus } from "../TerrainLinks3D/ThreeDTerrainLinkLayer";
import type {
	FirstPersonActor,
	FirstPersonFrameInput,
	MovementOverlayState,
} from "./types";
import type { MapModeController } from "../MapModeController";

const PENDING_MOVE_TIMEOUT_MS = 2000;
const ACTOR_POSE_SEND_INTERVAL_MS = 80;
const ACTOR_POSE_MIN_DISTANCE_SQ = 0.0004;
// While a settled-but-uncommitted position exists (commit in flight, or the
// capsule can't settle, e.g. holding a key against a wall), resend the last
// pose at this interval so observers' ACTOR_POSE_TIMEOUT_MS never reverts the
// token to a stale authoritative tile. The gate closes as soon as the DM
// confirms the move, so steady-state traffic cost is zero.
const ACTOR_POSE_HEARTBEAT_MS = 300;
const EMPTY_FIRST_PERSON_KEYS: ReadonlySet<string> = new Set();
const MOVEMENT_OVERAGE_EPSILON = 0.0001;

interface FirstPersonViewProps {
	controller: MapModeController;
	terrain: VoxelTerrain | null;
	terrainIndex: VoxelTerrainIndex | null;
	onExitFirstPerson?: () => void;
	onLiveRulesPositionChange?: (position: Position | null) => void;
	linkFocus?: TerrainLinkInteractionFocus | null;
}

function getActorMoveSpeed(actor: FirstPersonActor): number {
	return actor.actor.MoveSpeed ?? ACTOR_TOKEN_DESCRIPTOR_DEFAULTS.MOVE_SPEED;
}

function getMovementCostFromLookup(
	lookup: Map<string, number>,
	index: VoxelTerrainIndex,
	position: Position
): number | undefined {
	const exact = lookup.get(
		tileHeightKey(position.x, position.y, position.h)
	);
	if (exact !== undefined) return exact;

	const surfaces = index.allSurfaces.get(tileKey(position.x, position.y)) ?? [];
	let bestCost: number | undefined;
	let bestDistance = Number.POSITIVE_INFINITY;
	for (const surface of surfaces) {
		const cost = lookup.get(tileHeightKey(position.x, position.y, surface));
		if (cost === undefined) continue;

		const distance = Math.abs(position.h - surface);
		if (
			distance < bestDistance ||
			(distance === bestDistance &&
				(bestCost === undefined || cost < bestCost))
		) {
			bestCost = cost;
			bestDistance = distance;
		}
	}

	return bestCost;
}

export default function FirstPersonView({
	controller,
	terrain,
	terrainIndex,
	onExitFirstPerson,
	onLiveRulesPositionChange,
	linkFocus,
}: FirstPersonViewProps) {
	// The first-person camera is owned by the shared controller; mirror it into a
	// ref so the existing camera-from-body code reads it unchanged.
	const cameraRef = useRef<THREE.PerspectiveCamera>(controller.firstPersonCamera);
	useEffect(() => {
		cameraRef.current = controller.firstPersonCamera;
	}, [controller]);

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
	const onLiveRulesPositionChangeRef = useRef(onLiveRulesPositionChange);
	// Tracks the last position committed to the DM and when it was sent.
	// Used to suppress rubber-banding (see the original FirstPersonMap notes).
	const lastSentPositionRef = useRef<Position | null>(null);
	const lastSentAtRef = useRef(0);
	const lastPoseSentAtRef = useRef(0);
	const lastPoseSentPositionRef = useRef<THREE.Vector3 | null>(null);

	useEffect(() => {
		onLiveRulesPositionChangeRef.current = onLiveRulesPositionChange;
	}, [onLiveRulesPositionChange]);

	useEffect(
		() => () => {
			onLiveRulesPositionChangeRef.current?.(null);
		},
		[]
	);
	const hadFirstPersonActorRef = useRef(false);
	const lastStateUpdateRef = useRef(0);
	const activeActorRef = useRef<FirstPersonActor | null>(null);
	const actionServiceRef = useRef<ReturnType<typeof useActionService>["actionService"]>(null);
	const terrainRef = useRef(terrain);
	const voxelTerrainIndexRef = useRef<VoxelTerrainIndex | null>(null);
	const movementCostLookupRef = useRef<Map<string, number> | null>(null);
	const canControlFirstPersonActorRef = useRef(false);
	const isCombatActiveRef = useRef(false);
	const restrictMovementToRangeRef = useRef(false);
	const turnStartWorldRef = useRef<THREE.Vector3 | null>(null);

	// Identity that determines when the first-person sim must reset: which terrain
	// and its extents, deliberately excluding voxel content. A content edit (e.g.
	// a synced DM voxel change) must NOT reset the capsule -- that would yank a
	// walking player back to their last-synced tile. The per-frame capsule sim
	// already re-collides against the updated terrain index, so geometry changes
	// are handled without a reset. A terrain switch or resize still resets.
	const terrainFramingKey = useMemo(
		() =>
			terrain
				? `${terrain.Id}:${terrain.Width}:${terrain.Length}:${terrain.Height}:${
						terrain.Resolution ?? 1
				  }`
				: "",
		[terrain]
	);
	const context = useQuestContext();
	const { actionService } = useActionService();
	const { canAccessActor } = usePeerTracking();
	const { selectActor } = useMapState();
	const [movementOverlay, setMovementOverlay] =
		useState<MovementOverlayState>(null);
	const [isPointerLocked, setIsPointerLocked] = useState(
		controller.isPointerLocked
	);
	const campaign = CampaignUtils.getActiveCampaign(context);
	const userRole = context.User.Role === "dm" ? "dm" : "player";
	const actor = useMemo(
		() =>
			findFirstPersonActor(
				userRole,
				campaign.RoomCode,
				context.User.SelectedCharacters,
				context.User.ImpersonatedActors,
				campaign.GameState.Characters,
				campaign.GameState.Entities
			),
		[
			userRole,
			campaign.RoomCode,
			context.User.SelectedCharacters,
			context.User.ImpersonatedActors,
			campaign.GameState.Characters,
			campaign.GameState.Entities,
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
	const actorOnTerrain =
		!!terrain && !!actor && actor.actor.Position.terrainId === terrain.Id;
	const voxelTerrainIndex = terrainIndex;
	const restrictMovementToRange =
		shouldRestrictPlayerMovementToRange(
			context.User.Role,
			isCombatActive,
			campaign.Settings.MovementSettings
		);

	const movementCostLookup = useMemo(() => {
		if (!terrain || !actor || !actorOnTerrain || !canControlFirstPersonActor) return null;
		return createMovementCostLookup(
			terrain,
			actor,
			isCombatActive,
			campaign.Settings.MovementSettings
		);
	}, [
		terrain,
		actor?.id,
		actorOnTerrain,
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
		voxelTerrainIndexRef.current = voxelTerrainIndex;
	}, [voxelTerrainIndex]);

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
		restrictMovementToRangeRef.current = restrictMovementToRange;
	}, [restrictMovementToRange]);

	// World-space ground position of the turn-start cell -- the point the soft
	// range boundary pulls the body back toward.
	useEffect(() => {
		const turnStart = actor?.actor.TurnStartPosition;
		if (!terrain || !actor || !actorOnTerrain || !turnStart) {
			turnStartWorldRef.current = null;
			return;
		}
		turnStartWorldRef.current = actorPositionToGroundWorld(actor, terrain, turnStart);
	}, [terrain, actor, actorOnTerrain, actorTurnStartX, actorTurnStartY, actorTurnStartH]);

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
	}, [actor?.id, actor?.kind, terrainFramingKey]);

	useEffect(() => {
		if (!actor) return;
		selectActor({
			id: actor.id,
			kind: actor.kind,
			moveSpeed: actor.actor.MoveSpeed ?? ACTOR_TOKEN_DESCRIPTOR_DEFAULTS.MOVE_SPEED,
		});
	}, [actor?.id, actor?.kind, actor?.actor.MoveSpeed, selectActor]);

	// Commits the settled rules position to the DM. Occupancy is deliberately
	// NOT validated here (nor on the DM): the capsule already physically stands
	// on the tile, so rejecting the commit only splits the visual position from
	// the rules position. Two actors settling on one tile is tolerated -- they
	// resolve it by walking apart. Returns true when the move was sent (or is a
	// duplicate of the last sent move); false means "couldn't send, keep the
	// pending position so the flush retries".
	const commitActorPosition = useCallback((position: Position): boolean => {
		const currentActor = activeActorRef.current;
		const service = actionServiceRef.current;
		if (!currentActor || !service || !canControlFirstPersonActorRef.current) {
			return false;
		}

		const normalized = roundVoxelPosition(position);
		const key = `${currentActor.kind}:${currentActor.id}:${normalized.x},${normalized.y},${normalized.h}`;
		if (lastSentKeyRef.current === key) {
			return true;
		}

		service.execute("actor:move", {
			actorId: currentActor.id,
			position: normalized,
		});
		lastSentKeyRef.current = key;
		lastSentPositionRef.current = normalized;
		lastSentAtRef.current = Date.now();
		return true;
	}, []);

	// force=true bypasses the min-distance gate (heartbeat resends of a
	// stationary pose); the rate gate still applies.
	const sendCurrentActorPose = useCallback((
		now: number,
		position: THREE.Vector3,
		force = false
	) => {
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
			!force &&
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
		if (commitActorPosition(pending)) {
			pendingSyncPositionRef.current = null;
		}
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
		const activeActor = activeActorRef.current;
		const index = voxelTerrainIndexRef.current;
		const lookup = movementCostLookupRef.current;
		if (!activeActor || !index || !lookup) {
			setMovementOverlay((current) => (current === null ? current : null));
			return;
		}

		if (now - lastStateUpdateRef.current < MOVEMENT_STATE_UPDATE_MS) return;
		lastStateUpdateRef.current = now;

		const moveSpeed = getActorMoveSpeed(activeActor);
		const cost = getMovementCostFromLookup(lookup, index, rulesPosition);
		if (cost === undefined) {
			// The actor has walked past the capped movement lookup (see
			// getMovementLookupBudget) or onto a tile with no traced path from the
			// anchor, so we can't compute an exact overage. Keep the HUD up with an
			// "a lot" indicator rather than hiding it.
			const next: MovementOverlayState = isCombatActiveRef.current
				? { kind: "combat", value: 0, overageUnbounded: true }
				: { kind: "exploration", value: 0, overageUnbounded: true };
			setMovementOverlay((current) =>
				current?.kind === next.kind && current?.overageUnbounded === true
					? current
					: next
			);
			return;
		}

		const overage = Math.max(0, cost - moveSpeed);
		const visibleOverage =
			overage > MOVEMENT_OVERAGE_EPSILON ? overage : undefined;
		const next: MovementOverlayState =
			isCombatActiveRef.current
				? {
						kind: "combat",
						value: Math.max(0, moveSpeed - cost),
						overage: visibleOverage,
				  }
				: {
						kind: "exploration",
						value: visibleOverage === undefined ? cost : moveSpeed,
						overage: visibleOverage,
				  };
		setMovementOverlay((current) =>
			current?.kind === next.kind &&
			current?.value === next.value &&
			(current?.overage ?? 0) === (next.overage ?? 0) &&
			(current?.overageUnbounded ?? false) === (next.overageUnbounded ?? false)
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
			const index = voxelTerrainIndexRef.current;
			const actorOnCurrentTerrain =
				!!currentTerrain &&
				!!currentActor &&
				currentActor.actor.Position.terrainId === currentTerrain.Id;
			let cameraSmoothing: number = FIRST_PERSON_CAMERA.POSITION_SMOOTHING;
			if (currentTerrain && currentActor && actorOnCurrentTerrain) {
				const lastSent = lastSentPositionRef.current;
				if (lastSent) {
					const authoritative = roundVoxelPosition(currentActor.actor.Position);
					const confirmed =
						authoritative.x === lastSent.x &&
						authoritative.y === lastSent.y &&
						authoritative.h === lastSent.h;
					const timedOut =
						Date.now() - lastSentAtRef.current >= PENDING_MOVE_TIMEOUT_MS;
					if (confirmed || timedOut) {
						lastSentPositionRef.current = null;
						if (timedOut && !confirmed && !pendingSyncPositionRef.current) {
							// The commit never landed; clear the dedup key so re-walking
							// to the same tile can commit again.
							lastSentKeyRef.current = "";
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
				index &&
				currentActor &&
				actorOnCurrentTerrain &&
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
						index,
						currentActor,
						state,
						{
							forwardInput,
							rightInput,
							verticalInput,
							jumpPressed,
							yaw: yawRef.current,
							dt,
						}
					);

					let rulesPosition = firstPersonCapsuleToRulesPosition(
						currentTerrain,
						state,
						index,
						currentActor.actor.CanFly ?? false
					);

					// Soft movement-range boundary: when the body has strayed past its
					// allowed range, nudge it back toward the turn-start position
					// instead of rejecting the move. Done before the settled check so
					// the imposed inward drift keeps it from settling/committing out of
					// range -- it can only come to rest (and commit) once back inside.
					if (restrictMovementToRangeRef.current) {
						const lookup = movementCostLookupRef.current;
						const target = turnStartWorldRef.current;
						if (lookup && target) {
							const moveSpeed = getActorMoveSpeed(currentActor);
							const cost = getMovementCostFromLookup(
								lookup,
								index,
								rulesPosition
							);
							const outOfRange =
								cost === undefined ||
								cost > moveSpeed + MOVEMENT_OVERAGE_EPSILON;
							if (outOfRange) {
								applyRangeContainment(
									state,
									target.x,
									target.y,
									target.z,
									currentActor.actor.CanFly ?? false
								);
								rulesPosition = firstPersonCapsuleToRulesPosition(
									currentTerrain,
									state,
									index,
									currentActor.actor.CanFly ?? false
								);
							}
						}
					}
					onLiveRulesPositionChangeRef.current?.(rulesPosition);

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

			// Heartbeat: while a position is uncommitted (pending settle-debounce,
			// commit in flight, or a capsule that can't settle, e.g. pushing against
			// a wall), keep the pose alive on observers so their pose timeout never
			// reverts the token to the stale authoritative tile. Stops as soon as
			// the commit is confirmed, so it adds no steady-state traffic.
			{
				const state = capsuleStateRef.current;
				if (
					state &&
					actorOnCurrentTerrain &&
					canControlFirstPersonActorRef.current &&
					(pendingSyncPositionRef.current !== null ||
						lastSentPositionRef.current !== null) &&
					now - lastPoseSentAtRef.current >= ACTOR_POSE_HEARTBEAT_MS
				) {
					sendCurrentActorPose(now, state.position, true);
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

	// Plug the capsule sim / look / commit handlers into the shared controller.
	useEffect(() => {
		controller.setFirstPersonHandlers({
			onFrame: handleFrame,
			onLookDelta: handleLookDelta,
			onControlReleased: commitCurrentPosition,
		});
		return () => controller.setFirstPersonHandlers(null);
	}, [controller, handleFrame, handleLookDelta, commitCurrentPosition]);

	// Mirror the controller's pointer-lock state for the HUD.
	useEffect(() => {
		setIsPointerLocked(controller.isPointerLocked);
		controller.setPointerLockListener(setIsPointerLocked);
		return () => controller.setPointerLockListener(null);
	}, [controller]);

	// Commit any pending position when leaving first-person (unmount). The
	// controller exits pointer lock itself, but our handlers are unregistered
	// before its setViewMode('world') runs, so flush here directly. Unlike the
	// settled-gated control-release path, this flush is unconditional: exiting
	// mid-air/mid-slide should commit the last rules position (already
	// surface-clamped for walkers) rather than silently roll the token back.
	const flushPendingPositionRef = useRef(flushPendingPosition);
	useEffect(() => {
		flushPendingPositionRef.current = flushPendingPosition;
	}, [flushPendingPosition]);
	useEffect(
		() => () => {
			flushPendingPositionRef.current();
		},
		[]
	);

	useEffect(() => {
		if (actor) {
			hadFirstPersonActorRef.current = true;
			return;
		}

		pendingSyncPositionRef.current = null;
		capsuleInitializedRef.current = false;
		capsuleStateRef.current = null;
		onLiveRulesPositionChangeRef.current?.(null);
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
		if (!terrain || !actor || !actorOnTerrain) {
			onLiveRulesPositionChangeRef.current?.(null);
			setMovementOverlay((current) => (current === null ? current : null));
			return;
		}

		const authoritative = roundVoxelPosition(actor.actor.Position);
		const authoritativeState = createFirstPersonCapsuleState(actor, terrain);
		const authoritativeRules = firstPersonCapsuleToRulesPosition(
			terrain,
			authoritativeState,
			voxelTerrainIndex,
			actor.actor.CanFly ?? false
		);
		if (!capsuleStateRef.current || !capsuleInitializedRef.current) {
			capsuleStateRef.current = authoritativeState;
			capsuleInitializedRef.current = true;
		}
		const currentRules = firstPersonCapsuleToRulesPosition(
			terrain,
			capsuleStateRef.current,
			voxelTerrainIndex,
			actor.actor.CanFly ?? false
		);
		onLiveRulesPositionChangeRef.current?.(currentRules);
		const sameTile =
			capsuleInitializedRef.current &&
			currentRules.x === authoritativeRules.x &&
			currentRules.y === authoritativeRules.y &&
			currentRules.h === authoritativeRules.h;

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
			const hasPendingMove =
				pendingSyncPositionRef.current !== null ||
				lastSentPositionRef.current !== null;
			if (!hasPendingMove) {
				capsuleStateRef.current = authoritativeState;
				capsuleInitializedRef.current = true;
				pendingSyncPositionRef.current = null;
				// The actor was moved authoritatively from elsewhere (DM drag,
				// terrain:moveActors, repairActors). Clear the dedup key so walking
				// back to the previously committed tile isn't silently suppressed.
				lastSentKeyRef.current = "";
			}
		}

		const camera = cameraRef.current;
		if (camera) {
			const direction = new THREE.Vector3();
			camera.getWorldDirection(direction);
			if (direction.lengthSq() > 0) {
				yawRef.current = Math.atan2(-direction.x, -direction.z);
			}
		}
		updateCameraFromBody(0);
	}, [
		terrain,
		actor?.id,
		actor?.kind,
		actorOnTerrain,
		actorPositionX,
		actorPositionY,
		actorPositionH,
		updateCameraFromBody,
	]);

	return (
		<>
			{!actor && (
				<div className="absolute inset-0 z-30">
					<MissingActorMessage onExitFirstPerson={onExitFirstPerson} />
				</div>
			)}
			{actor && (
				<FirstPersonHud
					isPointerLocked={isPointerLocked}
					movementOverlay={movementOverlay}
					canFly={actor.actor.CanFly ?? false}
					onExitFirstPerson={onExitFirstPerson}
					linkFocus={linkFocus}
				/>
			)}
		</>
	);
}
