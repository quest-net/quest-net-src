import { Link } from "react-router-dom";
import type { CategoryFilter, WikiPageGroup } from "../WikiConfig";
import {
	CATEGORY_STYLES,
	WIKI_HERO_BODY,
	WIKI_HERO_TITLE,
	getPagePath,
} from "../WikiConfig";
import type { WikiPage } from "../pages/WikiPage";
import { WikiHalftone } from "./WikiHalftone";

interface WikiHeroProps {
	categoryFilter: CategoryFilter;
	groupedPages: WikiPageGroup[];
	pagesForRecentShelf: WikiPage[];
	query: string;
	recentPages: WikiPage[];
	onCategoryFilterChange: (category: CategoryFilter) => void;
	onQueryChange: (query: string) => void;
}

export function WikiHero({
	categoryFilter,
	groupedPages,
	pagesForRecentShelf,
	query,
	recentPages,
	onCategoryFilterChange,
	onQueryChange,
}: WikiHeroProps) {
	return (
		<section className="wiki-halftone border-b border-base-300 bg-neutral text-neutral-content">
			<WikiHalftone />
			<div className="mx-auto grid max-w-[96rem] gap-6 px-4 py-8 lg:grid-cols-[minmax(0,1fr)_22rem] lg:py-10">
				<div className="min-w-0">
					<div className="mb-4 flex flex-wrap items-center gap-2">
						<span className="badge badge-primary gap-1">
							<span className="icon-[mdi--sparkles] h-3 w-3" />
							Quest-Net Docs
						</span>
					</div>
					<h1 className="max-w-4xl text-4xl font-black sm:text-5xl">
						{WIKI_HERO_TITLE}
					</h1>
					<p className="mt-4 max-w-3xl text-lg text-neutral-content opacity-70">
						{WIKI_HERO_BODY}
					</p>

					<div className="mt-7 max-w-4xl">
						<div className="relative">
							<span className="icon-[mdi--magnify] pointer-events-none absolute left-4 top-1/2 h-6 w-6 -translate-y-1/2 text-primary" />
							<input
								type="search"
								value={query}
								onChange={(event) => onQueryChange(event.target.value)}
								placeholder="Search terrain, room codes, data structures, materials..."
								className="input input-lg w-full border-neutral-content/20 bg-base-100 pl-12 pr-12 text-base-content shadow-xl"
							/>
							{query && (
								<button
									type="button"
									onClick={() => onQueryChange("")}
									className="btn btn-ghost btn-sm btn-square absolute right-2 top-1/2 -translate-y-1/2 text-base-content"
									aria-label="Clear search"
								>
									<span className="icon-[mdi--close] h-5 w-5" />
								</button>
							)}
						</div>

						<div className="mt-3 flex flex-wrap gap-2">
							<button
								type="button"
								onClick={() => onCategoryFilterChange("All")}
								className={`btn btn-sm ${
									categoryFilter === "All" ? "btn-neutral" : ""
								}`}
							>
								All
							</button>
							{groupedPages.map((group) => {
								const style = CATEGORY_STYLES[group.category];
								return (
									<button
										key={group.category}
										type="button"
										onClick={() => onCategoryFilterChange(group.category)}
										className={`btn btn-sm gap-2 ${
											categoryFilter === group.category
												? style.buttonClass
												: ""
										}`}
									>
										<span className={`${style.icon} h-4 w-4`} />
										{group.category}
									</button>
								);
							})}
						</div>
					</div>
				</div>

				<div className="rounded-lg border border-neutral/30 bg-neutral-content/70 p-4 text-neutral shadow-xl backdrop-blur-sm">
					<div className="mb-3 flex items-center justify-between gap-3">
						<div>
							<div className="flex items-center gap-2 font-bold">
								<span className="icon-[mdi--history] h-5 w-5 text-primary" />
								Recently Visited
							</div>
							<div className="mt-1 text-xs opacity-70">
								Your last wiki trails on this device
							</div>
						</div>
						{recentPages.length === 0 && (
							<span className="badge badge-outline border-neutral/30 text-neutral">
								Starter picks
							</span>
						)}
					</div>
					<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
						{pagesForRecentShelf.map((recentPage) => {
							const style = CATEGORY_STYLES[recentPage.category];
							return (
								<Link
									key={recentPage.slug || "overview-recent"}
									to={getPagePath(recentPage)}
									className="group rounded-lg border border-neutral/15 bg-neutral/8 p-4 transition-colors hover:border-primary hover:bg-neutral/12"
								>
									<div className="mb-3 flex items-center gap-2">
										<span className={`${style.icon} h-5 w-5 text-primary`} />
										<span className="text-sm font-semibold">
											{recentPage.category}
										</span>
									</div>
									<div className="font-bold">{recentPage.title}</div>
									<p className="mt-1 text-sm opacity-70">
										{recentPage.summary}
									</p>
								</Link>
							);
						})}
					</div>
				</div>
			</div>
		</section>
	);
}
