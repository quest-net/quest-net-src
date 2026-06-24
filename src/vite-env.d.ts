/// <reference types="vite/client" />

interface ImportMetaEnv {
	/** Metered static TURN username (from the dashboard). */
	readonly VITE_TURN_USERNAME?: string;
	/** Metered static TURN credential/password (from the dashboard). */
	readonly VITE_TURN_CREDENTIAL?: string;
	/** Google OAuth Web client ID for Drive backup (public; no secret). */
	readonly VITE_GOOGLE_CLIENT_ID?: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}
