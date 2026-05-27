import type { WikiPage } from "./WikiPage";

export const overviewPage: WikiPage = {
	slug: "",
	title: "Quest-Net Wiki",
	audience: "DM Guide",
	category: "Start Here",
	summary: "Start here for the user-facing and technical Quest-Net documentation.",
	tags: ["home", "navigation", "dm", "developer"],
	icon: "icon-[mdi--book-open-page-variant]",
	sections: [
		{
			id: "purpose",
			title: "What This Wiki Covers",
			body: (
				<p>
					This wiki is the long-term home for Quest-Net guidance. DM pages explain
					how to run sessions in the app. Developer pages explain how campaign data,
					terrain, networking, and UI domains are organized.
				</p>
			),
		},
		{
			id: "routes",
			title: "Wiki Routes",
			body: (
				<p>
					Each page has a stable hash route, such as{" "}
					<code className="font-mono">/#/wiki/terrains/</code> or{" "}
					<code className="font-mono">/#/wiki/materials/</code>. The route names are
					kept separate from campaign room codes.
				</p>
			),
		},
		{
			id: "adding-pages",
			title: "Adding Pages",
			body: (
				<p>
					New pages live in <code className="font-mono">src/domains/Wiki/pages</code>.
					Add a page definition there, then register it in the page index so it
					appears in search, navigation, and route resolution.
				</p>
			),
		},
	],
	searchText:
		"wiki start home documentation dm guide developer technical routes navigation search pages",
};

export default overviewPage;
