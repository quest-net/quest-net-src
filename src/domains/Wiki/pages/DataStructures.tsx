import type { WikiPage } from "./WikiPage";

export const dataStructuresPage: WikiPage = {
	slug: "data-structures",
	title: "Data Structures",
	audience: "Developer",
	category: "Technical",
	summary: "A developer map of the global context, campaign payload, and core domains.",
	tags: ["context", "campaign", "state", "actions", "schema"],
	icon: "icon-[mdi--database-outline]",
	sections: [
		{
			id: "context",
			title: "Context",
			body: (
				<p>
					The global context holds the current user, lightweight campaign metadata,
					the active unpacked campaign, app settings, version data, optimistic state,
					and optional secret-mode flags.
				</p>
			),
		},
		{
			id: "campaign",
			title: "Campaign",
			body: (
				<p>
					A campaign is the root game payload. It owns roster data, templates, game
					state, settings, logs, terrain references, image metadata, audio, scenes,
					scenarios, and shared inventories.
				</p>
			),
		},
		{
			id: "actions",
			title: "Actions",
			body: (
				<p>
					State mutations flow through the action registry. The DM applies validated
					actions locally and broadcasts authoritative updates, while players send
					action requests to the DM.
				</p>
			),
		},
	],
	searchText:
		"context campaign state actions schema action registry dm authority player request localStorage indexeddb",
};

export default dataStructuresPage;
