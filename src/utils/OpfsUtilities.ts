// src/utils/OpfsUtilities.ts
//
// Generic utilities for OPFS (Origin Private File System) binary storage -- the
// OPFS counterpart to IndexedDBUtilities / LocalStorageUtilities. Stores
// arbitrary binary blobs keyed by a "/"-separated path, with an optional small
// metadata object stashed alongside the bytes (mirroring IndexedDBUtilities'
// (id, data, metadata) shape). All file I/O runs in a dedicated worker
// (src/utils/opfsWorker.ts) using OPFS's synchronous access handles, so large
// writes never block the main (UI) thread.
//
// Transfer discipline:
//  - save() does NOT transfer the data buffer -- the caller may still own/read
//    it (e.g. a live render buffer), and transferring would detach it. The
//    structured-clone copy is a ~1ms memcpy for a few MB.
//  - load() transfers the worker-created buffer back (zero-copy, no detach risk).

interface OkResponse {
	id: number;
	ok: true;
}
interface LoadResponse {
	id: number;
	metadataJson?: string;
	data?: Uint8Array;
	missing?: true;
}
interface ErrorResponse {
	id: number;
	error: string;
}
type WorkerResponse = OkResponse | LoadResponse | ErrorResponse;

interface Pending {
	resolve: (value: WorkerResponse) => void;
	reject: (reason: unknown) => void;
}

/** A blob read back from OPFS: its bytes plus its decoded metadata object. */
export interface OpfsBlob<M = Record<string, unknown>> {
	data: Uint8Array;
	metadata: M;
}

/**
 * Generic utilities for OPFS binary storage. Static-method shape matches
 * IndexedDBUtilities; the worker is a lazily-created singleton.
 */
export class OpfsUtilities {
	private static worker: Worker | null = null;
	private static readonly pending = new Map<number, Pending>();
	private static nextId = 1;

	/** Whether OPFS is available in this environment. */
	static isSupported(): boolean {
		return (
			typeof navigator !== "undefined" &&
			"storage" in navigator &&
			typeof navigator.storage?.getDirectory === "function"
		);
	}

	private static ensureWorker(): Worker {
		if (this.worker) return this.worker;
		if (!this.isSupported()) {
			throw new Error("OPFS is unavailable in this browser.");
		}
		const worker = new Worker(new URL("./opfsWorker.ts", import.meta.url), {
			type: "module",
		});
		worker.addEventListener("message", (event: MessageEvent<WorkerResponse>) => {
			const res = event.data;
			const entry = this.pending.get(res.id);
			if (!entry) return;
			this.pending.delete(res.id);
			if ("error" in res) entry.reject(new Error(res.error));
			else entry.resolve(res);
		});
		worker.addEventListener("error", (event) => this.failAll(event.message));
		worker.addEventListener("messageerror", () =>
			this.failAll("OPFS worker message error")
		);
		this.worker = worker;
		return worker;
	}

	private static failAll(message: string): void {
		const error = new Error(`[OpfsUtilities] ${message}`);
		for (const entry of this.pending.values()) entry.reject(error);
		this.pending.clear();
		this.worker?.terminate();
		this.worker = null;
	}

	private static request(
		message: Record<string, unknown>,
		transfer?: Transferable[]
	): Promise<WorkerResponse> {
		const worker = this.ensureWorker();
		const id = this.nextId++;
		return new Promise<WorkerResponse>((resolve, reject) => {
			this.pending.set(id, { resolve, reject });
			worker.postMessage({ ...message, id }, transfer ?? []);
		});
	}

	/**
	 * Writes binary `data` to `path`, creating intermediate directories. `metadata`
	 * is a small JSON-serializable object stored alongside the bytes (returned by
	 * load). The data buffer is NOT transferred (see file header).
	 */
	static async save(
		path: string,
		data: Uint8Array,
		metadata: Record<string, unknown> = {}
	): Promise<void> {
		await this.request({
			type: "save",
			path,
			metadataJson: JSON.stringify(metadata),
			data,
		});
	}

	/** Reads the blob at `path`, or null if it does not exist. */
	static async load<M = Record<string, unknown>>(
		path: string
	): Promise<OpfsBlob<M> | null> {
		const res = (await this.request({ type: "load", path })) as LoadResponse;
		if (res.missing || !res.data || res.metadataJson === undefined) return null;
		return { data: res.data, metadata: JSON.parse(res.metadataJson) as M };
	}

	/** Removes the file at `path`. No-op if absent. */
	static async remove(path: string): Promise<void> {
		await this.request({ type: "remove", path });
	}

	/** Recursively removes the directory at `path`. No-op if absent. */
	static async removeDirectory(path: string): Promise<void> {
		await this.request({ type: "removeDir", path });
	}
}
