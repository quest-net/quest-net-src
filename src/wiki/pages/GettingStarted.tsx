import type { WikiPage } from "./WikiPage";

export const gettingStartedPage: WikiPage = {
	slug: "getting-started",
	title: "Getting Started",
	audience: "DM Guide",
	category: "Start Here",
	summary: "A first-pass guide for DMs preparing and running a Quest-Net campaign.",
	tags: ["campaign", "room code", "dm", "player"],
	icon: "icon-[mdi--compass-outline]",
	sections: [
		{
			id: "create-campaign",
			title: "Create A Campaign",
			body: (
				<p>
					From the home screen, open campaigns, name the campaign, and either choose
					a short room code or let Quest-Net generate one. The DM opens the campaign
					with the private campaign ID, while players join through the public room code.
				</p>
			),
		},
		{
			id: "invite-players",
			title: "Invite Players",
			body: (
				<p>
					Share the room code with players after the campaign is ready. Player routes
					load a sanitized campaign view and receive state from the DM during the
					session.
				</p>
			),
		},
		{
			id: "run-session",
			title: "Run A Session",
			body: (
				<p>
					Use the main campaign view to manage characters, entities, terrain, scenes,
					combat, dice, logs, and audio. The DM is the authority for mutations and
					broadcasts the approved campaign state to connected players.
				</p>
			),
		},
	],
	searchText:
		"getting started create campaign room code invite players dm route player route session",
};

export default gettingStartedPage;
