// config/googleDrive.ts
//
// Static configuration for the Google Drive campaign-backup feature. The client
// ID is a *public* OAuth Web client ID (no secret is ever shipped — the browser
// uses the PKCE/token model). Supply it at build time via VITE_GOOGLE_CLIENT_ID;
// when it's absent the feature simply stays hidden (see isCloudBackupConfigured).

/** Public OAuth Web client ID. Empty string when not configured. */
export const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? "";

/**
 * Non-sensitive Drive scope: the app can only ever see files it created. This is
 * what keeps us off Google's sensitive-scope verification track.
 */
export const GOOGLE_DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";

/** Google Identity Services library (token-model OAuth). */
export const GOOGLE_GSI_SRC = "https://accounts.google.com/gsi/client";

/** Folder created in the user's Drive to hold campaign backups. */
export const BACKUP_FOLDER_NAME = "Quest-Net Backups";

/** True when a client ID has been configured, i.e. the feature is available. */
export function isCloudBackupConfigured(): boolean {
	return GOOGLE_CLIENT_ID.trim().length > 0;
}
