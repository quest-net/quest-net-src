/// <reference types="vite/client" />

interface ImportMetaEnv {
	/** Metered static TURN username (from the dashboard). */
	readonly VITE_TURN_USERNAME?: string;
	/** Metered static TURN credential/password (from the dashboard). */
	readonly VITE_TURN_CREDENTIAL?: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}
