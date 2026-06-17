import type { WikiCategory, WikiPage } from "./pages/WikiPage";

export type CategoryFilter = WikiCategory | "All";

export const RECENT_WIKI_PAGES_KEY = "quest-net:wiki:recent-pages";

export const WIKI_HERO_TITLE = "Pack the notes. Light the torches.";

export const WIKI_HERO_BODY =
	"Guides for running the table, shaping strange places, and peeking behind the curtain.";

export const CATEGORY_ORDER: WikiCategory[] = [
	"Start Here",
	"Run The Game",
	"Worldbuilding",
	"Technical",
];

export const CATEGORY_STYLES: Record<
	WikiCategory,
	{
		icon: string;
		labelClass: string;
		tintClass: string;
		buttonClass: string;
		sectionClass: string;
	}
> = {
	"Start Here": {
		icon: "icon-[mdi--map-marker-star-outline]",
		labelClass: "badge-primary",
		tintClass: "bg-primary/10 text-primary border-primary/30",
		buttonClass: "btn-primary",
		sectionClass: "border-l-primary",
	},
	"Run The Game": {
		icon: "icon-[game-icons--dice-twenty-faces-twenty]",
		labelClass: "badge-secondary",
		tintClass: "bg-secondary/10 text-secondary border-secondary/30",
		buttonClass: "btn-secondary",
		sectionClass: "border-l-secondary",
	},
	Worldbuilding: {
		icon: "icon-[mdi--terrain]",
		labelClass: "badge-success",
		tintClass: "bg-success/10 text-success border-success/30",
		buttonClass: "btn-success",
		sectionClass: "border-l-success",
	},
	Technical: {
		icon: "icon-[mdi--code-braces]",
		labelClass: "badge-accent",
		tintClass: "bg-accent/10 text-accent border-accent/30",
		buttonClass: "btn-accent",
		sectionClass: "border-l-accent",
	},
};

export interface WikiPageGroup {
	category: WikiCategory;
	pages: WikiPage[];
}

const TAG_CLASSES = [
	"badge-primary",
	"badge-secondary",
	"badge-accent",
	"badge-info",
	"badge-success",
	"badge-warning",
];

export function getPagePath(page: WikiPage): string {
	return page.slug ? `/wiki/${page.slug}/` : "/wiki/";
}

export function getPageRoute(page: WikiPage): string {
	return page.slug ? `/#/wiki/${page.slug}/` : "/#/wiki/";
}

export function getAudienceClass(audience: WikiPage["audience"]): string {
	return audience === "Developer" ? "badge-accent" : "badge-primary";
}

export function getTagClass(tag: string): string {
	const sum = tag.split("").reduce((total, char) => total + char.charCodeAt(0), 0);
	return TAG_CLASSES[sum % TAG_CLASSES.length];
}

export function groupWikiPages(pages: WikiPage[]): WikiPageGroup[] {
	return CATEGORY_ORDER.map((category) => ({
		category,
		pages: pages.filter((wikiPage) => wikiPage.category === category),
	})).filter((group) => group.pages.length > 0);
}

export function searchWikiPages(
	pages: WikiPage[],
	query: string,
	categoryFilter: CategoryFilter
): WikiPage[] {
	const normalizedQuery = query.trim().toLowerCase();
	const terms = normalizedQuery.split(/\s+/).filter(Boolean);

	return pages.filter((wikiPage) => {
		if (categoryFilter !== "All" && wikiPage.category !== categoryFilter) {
			return false;
		}

		if (!normalizedQuery) return true;

		const haystack = [
			wikiPage.title,
			wikiPage.summary,
			wikiPage.audience,
			wikiPage.category,
			wikiPage.tags.join(" "),
			wikiPage.searchText,
			wikiPage.sections.map((section) => section.title).join(" "),
		]
			.join(" ")
			.toLowerCase();

		return terms.every((term) => haystack.includes(term));
	});
}
