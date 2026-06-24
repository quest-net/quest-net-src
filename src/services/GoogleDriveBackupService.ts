// services/GoogleDriveBackupService.ts
//
// Transport layer for Google Drive campaign backups. Pure Drive/OAuth concerns —
// no app/campaign knowledge (that lives in CloudBackupService). Uses the Google
// Identity Services token model from the browser: a public client ID, no secret,
// short-lived access tokens kept in memory only and re-acquired (silently when a
// Google session exists) each time they're needed.

import { loadScript } from "../utils/ScriptLoader";
import {
	BACKUP_FOLDER_NAME,
	GOOGLE_CLIENT_ID,
	GOOGLE_DRIVE_SCOPE,
	GOOGLE_GSI_SRC,
	isCloudBackupConfigured,
} from "../config/googleDrive";
import type { CampaignCounts } from "../domains/Campaign/CampaignUtils";

declare global {
	// Minimal ambient typings for the bits of Google Identity Services we use.
	// eslint-disable-next-line @typescript-eslint/no-namespace
	namespace google.accounts.oauth2 {
		interface TokenResponse {
			access_token: string;
			expires_in: string;
			scope?: string;
			error?: string;
			error_description?: string;
		}
		interface TokenClientConfig {
			client_id: string;
			scope: string;
			callback: (resp: TokenResponse) => void;
			error_callback?: (err: { type?: string; message?: string }) => void;
		}
		interface TokenClient {
			requestAccessToken(overrides?: { prompt?: string }): void;
		}
		function initTokenClient(config: TokenClientConfig): TokenClient;
		function revoke(token: string, done?: () => void): void;
	}
}

/** Metadata about one campaign backup stored in Drive (from appProperties). */
export interface DriveBackupMeta {
	fileId: string;
	backupKey: string;
	campaignName: string;
	/** Local last-updated time (ms) of the backed-up campaign. */
	lastUpdated: number;
	version: string;
	counts: CampaignCounts | null;
}

/** appProperties payload written alongside each backup file. */
export interface BackupFileMeta {
	backupKey: string;
	campaignName: string;
	/** Local last-updated time (ms) of the campaign being backed up. */
	lastUpdated: number;
	version: string;
	counts: CampaignCounts;
}

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3";
const FOLDER_MIME = "application/vnd.google-apps.folder";

// Drive caps each appProperties entry at 124 bytes (key + value), so counts are
// stored as a compact positional array in this fixed order rather than a
// named-key object, and the display name is truncated.
const COUNT_KEYS: (keyof CampaignCounts)[] = [
	"Items",
	"Terrains",
	"Images",
	"Characters",
	"Entities",
	"Skills",
	"Statuses",
];

function encodeCounts(counts: CampaignCounts): string {
	return JSON.stringify(COUNT_KEYS.map((k) => counts[k]));
}

function decodeCounts(raw: string | undefined): CampaignCounts | null {
	if (!raw) return null;
	try {
		const arr = JSON.parse(raw) as number[];
		const out = {} as CampaignCounts;
		COUNT_KEYS.forEach((k, i) => {
			out[k] = arr[i] ?? 0;
		});
		return out;
	} catch {
		return null;
	}
}

let tokenClient: google.accounts.oauth2.TokenClient | null = null;
let accessToken: string | null = null;
let tokenExpiry = 0;
let folderId: string | null = null;

// requestAccessToken is callback-based; these bridge the active request to a
// promise. Only one token request is ever in flight at a time.
let pending: {
	resolve: (token: string) => void;
	reject: (err: Error) => void;
} | null = null;

async function ensureClient(): Promise<void> {
	if (!isCloudBackupConfigured()) {
		throw new Error("Cloud backup is not configured (missing client ID).");
	}
	await loadScript(GOOGLE_GSI_SRC);
	if (tokenClient) return;
	tokenClient = google.accounts.oauth2.initTokenClient({
		client_id: GOOGLE_CLIENT_ID,
		scope: GOOGLE_DRIVE_SCOPE,
		callback: (resp) => {
			const p = pending;
			pending = null;
			if (!p) return;
			if (resp.error) {
				p.reject(new Error(resp.error_description || resp.error));
				return;
			}
			accessToken = resp.access_token;
			// Refresh a minute early to avoid races against expiry.
			tokenExpiry = Date.now() + (Number(resp.expires_in) - 60) * 1000;
			p.resolve(resp.access_token);
		},
		error_callback: (err) => {
			const p = pending;
			pending = null;
			p?.reject(new Error(err.message || err.type || "Authorization failed"));
		},
	});
}

function requestToken(interactive: boolean): Promise<string> {
	return new Promise<string>((resolve, reject) => {
		if (pending) {
			reject(new Error("A token request is already in progress."));
			return;
		}
		pending = { resolve, reject };
		try {
			// "none" = silent (only works with an active Google session + prior
			// consent); "" = show consent/account UI as needed.
			tokenClient!.requestAccessToken({ prompt: interactive ? "" : "none" });
		} catch (e) {
			pending = null;
			reject(e instanceof Error ? e : new Error(String(e)));
		}
	});
}

/** Returns a valid access token, refreshing silently when possible. */
async function getToken(): Promise<string> {
	if (accessToken && Date.now() < tokenExpiry) return accessToken;
	await ensureClient();
	return requestToken(false);
}

async function driveFetch(url: string, init?: RequestInit): Promise<Response> {
	const token = await getToken();
	const res = await fetch(url, {
		...init,
		headers: {
			...(init?.headers || {}),
			Authorization: `Bearer ${token}`,
		},
	});
	if (!res.ok) {
		const detail = await res.text().catch(() => "");
		throw new Error(`Drive API ${res.status}: ${detail.slice(0, 300)}`);
	}
	return res;
}

async function ensureFolder(): Promise<string> {
	if (folderId) return folderId;
	const q = encodeURIComponent(
		`mimeType='${FOLDER_MIME}' and name='${BACKUP_FOLDER_NAME}' and trashed=false`
	);
	const res = await driveFetch(
		`${DRIVE_API}/files?q=${q}&spaces=drive&fields=files(id,name)`
	);
	const data = (await res.json()) as { files?: { id: string }[] };
	if (data.files && data.files.length > 0) {
		folderId = data.files[0].id;
		return folderId;
	}
	const created = await driveFetch(`${DRIVE_API}/files?fields=id`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ name: BACKUP_FOLDER_NAME, mimeType: FOLDER_MIME }),
	});
	const createdData = (await created.json()) as { id: string };
	folderId = createdData.id;
	return folderId;
}

function parseMeta(
	fileId: string,
	appProperties: Record<string, string> | undefined
): DriveBackupMeta | null {
	const props = appProperties || {};
	if (!props.backupKey) return null;
	return {
		fileId,
		backupKey: props.backupKey,
		campaignName: props.campaignName || "Campaign",
		// Read the new key, falling back to the legacy `lastActivity` key so
		// backups written before this rename still compare correctly.
		lastUpdated: Number(props.lastUpdated ?? props.lastActivity) || 0,
		version: props.version || "0.0.0",
		counts: decodeCounts(props.counts),
	};
}

export const GoogleDriveBackupService = {
	/**
	 * Acquires an access token. `interactive` shows the Google consent/account
	 * popup (first connect); otherwise it attempts a silent token and rejects if
	 * no Google session is available. Returns the user's email when obtainable.
	 */
	async connect(opts: { interactive: boolean }): Promise<{ email?: string }> {
		await ensureClient();
		await requestToken(opts.interactive);
		const email = await this.fetchEmail().catch(() => undefined);
		return { email };
	},

	/** Clears the in-memory token and best-effort revokes it with Google. */
	disconnect(): void {
		if (accessToken) {
			try {
				google.accounts.oauth2.revoke(accessToken);
			} catch {
				// best effort
			}
		}
		accessToken = null;
		tokenExpiry = 0;
		folderId = null;
	},

	/** True if a usable in-memory token is currently held. */
	hasLiveToken(): boolean {
		return !!accessToken && Date.now() < tokenExpiry;
	},

	/** Reads the signed-in user's email via the Drive `about` resource. */
	async fetchEmail(): Promise<string | undefined> {
		const res = await driveFetch(`${DRIVE_API}/about?fields=user(emailAddress)`);
		const data = (await res.json()) as { user?: { emailAddress?: string } };
		return data.user?.emailAddress;
	},

	/** Lists all campaign backups in the app's Drive folder (cheap metadata). */
	async listBackups(): Promise<DriveBackupMeta[]> {
		const folder = await ensureFolder();
		const q = encodeURIComponent(`'${folder}' in parents and trashed=false`);
		const res = await driveFetch(
			`${DRIVE_API}/files?q=${q}&spaces=drive&fields=files(id,appProperties)&pageSize=1000`
		);
		const data = (await res.json()) as {
			files?: { id: string; appProperties?: Record<string, string> }[];
		};
		const out: DriveBackupMeta[] = [];
		for (const f of data.files || []) {
			const meta = parseMeta(f.id, f.appProperties);
			if (meta) out.push(meta);
		}
		return out;
	},

	/** Downloads and parses a backup file's full JSON payload. */
	async downloadBackup(fileId: string): Promise<unknown> {
		const res = await driveFetch(`${DRIVE_API}/files/${fileId}?alt=media`);
		const text = await res.text();
		return JSON.parse(text);
	},

	/**
	 * Creates or updates (resumable) the backup file for a campaign, keyed by
	 * BackupKey via appProperties. Returns the Drive file id.
	 */
	async uploadBackup(
		json: string,
		meta: BackupFileMeta,
		existingFileId?: string
	): Promise<string> {
		const folder = await ensureFolder();
		const appProperties: Record<string, string> = {
			backupKey: meta.backupKey,
			campaignName: meta.campaignName.slice(0, 100),
			lastUpdated: String(meta.lastUpdated),
			version: meta.version,
			counts: encodeCounts(meta.counts),
		};

		// 1) Start a resumable session with the file metadata.
		const metadata: Record<string, unknown> = { name: `${meta.campaignName}.json`, appProperties };
		let sessionUrl: string;
		if (existingFileId) {
			const start = await driveFetch(
				`${DRIVE_UPLOAD}/files/${existingFileId}?uploadType=resumable&keepRevisionForever=true&fields=id`,
				{
					method: "PATCH",
					headers: { "Content-Type": "application/json; charset=UTF-8" },
					body: JSON.stringify(metadata),
				}
			);
			sessionUrl = start.headers.get("Location") || "";
		} else {
			metadata.parents = [folder];
			const start = await driveFetch(
				`${DRIVE_UPLOAD}/files?uploadType=resumable&fields=id`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json; charset=UTF-8" },
					body: JSON.stringify(metadata),
				}
			);
			sessionUrl = start.headers.get("Location") || "";
		}
		if (!sessionUrl) {
			throw new Error("Drive resumable upload: no session URL returned.");
		}

		// 2) Upload the media body to the session URL in one PUT (payloads are
		// well under the size where chunking matters).
		const put = await fetch(sessionUrl, {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: json,
		});
		if (!put.ok) {
			const detail = await put.text().catch(() => "");
			throw new Error(`Drive upload ${put.status}: ${detail.slice(0, 300)}`);
		}
		const result = (await put.json()) as { id: string };
		return result.id;
	},
};
