// Late join: the DM sits alone past Trystero's 57s offer TTL, then four players
// join at once. Guards "players can't reach a DM who has been waiting unless the
// DM refreshes" (dmotz/trystero#204, fixed in 0.26.0). Each player has ~50%
// odds of hitting that bug, so four make a reliable check. Takes ~2 minutes.
// Players should connect in about a second via the pose room; ~56s means they
// fell back to waiting for the DM's next campaign announce (Nostr, every 60s).
//   node test-kit/run.mjs test-kit/scenarios/late-join.mjs
import assert from "node:assert/strict";
import { openPeer, waitForDm, ROOM_CODE } from "../kit.mjs";

export const options = { players: 0 };

const DM_IDLE_MS = 70_000;
const JOIN_TIMEOUT_MS = 100_000;

export default async function lateJoin(kit) {
	await new Promise((resolve) => setTimeout(resolve, DM_IDLE_MS));

	const late = await Promise.all([1, 2, 3, 4].map((i) => openPeer(kit, `Late${i}`)));
	kit.players.push(...late); // so failures get screenshots
	const start = Date.now();
	const results = await Promise.allSettled(
		late.map(async (p) => {
			await p.goto(ROOM_CODE);
			await waitForDm(p, JOIN_TIMEOUT_MS);
			return (Date.now() - start) / 1000;
		})
	);

	results.forEach((r, i) =>
		console.log(`Late${i + 1}: ${r.status === "fulfilled" ? `connected after ${r.value.toFixed(1)}s` : "NEVER CONNECTED"}`)
	);
	const failed = results.filter((r) => r.status === "rejected").length;
	assert.equal(failed, 0, `${failed}/4 late players never reached the DM`);
}
