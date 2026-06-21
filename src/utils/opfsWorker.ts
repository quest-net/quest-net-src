// src/utils/opfsWorker.ts
//
// Generic Web Worker that owns the Origin Private File System (OPFS). This is
// the ONLY code in the app that touches OPFS, and it is deliberately
// domain-agnostic: it stores arbitrary binary blobs (+ a small metadata string)
// keyed by a "/"-separated path. Driven by OpfsUtilities on the main thread.
//
// Why a worker: OPFS's fast synchronous file API (createSyncAccessHandle) is
// only exposed inside a dedicated worker, and running large blob writes here
// keeps them off the main (UI) thread.
//
// File format -- a length-prefixed metadata header followed by the payload, so
// callers can stash a small JSON tag (e.g. a content hash) alongside the bytes:
//     [uint32 LE metadataByteLength][metadata UTF-8 bytes][data bytes]

// --- Minimal OPFS sync-access typings -------------------------------------
// createSyncAccessHandle / FileSystemSyncAccessHandle are not in every TS DOM
// lib version yet; declare just what we use and cast at the call site.
interface FileSystemSyncAccessHandle {
	read(buffer: ArrayBufferView, options?: { at?: number }): number;
	write(buffer: ArrayBufferView, options?: { at?: number }): number;
	truncate(newSize: number): void;
	getSize(): number;
	flush(): void;
	close(): void;
}
type SyncAccessFileHandle = FileSystemFileHandle & {
	createSyncAccessHandle(): Promise<FileSystemSyncAccessHandle>;
};

// --- Per-path serialization -------------------------------------------------
// A SyncAccessHandle takes an exclusive lock on its file. Two ops racing on the
// same path (e.g. a save while a load is in flight) would collide, so chain all
// ops for a given path through one promise. The chain clears its own entry once
// drained so the map can't grow without bound.
const pathQueues = new Map<string, Promise<unknown>>();

function runExclusive<T>(pathKey: string, fn: () => Promise<T>): Promise<T> {
	const prev = pathQueues.get(pathKey) ?? Promise.resolve();
	const next = prev.then(fn, fn);
	const tracked: Promise<unknown> = next.catch(() => {}).finally(() => {
		if (pathQueues.get(pathKey) === tracked) pathQueues.delete(pathKey);
	});
	pathQueues.set(pathKey, tracked);
	return next;
}

// --- Path / handle helpers --------------------------------------------------

function splitPath(path: string): string[] {
	return path.split("/").filter(Boolean);
}

/** Walks `segments` from the OPFS root. Returns null on a missing dir when not creating. */
async function resolveDir(
	segments: string[],
	create: boolean
): Promise<FileSystemDirectoryHandle | null> {
	let dir = await navigator.storage.getDirectory();
	for (const segment of segments) {
		try {
			dir = await dir.getDirectoryHandle(segment, { create });
		} catch (error) {
			if (!create && (error as DOMException)?.name === "NotFoundError") return null;
			throw error;
		}
	}
	return dir;
}

async function getFile(
	path: string,
	create: boolean
): Promise<SyncAccessFileHandle | null> {
	const parts = splitPath(path);
	const fileName = parts.pop();
	if (!fileName) throw new Error(`Invalid OPFS path: "${path}"`);
	const dir = await resolveDir(parts, create);
	if (!dir) return null;
	try {
		return (await dir.getFileHandle(fileName, { create })) as SyncAccessFileHandle;
	} catch (error) {
		if (!create && (error as DOMException)?.name === "NotFoundError") return null;
		throw error;
	}
}

// --- Operations -------------------------------------------------------------

async function saveBlob(
	path: string,
	metadataJson: string,
	data: Uint8Array
): Promise<void> {
	const file = await getFile(path, true);
	if (!file) throw new Error(`Failed to create OPFS file: "${path}"`);
	const access = await file.createSyncAccessHandle();
	try {
		const metaBytes = new TextEncoder().encode(metadataJson);
		const header = new Uint8Array(4 + metaBytes.length);
		new DataView(header.buffer).setUint32(0, metaBytes.length, true);
		header.set(metaBytes, 4);

		access.truncate(header.length + data.length);
		access.write(header, { at: 0 });
		access.write(data, { at: header.length });
		access.flush();
	} finally {
		access.close();
	}
}

async function loadBlob(
	path: string
): Promise<{ metadataJson: string; data: Uint8Array } | null> {
	const file = await getFile(path, false);
	if (!file) return null;
	const access = await file.createSyncAccessHandle();
	try {
		const size = access.getSize();
		if (size < 4) return null; // empty/corrupt -- treat as missing

		const head = new Uint8Array(4);
		access.read(head, { at: 0 });
		const metaLen = new DataView(head.buffer).getUint32(0, true);
		if (4 + metaLen > size) return null;

		const metaBytes = new Uint8Array(metaLen);
		access.read(metaBytes, { at: 4 });
		const metadataJson = new TextDecoder().decode(metaBytes);

		const bodyOffset = 4 + metaLen;
		const data = new Uint8Array(size - bodyOffset);
		if (data.length > 0) access.read(data, { at: bodyOffset });
		return { metadataJson, data };
	} finally {
		access.close();
	}
}

async function removeBlob(path: string): Promise<void> {
	const parts = splitPath(path);
	const fileName = parts.pop();
	if (!fileName) return;
	const dir = await resolveDir(parts, false);
	if (!dir) return;
	try {
		await dir.removeEntry(fileName);
	} catch (error) {
		if ((error as DOMException)?.name !== "NotFoundError") throw error;
	}
}

async function removeDir(path: string): Promise<void> {
	const parts = splitPath(path);
	const dirName = parts.pop();
	if (!dirName) return;
	const parent = await resolveDir(parts, false);
	if (!parent) return;
	try {
		await parent.removeEntry(dirName, { recursive: true });
	} catch (error) {
		if ((error as DOMException)?.name !== "NotFoundError") throw error;
	}
}

// --- Message dispatch -------------------------------------------------------

interface BaseReq {
	id: number;
	path: string;
}
type SaveReq = BaseReq & { type: "save"; metadataJson: string; data: Uint8Array };
type LoadReq = BaseReq & { type: "load" };
type RemoveReq = BaseReq & { type: "remove" };
type RemoveDirReq = BaseReq & { type: "removeDir" };
type WorkerRequest = SaveReq | LoadReq | RemoveReq | RemoveDirReq;

const ctx = self as unknown as Worker;

ctx.addEventListener("message", (event: MessageEvent<WorkerRequest>) => {
	const req = event.data;
	runExclusive(req.path, async () => {
		switch (req.type) {
			case "save":
				await saveBlob(req.path, req.metadataJson, req.data);
				ctx.postMessage({ id: req.id, ok: true });
				return;
			case "load": {
				const result = await loadBlob(req.path);
				if (!result) {
					ctx.postMessage({ id: req.id, missing: true });
				} else {
					ctx.postMessage(
						{ id: req.id, metadataJson: result.metadataJson, data: result.data },
						[result.data.buffer]
					);
				}
				return;
			}
			case "remove":
				await removeBlob(req.path);
				ctx.postMessage({ id: req.id, ok: true });
				return;
			case "removeDir":
				await removeDir(req.path);
				ctx.postMessage({ id: req.id, ok: true });
				return;
		}
	}).catch((error: unknown) => {
		ctx.postMessage({
			id: req.id,
			error: error instanceof Error ? error.message : String(error),
		});
	});
});
