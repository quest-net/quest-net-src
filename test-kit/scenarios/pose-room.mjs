// Pose room: players join the active `<roomCode>:pose:v1` room as soon as the
// campaign view mounts (that is what makes late joins fast, see late-join.mjs).
// Guards that a player's live pose reaches the DM and the other player, and
// logs the campaign-room peer count per player.
//   node test-kit/run.mjs test-kit/scenarios/pose-room.mjs
import assert from "node:assert/strict";
import { waitForDm } from "../kit.mjs";

export default async function poseRoom(kit) {
	const { dm, players } = kit;
	const [p1, p2] = players;
	for (const p of players) await waitForDm(p);

	// Known, not asserted: a Trystero shared peer formed in the pose room also
	// links players to each other in the passive campaign room (true before
	// players joined the pose room early, too), so this logs 2, not 1.
	await new Promise((resolve) => setTimeout(resolve, 3000));
	for (const p of players) {
		const n = await p.eval((qn) => Object.keys(qn.actions.room.getPeers()).length);
		console.log(`${p.name} campaign peers: ${n}`);
	}

	// P1 streams a pose for its character; the DM and P2 must both see it.
	const { actorId, terrainId } = await p1.eval((qn) => {
		const id = qn.ctx.User.SelectedCharacters.testkit;
		const actor = qn.campaign.GameState.Characters.find((c) => c.Id === id);
		return { actorId: id, terrainId: actor.Position.terrainId };
	});
	await p1.eval((qn, a) => {
		let n = 0;
		const timer = setInterval(() => {
			qn.actions.actorPoseService.sendActorPose({ ...a, position: [1.5, 2, 1.5] });
			if (++n > 60) clearInterval(timer);
		}, 100);
	}, { actorId, terrainId });

	for (const peer of [dm, p2]) {
		const seen = await peer.eval(async (qn, a) => {
			for (let i = 0; i < 40; i++) {
				if (qn.actions.actorPoseService.getLiveActorPoses(a.terrainId).has(a.actorId)) return true;
				await new Promise((r) => setTimeout(r, 100));
			}
			return false;
		}, { actorId, terrainId });
		assert.ok(seen, `${peer.name} received P1's live pose`);
	}
}
