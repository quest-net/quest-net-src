import { useEffect, useMemo, useState } from "react";
import type { Character } from "../../../domains/Character/Character";
import type { Entity } from "../../../domains/Entity/Entity";
import type { VoxelTerrain } from "../../../domains/VoxelTerrain/VoxelTerrain";
import { useActionService } from "../../../services/Actions/ActionServiceProvider";
import type { LiveActorPose } from "../../../services/ActorPoseService";

export function useLiveActorPoseOverrides(
	terrain: VoxelTerrain | null | undefined,
	characters: Character[],
	entities: Entity[]
): ReadonlyMap<string, LiveActorPose> | undefined {
	const { actionService } = useActionService();
	const actorPoseService = actionService?.actorPoseService;
	const [version, setVersion] = useState(0);

	useEffect(() => {
		if (!actorPoseService) return;
		return actorPoseService.subscribeLiveActorPoses(() => {
			setVersion((current) => current + 1);
		});
	}, [actorPoseService]);

	const actorIds = useMemo(() => {
		const ids = new Set<string>();
		for (const character of characters) {
			ids.add(character.Id);
		}
		for (const entity of entities) {
			ids.add(entity.Id);
		}
		return ids;
	}, [characters, entities]);

	const actorIdsKey = useMemo(
		() => Array.from(actorIds).sort().join("|"),
		[actorIds]
	);

	useEffect(() => {
		if (!actorPoseService || !terrain) return;
		actorPoseService.reconcileLiveActorPoses(terrain.Id, actorIds);
	}, [actorPoseService, terrain?.Id, actorIds, actorIdsKey]);

	return useMemo(() => {
		if (!actorPoseService || !terrain) return undefined;
		return actorPoseService.getLiveActorPoses(terrain.Id, actorIds);
	}, [actorPoseService, terrain?.Id, actorIds, version]);
}
