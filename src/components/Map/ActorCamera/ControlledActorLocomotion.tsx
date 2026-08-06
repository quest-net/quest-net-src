// components/Map/ActorCamera/ControlledActorLocomotion.tsx
//
// Camera-independent controlled-actor locomotion for the shared map scene.
// It owns the capsule, movement rules, live pose sync, and settled commits used
// by both First Person and Follow. MapModeController owns camera placement/look
// and supplies camera-relative movement yaw. This component stays mounted while
// switching between those two modes and renders their shared movement HUD.

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
	actorToGroundWorld,
	findControlledActor,
	getEyeHeight,
} from "./actor";
import {
	applyRangeContainment,
	createActorCapsuleState,
	actorCapsuleToRulesPosition,
	isActorCapsulePositionFree,
	isActorCapsuleSettled,
	stepActorCapsuleController,
	type ActorCapsuleState,
} from "./capsuleController";
import {
	tileKey,
	tileHeightKey,
	type VoxelTerrainIndex,
} from "../../../utils/terrain/data/VoxelTerrainIndex";
import {
	FIRST_PERSON_CAMERA,
	ACTOR_CONTROLS,
	MOVEMENT_STATE_UPDATE_MS,
} from "./constants";
import { ActorCameraHud, MissingActorMessage } from "./ActorCameraHud";
import { createMovementCostLookup } from "./movement";
import type { TerrainLinkInteractionFocus } from "../TerrainLinks3D/ThreeDTerrainLinkLayer";
import type {
	LocomotionActor,
	ActorLocomotionFrameInput,
	MovementOverlayState,
} from "./types";
import type { MapModeController } from "../MapModeController";
import type { ActorCameraMode } from "../../../utils/camera/CameraModes";

const PENDING_MOVE_TIMEOUT_MS = 2000;
const ACTOR_POSE_SEND_INTERVAL_MS = 80;
const ACTOR_POSE_MIN_DISTANCE_SQ = 0.0004;
// While a settled-but-uncommitted position exists (commit in flight, or the
// capsule can't settle, e.g. holding a key against a wall), resend the last
// pose at this interval so observers' ACTOR_POSE_TIMEOUT_MS never reverts the
// token to a stale authoritative tile. The gate closes as soon as the DM
// confirms the move, so steady-state traffic cost is zero.
const ACTOR_POSE_HEARTBEAT_MS = 300;
const EMPTY_ACTOR_CONTROL_KEYS: ReadonlySet<string> = new Set();
const MOVEMENT_OVERAGE_EPSILON = 0.0001;

interface ControlledActorLocomotionProps {
	controller: MapModeController;
	cameraMode: ActorCameraMode;
	terrain: VoxelTerrain | null;
	terrainIndex: VoxelTerrainIndex | null;
	onUnavailable?: () => void;
	onLiveRulesPositionChange?: (position: Position | null) => void;
	linkFocus?: TerrainLinkInteractionFocus | null;
}

function getActorMoveSpeed(actor: LocomotionActor): number {
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

export default function ControlledActorLocomotion({
	controller,
	cameraMode,
	terrain,
	terrainIndex,
	onUnavailable,
	onLiveRulesPositionChange,
	linkFocus,
}: ControlledActorLocomotionProps) {
	const cameraModeRef = useRef(cameraMode);
	cameraModeRef.current = cameraMode;

	const capsuleStateRef = useRef<ActorCapsuleState | null>(null);
	const capsuleInitializedRef = useRef(false);
	const lastSentKeyRef = useRef("");
	const lastMovementInputAtRef = useRef(0);
	const spaceWasPressedRef = useRef(false);
	const pendingSyncPositionRef = useRef<Position | null>(null);
	const onLiveRulesPositionChangeRef = useRef(onLiveRulesPositionChange);
	// Tracks the last position committed to the DM and when it was sent, so an
	// authoritative echo of our own move does not rubber-band the body back.
	const lastSentPositionRef = useRef<Position | null>(null);
	const lastSentAtRef = useRef(0);
	const lastPoseSentAtRef = useRef(0);
	const lastPoseSentPositionRef = useRef<THREE.Vector3 | null>(null);
	// Last frame's driveFollowVisual, so the follow re-anchor in handleFrame
	// fires on the take-over edge only.
	const ownedFollowVisualRef = useRef(false);

	useEffect(() => {
		onLiveRulesPositionChangeRef.current = onLiveRulesPositionChange;
	}, [onLiveRulesPositionChange]);

	useEffect(
		() => () => {
			onLiveRulesPositionChangeRef.current?.(null);
		},
		[]
	);
	const hadControlledActorRef = useRef(false);
	const lastStateUpdateRef = useRef(0);
	const activeActorRef = useRef<LocomotionActor | null>(null);
	const actionServiceRef = useRef<ReturnType<typeof useActionService>["actionService"]>(null);
	const terrainRef = useRef(terrain);
	const voxelTerrainIndexRef = useRef<VoxelTerrainIndex | null>(null);
	const movementCostLookupRef = useRef<Map<string, number> | null>(null);
	const canControlActorRef = useRef(false);
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
			findControlledActor(
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
	const canControlLocomotionActor = actor ? canAccessActor(actor.id) : false;
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
		if (!terrain || !actor || !actorOnTerrain || !canControlLocomotionActor) return null;
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
		canControlLocomotionActor,
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
		canControlActorRef.current = canControlLocomotionActor;
	}, [canControlLocomotionActor]);

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
		// Clearing the pose also disarms eye-camera smoothing, so the new actor /
		// terrain is snapped to rather than glided toward.
		controller.setControlledActorPose(null);
		pendingSyncPositionRef.current = null;
		lastSentPositionRef.current = null;
		lastPoseSentAtRef.current = 0;
		lastPoseSentPositionRef.current = null;
		spaceWasPressedRef.current = false;
		ownedFollowVisualRef.current = false;
	}, [actor?.id, actor?.kind, terrainFramingKey, controller]);

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
		if (!currentActor || !service || !canControlActorRef.current) {
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
			!canControlActorRef.current
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
			isActorCapsuleSettled(state, currentActor.actor.CanFly ?? false)
		) {
			flushPendingPosition();
		}
		spaceWasPressedRef.current = false;
	}, [flushPendingPosition]);

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

	const handleFrame = useCallback(
		(now: number, dt: number, input: ActorLocomotionFrameInput) => {
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
							capsuleStateRef.current = createActorCapsuleState(
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
				canControlActorRef.current
			) {
				if (!capsuleStateRef.current) {
					capsuleStateRef.current = createActorCapsuleState(
						currentActor,
						currentTerrain
					);
					capsuleInitializedRef.current = true;
				}

				const keys = input.pointerLocked ? input.keys : EMPTY_ACTOR_CONTROL_KEYS;
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
				const wasSettled = isActorCapsuleSettled(
					state,
					currentActor.actor.CanFly ?? false
				);

				// Follow take-over: the token eased to the committed tile centre while
				// released, so adopting the body's stale sub-tile offset would cut it,
				// and the follow camera with it. Start from the token instead.
				// Horizontal only -- copying Y would sink a hovering flyer. Follow only
				// -- first person has no local token to cut.
				if (
					cameraModeRef.current === "follow" &&
					!ownedFollowVisualRef.current &&
					input.pointerLocked &&
					wasSettled &&
					pendingSyncPositionRef.current === null &&
					lastSentPositionRef.current === null
				) {
					const authoritative = roundVoxelPosition(currentActor.actor.Position);
					const currentRules = actorCapsuleToRulesPosition(
						currentTerrain,
						state,
						index,
						currentActor.actor.CanFly ?? false
					);
					const sameTile =
						currentRules.x === authoritative.x &&
						currentRules.y === authoritative.y &&
						currentRules.h === authoritative.h;
					if (sameTile) {
						// Same helper that places the resting token.
						const anchor = actorToGroundWorld(currentActor, currentTerrain);
						anchor.y = state.position.y;
						// A tile centre can be solid while the corner the player rested in
						// is free (resolution 2-3). Skip rather than wedge -- the worst
						// case is the cut we had before.
						if (
							isActorCapsulePositionFree(
								currentTerrain,
								index,
								currentActor,
								anchor
							)
						) {
							state.position.x = anchor.x;
							state.position.z = anchor.z;
						}
					}
				}

				const shouldSimulate =
					input.pointerLocked ||
					hasInput ||
					jumpPressed ||
					!wasSettled ||
					pendingSyncPositionRef.current !== null;
				if (shouldSimulate) {
					const wasPosition = state.position.clone();
					cameraSmoothing = FIRST_PERSON_CAMERA.ACTIVE_POSITION_SMOOTHING;
					stepActorCapsuleController(
						currentTerrain,
						index,
						currentActor,
						state,
						{
							forwardInput,
							rightInput,
							verticalInput,
							jumpPressed,
							yaw: input.yaw,
							dt,
						}
					);

					let rulesPosition = actorCapsuleToRulesPosition(
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
								rulesPosition = actorCapsuleToRulesPosition(
									currentTerrain,
									state,
									index,
									currentActor.actor.CanFly ?? false
								);
							}
						}
					}
					onLiveRulesPositionChangeRef.current?.(rulesPosition);

					const settled = isActorCapsuleSettled(
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
							ACTOR_CONTROLS.SYNC_IDLE_DEBOUNCE_MS
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
					canControlActorRef.current &&
					(pendingSyncPositionRef.current !== null ||
						lastSentPositionRef.current !== null) &&
					now - lastPoseSentAtRef.current >= ACTOR_POSE_HEARTBEAT_MS
				) {
					sendCurrentActorPose(now, state.position, true);
				}
			}

			const liveState = capsuleStateRef.current;
			const ownsFollowVisual =
				cameraModeRef.current === "follow" &&
				!!currentActor &&
				!!liveState &&
				(input.pointerLocked ||
					!isActorCapsuleSettled(
						liveState,
						currentActor.actor.CanFly ?? false
					) ||
					pendingSyncPositionRef.current !== null ||
					lastSentPositionRef.current !== null);
			controller.setControlledActorPose(liveState?.position ?? null, {
				eyeHeight: currentActor ? getEyeHeight(currentActor.actor) : 0,
				positionSmoothing: cameraSmoothing,
				driveFollowVisual: ownsFollowVisual,
			});
			ownedFollowVisualRef.current = ownsFollowVisual;
		},
		[
			controller,
			flushPendingPosition,
			sendCurrentActorPose,
			updateMovementOverlay,
		]
	);

	// Plug the shared capsule sim and commit handlers into the map controller.
	useEffect(() => {
		controller.setActorLocomotionHandlers({
			onFrame: handleFrame,
			onControlReleased: commitCurrentPosition,
		});
		return () => {
			controller.setControlledActorPose(null);
			controller.setActorLocomotionHandlers(null);
		};
	}, [
		controller,
		handleFrame,
		commitCurrentPosition,
	]);

	// Mirror the controller's pointer-lock state for the HUD.
	useEffect(() => {
		setIsPointerLocked(controller.isPointerLocked);
		return controller.subscribePointerLock(setIsPointerLocked);
	}, [controller]);

	// Commit any pending position when leaving actor-controlled modes (unmount).
	// controller exits pointer lock itself, but our handlers are unregistered
	// before its camera-mode effect runs, so flush here directly. Unlike the
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
			hadControlledActorRef.current = true;
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

		if (hadControlledActorRef.current) {
			hadControlledActorRef.current = false;
			onUnavailable?.();
		}
	}, [actor, isPointerLocked, onUnavailable]);

	useEffect(() => {
		if (!terrain || !actor || !actorOnTerrain) {
			onLiveRulesPositionChangeRef.current?.(null);
			setMovementOverlay((current) => (current === null ? current : null));
			return;
		}

		const authoritative = roundVoxelPosition(actor.actor.Position);
		const authoritativeState = createActorCapsuleState(actor, terrain);
		const authoritativeRules = actorCapsuleToRulesPosition(
			terrain,
			authoritativeState,
			voxelTerrainIndex,
			actor.actor.CanFly ?? false
		);
		if (!capsuleStateRef.current || !capsuleInitializedRef.current) {
			capsuleStateRef.current = authoritativeState;
			capsuleInitializedRef.current = true;
		}
		const currentRules = actorCapsuleToRulesPosition(
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

		const liveState = capsuleStateRef.current;
		if (liveState) {
			controller.setControlledActorPose(liveState.position, {
				eyeHeight: getEyeHeight(actor.actor),
				driveFollowVisual: false,
			});
		}
	}, [
		terrain,
		actor?.id,
		actor?.kind,
		actorOnTerrain,
		actorPositionX,
		actorPositionY,
		actorPositionH,
		controller,
	]);

	return (
		<>
			{!actor && (
				<div className="absolute inset-0 z-30">
					<MissingActorMessage onLeaveActorCamera={onUnavailable} />
				</div>
			)}
			{actor && (
				<ActorCameraHud
					cameraMode={cameraMode}
					isPointerLocked={isPointerLocked}
					movementOverlay={movementOverlay}
					canFly={actor.actor.CanFly ?? false}
					linkFocus={linkFocus}
				/>
			)}
		</>
	);
}
