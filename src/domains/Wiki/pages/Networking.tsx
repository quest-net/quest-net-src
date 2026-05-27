import type { WikiPage } from "./WikiPage";

export const networkingPage: WikiPage = {
	slug: "networking",
	title: "Networking",
	audience: "Developer",
	category: "Technical",
	summary: "How Quest-Net synchronizes campaign state between DM and players.",
	tags: ["trystero", "webrtc", "nostr", "sync", "actions"],
	icon: "icon-[mdi--access-point-network]",
	sections: [
		{
			id: "authority",
			title: "DM Authority",
			body: (
				<p>
					The DM owns the canonical campaign state. Players may apply optimistic UI
					updates, but the DM broadcast is the source of truth after validation.
				</p>
			),
		},
		{
			id: "channels",
			title: "Channels",
			body: (
				<p>
					Quest-Net uses Trystero channels for action requests, state sync, image
					transfer, image creation, actor pose updates, and user metadata repair.
				</p>
			),
		},
		{
			id: "sync",
			title: "State Sync",
			body: (
				<p>
					State sync prefers delta patches with compression and falls back to full
					state updates when peers need repair. Player-facing state replaces the DM
					campaign ID with the public room code.
				</p>
			),
		},
	],
	searchText:
		"networking trystero webrtc nostr state sync delta patch full state action request user metadata relay room code dm authority",
};

export default networkingPage;
