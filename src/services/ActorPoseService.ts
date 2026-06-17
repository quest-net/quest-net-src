import type { Campaign } from "../domains/Campaign/Campaign";
import { CampaignUtils } from "../domains/Campaign/CampaignUtils";
import type { Context } from "../domains/Context/Context";
import type { Room, ActionSend } from "../domains/Room/Room";

const ACTOR_POSE_TIMEOUT_MS = 800;
const ACTOR_POSE_PRUNE_INTERVAL_MS = 250;

export type ActorPosePacket = {
	actorId: string;
	terrainId: string;
	position: [number, number, number];
};

export type LiveActorPose = ActorPosePacket & {
	receivedAt: number;
	peerId: string;
};

type LiveActorPoseListener = () => void;

export class ActorPoseService {
	private context: Context;
	private sendActorPosePacket?: ActionSend;
	private liveActorPoses: Map<string, LiveActorPose> = new Map();
	private liveActorPoseListeners: Set<LiveActorPoseListener> = new Set();
	private pruneInterval?: ReturnType<typeof setInterval>;

	constructor(context: Context, room: Room) {
		this.context = context;
		const actorPose = room.makeAction<any>("actorPose");
		this.sendActorPosePacket = actorPose.send;
		actorPose.onMessage = (data, { peerId }) => {
			this.handleActorPose(data, peerId);
		};

		this.pruneInterval = setInterval(
			() => this.reconcileLiveActorPoses(),
			ACTOR_POSE_PRUNE_INTERVAL_MS
		);
	}

	public sendActorPose(packet: ActorPosePacket): void {
		if (!this.sendActorPosePacket) return;
		if (!this.isActorPosePacket(packet)) return;
		this.sendActorPosePacket(packet);
	}

	public subscribeLiveActorPoses(listener: LiveActorPoseListener): () => void {
		this.liveActorPoseListeners.add(listener);
		return () => {
			this.liveActorPoseListeners.delete(listener);
		};
	}

	public getLiveActorPoses(
		terrainId: string,
		actorIds?: ReadonlySet<string>
	): Map<string, LiveActorPose> {
		const now = Date.now();
		const poses = new Map<string, LiveActorPose>();
		for (const [actorId, pose] of this.liveActorPoses) {
			if (now - pose.receivedAt > ACTOR_POSE_TIMEOUT_MS) continue;
			if (pose.terrainId !== terrainId) continue;
			if (actorIds && !actorIds.has(actorId)) continue;
			poses.set(actorId, {
				...pose,
				position: [...pose.position] as [number, number, number],
			});
		}
		return poses;
	}

	public reconcileLiveActorPoses(
		terrainId?: string,
		actorIds?: ReadonlySet<string>
	): void {
		const now = Date.now();
		let changed = false;
		for (const [actorId, pose] of Array.from(this.liveActorPoses)) {
			const expired = now - pose.receivedAt > ACTOR_POSE_TIMEOUT_MS;
			const wrongTerrain = terrainId !== undefined && pose.terrainId !== terrainId;
			const actorMissing = actorIds !== undefined && !actorIds.has(actorId);
			if (expired || wrongTerrain || actorMissing) {
				this.liveActorPoses.delete(actorId);
				changed = true;
			}
		}
		if (changed) {
			this.emitLiveActorPoseChange();
		}
	}

	public clearLiveActorPoses(actorId?: string): void {
		let changed = false;
		if (actorId) {
			changed = this.liveActorPoses.delete(actorId);
		} else if (this.liveActorPoses.size > 0) {
			this.liveActorPoses.clear();
			changed = true;
		}
		if (changed) {
			this.emitLiveActorPoseChange();
		}
	}

	public clearForPeer(peerId: string): void {
		let changed = false;
		for (const [actorId, pose] of Array.from(this.liveActorPoses)) {
			if (pose.peerId === peerId) {
				this.liveActorPoses.delete(actorId);
				changed = true;
			}
		}
		if (changed) {
			this.emitLiveActorPoseChange();
		}
	}

	public clearForAuthoritativeAction(
		actionKey: string | undefined,
		params: any
	): void {
		if (
			actionKey === "terrain:moveActors" ||
			actionKey === "scenario:load"
		) {
			this.clearLiveActorPoses();
			return;
		}
		// Movement and despawn are unified under actor:move / actor:remove, both
		// keyed by actorId.
		if (actionKey === "actor:move" || actionKey === "actor:remove") {
			if (typeof params?.actorId === "string") {
				this.clearLiveActorPoses(params.actorId);
			}
		}
	}

	public cleanup(): void {
		if (this.pruneInterval) {
			clearInterval(this.pruneInterval);
			this.pruneInterval = undefined;
		}
		this.liveActorPoses.clear();
		this.liveActorPoseListeners.clear();
	}

	private handleActorPose(data: unknown, peerId?: string): void {
		if (!peerId || !this.isActorPosePacket(data)) return;

		let campaign: Campaign;
		try {
			campaign = CampaignUtils.getActiveCampaign(this.context);
		} catch {
			return;
		}

		// Store poses for any terrain; consumers filter by the terrain they are
		// rendering via getLiveActorPoses(terrainId, ...). With per-actor terrain
		// there is no single global terrain to reject against.
		//
		// No per-peer control check: a peer can only be in first person with an
		// actor it has selected/impersonated, so the sender is trusted. A control
		// gate here also depended on peer User metadata having arrived, which made
		// observers drop early-session poses.
		if (!this.actorExistsInGameState(campaign, data.actorId)) return;

		this.liveActorPoses.set(data.actorId, {
			actorId: data.actorId,
			terrainId: data.terrainId,
			position: [...data.position] as [number, number, number],
			receivedAt: Date.now(),
			peerId,
		});
		this.emitLiveActorPoseChange();
	}

	private isActorPosePacket(data: unknown): data is ActorPosePacket {
		if (!data || typeof data !== "object") return false;
		const packet = data as Partial<ActorPosePacket>;
		return (
			typeof packet.actorId === "string" &&
			packet.actorId.length > 0 &&
			typeof packet.terrainId === "string" &&
			packet.terrainId.length > 0 &&
			Array.isArray(packet.position) &&
			packet.position.length === 3 &&
			packet.position.every((value) => Number.isFinite(value))
		);
	}

	private actorExistsInGameState(campaign: Campaign, actorId: string): boolean {
		return (
			campaign.GameState.Characters.some((actor) => actor.Id === actorId) ||
			campaign.GameState.Entities.some((actor) => actor.Id === actorId)
		);
	}

	private emitLiveActorPoseChange(): void {
		for (const listener of this.liveActorPoseListeners) {
			listener();
		}
	}
}
