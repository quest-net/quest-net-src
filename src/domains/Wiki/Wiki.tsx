import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import {
	type CategoryFilter,
	RECENT_WIKI_PAGES_KEY,
	groupWikiPages,
	searchWikiPages,
} from "./WikiConfig";
import { WikiArticle } from "./components/WikiArticle";
import { WikiArticleRail } from "./components/WikiArticleRail";
import { WikiHeader } from "./components/WikiHeader";
import { WikiHero } from "./components/WikiHero";
import { WikiLibrary } from "./components/WikiLibrary";
import { WikiSearchResults } from "./components/WikiSearchResults";
import { WIKI_PAGES, getWikiPageBySlug } from "./pages";
import type { WikiPage } from "./pages/WikiPage";

function getSlugFromPath(pathname: string): string {
	return pathname.replace(/^\/wiki\/?/, "").replace(/\/+$/g, "");
}

function getStoredRecentSlugs(): string[] {
	try {
		const raw = localStorage.getItem(RECENT_WIKI_PAGES_KEY);
		return raw ? (JSON.parse(raw) as string[]) : [];
	} catch {
		return [];
	}
}

export function Wiki() {
	const location = useLocation();
	const slug = getSlugFromPath(location.pathname);
	const page = getWikiPageBySlug(slug) ?? null;
	const visiblePage = page ?? getWikiPageBySlug("") ?? WIKI_PAGES[0];
	const [query, setQuery] = useState("");
	const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("All");
	const [recentSlugs, setRecentSlugs] = useState<string[]>(getStoredRecentSlugs);

	const groupedPages = useMemo(() => groupWikiPages(WIKI_PAGES), []);
	const searchResults = useMemo(
		() => searchWikiPages(WIKI_PAGES, query, categoryFilter),
		[categoryFilter, query]
	);
	const recentPages = useMemo(
		() =>
			recentSlugs
				.map((recentSlug) => getWikiPageBySlug(recentSlug))
				.filter((wikiPage): wikiPage is WikiPage => !!wikiPage),
		[recentSlugs]
	);
	const recentFallbackPages = useMemo(
		() =>
			WIKI_PAGES.filter((wikiPage) =>
				["getting-started", "terrains"].includes(wikiPage.slug)
			),
		[]
	);
	const pagesForRecentShelf =
		recentPages.length > 0 ? recentPages : recentFallbackPages;

	useEffect(() => {
		setRecentSlugs((currentSlugs) => {
			const nextSlugs = [
				visiblePage.slug,
				...currentSlugs.filter((recentSlug) => recentSlug !== visiblePage.slug),
			].slice(0, 3);
			localStorage.setItem(RECENT_WIKI_PAGES_KEY, JSON.stringify(nextSlugs));
			return nextSlugs;
		});
	}, [visiblePage.slug]);

	return (
		<div className="min-h-screen bg-base-200 text-base-content">
			<WikiHeader />
			<WikiHero
				categoryFilter={categoryFilter}
				groupedPages={groupedPages}
				pagesForRecentShelf={pagesForRecentShelf}
				query={query}
				recentPages={recentPages}
				onCategoryFilterChange={setCategoryFilter}
				onQueryChange={setQuery}
			/>

			<main className="mx-auto grid max-w-[96rem] grid-cols-1 gap-5 px-4 py-5 xl:grid-cols-[20rem_minmax(0,1fr)_18rem]">
				<WikiLibrary groupedPages={groupedPages} visiblePage={visiblePage} />
				<div className="min-w-0 space-y-5">
					<WikiSearchResults
						categoryFilter={categoryFilter}
						query={query}
						results={searchResults}
						onClear={() => {
							setQuery("");
							setCategoryFilter("All");
						}}
					/>
					<WikiArticle pageExists={!!page} visiblePage={visiblePage} />
				</div>
				<WikiArticleRail visiblePage={visiblePage} />
			</main>
		</div>
	);
}
