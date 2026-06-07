// domains/Campaign/CampaignConnectionScreen.tsx
//
// Full-page connection status screen shown while a campaign view is still
// establishing its peer-to-peer link: the brief load before joining, a player
// waiting on the DM's first broadcast, and the retryable "still reaching the
// DM" state. Hard failures (bad room code, missing payload) use the plain
// error screen in CampaignView instead — this component is only for the
// hopeful, in-progress states.
//
// Styling matches the rest of the app: the spinning `mdi--compass` motif from
// Main.tsx's map loader and the base-200/base-300 palette used by the Home and
// Campaigns pages. The backdrop is a cheap CSS gradient rather than one of the
// WebGL backgrounds (Waves / PixelBlast) because this screen can mount and
// unmount on every reconnect cycle.

import { useNavigate } from "react-router-dom";

export type ConnectionPhase = "connecting" | "waiting" | "retrying";

interface CampaignConnectionScreenProps {
	phase: ConnectionPhase;
	/** Room code being joined, shown for reassurance. Omit for the DM (whose
	 *  identifier is a private GUID, not a shareable code). */
	roomCode?: string;
	/** Optional override for the body copy (e.g. the retry message). */
	message?: string;
}

const PHASE_COPY: Record<ConnectionPhase, { title: string; body: string }> = {
	connecting: {
		title: "Connecting to campaign…",
		body: "Establishing a peer-to-peer connection.",
	},
	waiting: {
		title: "Waiting for the DM…",
		body: "You're in the room. Hang tight while the DM opens the session.",
	},
	retrying: {
		title: "Still reaching the DM…",
		body: "We haven't heard back yet — retrying automatically until the DM comes online.",
	},
};

export function CampaignConnectionScreen({
	phase,
	roomCode,
	message,
}: CampaignConnectionScreenProps) {
	const navigate = useNavigate();
	const copy = PHASE_COPY[phase];
	const isRetrying = phase === "retrying";

	return (
		<div className="relative h-screen w-screen overflow-hidden bg-base-200">
			<div className="pointer-events-none absolute inset-0 bg-linear-to-br from-base-100 to-base-200" />

			<div className="relative z-1 flex h-full flex-col items-center justify-center gap-5 p-8 text-center">
				<span
					className={`icon-[mdi--compass] h-16 w-16 animate-spin ${
						isRetrying ? "text-warning" : "text-primary"
					}`}
					aria-hidden="true"
				/>

				<div className="max-w-md space-y-2">
					<h2 className="text-2xl font-bold">{copy.title}</h2>
					<p className="text-base-content/70">{message ?? copy.body}</p>
				</div>

				{roomCode && (
					<div className="badge badge-outline gap-1 font-mono">
						<span className="icon-[mdi--key] h-3.5 w-3.5" />
						{roomCode}
					</div>
				)}

				{isRetrying && (
					<span
						className="loading loading-dots loading-sm text-warning"
						aria-label="Retrying"
					/>
				)}

				<button
					onClick={() => navigate("/campaigns")}
					className="btn btn-neutral gap-2"
				>
					<span className="icon-[mdi--arrow-left] h-5 w-5" />
					Leave Room
				</button>
			</div>
		</div>
	);
}
