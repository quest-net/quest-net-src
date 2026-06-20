// services/CampaignMutationRecorder.ts
//
// DM-only. Subscribes to the context store root and buffers every Valtio
// mutation op so StateSync can build operation-based deltas (Plane A) instead
// of diffing two full campaign clones.
//
// Why subscribe to the ROOT: the architecture mandates that ALL campaign
// mutations flow through the proxy, so one root subscription yields a complete
// op log -- any future campaign field syncs incrementally with zero new code.
// Ops arrive with full paths from the root (e.g. ['ActiveCampaign', 'GameState',
// ...]); translateOpsToPatches strips the ActiveCampaign prefix and ignores
// non-campaign ops (IsOptimistic, AppSettings, presence lives in a separate
// proxy entirely).
//
// Why notifyInSync = true: the post-action broadcast() runs synchronously right
// after `await mutateCampaign(...)` resolves, with no intervening microtask. In
// sync mode Valtio fires the listener immediately on each mutation, so the
// buffer is already complete when broadcast() reads it. (Default async batching
// would deliver the ops a microtask later -- after broadcast had already run.)
//
// Why unstable_enableOp: as of valtio 2.3.x the per-op `[op, path, value,
// prevValue]` stream delivered to subscribe() listeners is OPT-IN. Without it
// the listener still fires but receives an empty ops array, so we must enable
// it before subscribing. It is a global toggle (affects every proxy in this JS
// context) but a harmless one -- other subscribers ignore the ops argument --
// and it is only flipped on the DM, where the recorder actually needs ops.

import { subscribe, unstable_enableOp } from "valtio";
import type { Operation } from "fast-json-patch";
import type { Context } from "../domains/Context/Context";
import type { Campaign } from "../domains/Campaign/Campaign";
import { translateOpsToPatches, type ValtioOp } from "./StateSyncOps";

export class CampaignMutationRecorder {
	private buffer: ValtioOp[] = [];
	private readonly unsubscribe: () => void;

	constructor(store: Context) {
		// Turn on the op stream (no-op if already enabled) before subscribing.
		unstable_enableOp(true);
		this.unsubscribe = subscribe(
			store,
			(ops) => {
				// Valtio's op tuples match ValtioOp structurally.
				this.buffer.push(...(ops as unknown as ValtioOp[]));
			},
			true
		);
	}

	/**
	 * Translates the buffered ops into campaign-relative JSON-Patch and clears
	 * the buffer. Returns `null` when a delta can't be expressed (campaign root
	 * replaced wholesale) and the caller must full-send.
	 */
	flush(campaign: Campaign): Operation[] | null {
		if (this.buffer.length === 0) return [];
		const ops = this.buffer;
		this.buffer = [];
		return translateOpsToPatches(ops, campaign);
	}

	/**
	 * Discards buffered ops without translating them. Called when a full send is
	 * issued -- the snapshot already carries those mutations, so replaying them
	 * as a delta on top would double-apply.
	 */
	discard(): void {
		this.buffer = [];
	}

	dispose(): void {
		this.unsubscribe();
		this.buffer = [];
	}
}
