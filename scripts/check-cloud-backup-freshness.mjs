// Self-check for the cloud-backup freshness rules.
//
// Run: npm run check:backup   (Node 24 strips the .ts types natively)
//
// These two predicates decide whether work gets uploaded and whether the user is
// invited to overwrite a local campaign with a cloud copy. Both failure
// directions destroy data silently -- one strands work that never reaches the
// cloud, the other proposes discarding work that never left the device -- so the
// rules are asserted here rather than trusted.

import assert from "node:assert/strict";
import {
	cloudIsAhead,
	hasUnbackedUpChanges,
} from "../src/services/cloudBackupFreshness.ts";

const state = (local, backedUp, cloud) => ({ local, backedUp, cloud });

// --- Uploading -------------------------------------------------------------

// Never uploaded from this device: must upload, whatever the counters say.
assert.equal(hasUnbackedUpChanges(state(0, undefined, 0)), true);
assert.equal(hasUnbackedUpChanges(state(7, undefined, 9)), true);

// Everything this device has is already up there: nothing to do.
assert.equal(hasUnbackedUpChanges(state(5, 5, 5)), false);

// Local edits since the last upload: must upload.
assert.equal(hasUnbackedUpChanges(state(6, 5, 5)), true);

// Another device has since written. This device still has nothing pending, so
// it must NOT re-upload and overwrite that newer file with its own older state.
assert.equal(hasUnbackedUpChanges(state(5, 5, 9)), false);

// --- Offering the destructive restore --------------------------------------

// Never uploaded from here: the counters share no reference point, so a cloud
// number that merely looks bigger proves nothing. Never offer.
assert.equal(cloudIsAhead(state(0, undefined, 12)), false);
assert.equal(cloudIsAhead(state(40, undefined, 1)), false);

// In sync with the cloud: nothing to restore.
assert.equal(cloudIsAhead(state(5, 5, 5)), false);

// This device has unpushed work. Even though the cloud moved, offering to
// replace the local copy would propose discarding that work. Never offer.
assert.equal(cloudIsAhead(state(8, 5, 9)), false);

// The honest case: nothing pending locally, and the cloud moved since our
// upload -- another device wrote. This is the only true.
assert.equal(cloudIsAhead(state(5, 5, 9)), true);

// A cloud file rewound (restored from an older Drive revision, or re-stamped by
// a device that had rolled back) still counts as "moved since our upload": it no
// longer matches what we put there, and the user should get the choice.
assert.equal(cloudIsAhead(state(5, 5, 3)), true);

// --- Clock skew is structurally out of the picture --------------------------
// Nothing above takes a timestamp. The former timestamp comparison had a state
// where a fast clock froze uploads permanently; assert the successor cannot,
// by showing the decision depends only on the local pair.
for (const cloud of [0, 1, 999999]) {
	assert.equal(hasUnbackedUpChanges(state(6, 5, cloud)), true);
}

console.log("cloud-backup freshness rules: all checks passed");
