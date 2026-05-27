import { Link } from "react-router-dom";
import { CATEGORY_STYLES, getPagePath, type WikiPageGroup } from "../WikiConfig";
import type { WikiPage } from "../pages/WikiPage";

interface WikiLibraryProps {
	groupedPages: WikiPageGroup[];
	visiblePage: WikiPage;
}

export function WikiLibrary({ groupedPages, visiblePage }: WikiLibraryProps) {
	return (
		<aside className="xl:sticky xl:top-20 xl:self-start">
			<nav className="overflow-hidden rounded-lg border border-base-300 bg-base-100 shadow-lg">
				<div className="bg-base-300 px-4 py-3">
					<div className="flex items-center gap-2 font-bold">
						<span className="icon-[mdi--bookshelf] h-5 w-5" />
						Library
					</div>
					<div className="mt-1 text-xs opacity-75">Grouped by workflow</div>
				</div>
				<div className="max-h-[calc(100vh-12rem)] overflow-y-auto p-3">
					{groupedPages.map((group) => {
						const style = CATEGORY_STYLES[group.category];
						return (
							<section key={group.category} className="mb-4 last:mb-0">
								<div
									className={`mb-2 flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-bold ${style.tintClass}`}
								>
									<span className={`${style.icon} h-4 w-4`} />
									{group.category}
								</div>
								<ul className="menu gap-1 p-0">
									{group.pages.map((wikiPage) => (
										<li key={wikiPage.slug || "overview"}>
											<Link
												to={getPagePath(wikiPage)}
												className={`min-h-11 px-3 py-2.5 text-base ${
													wikiPage.slug === visiblePage.slug ? "menu-active" : ""
												}`}
											>
												<span className={`${wikiPage.icon} h-5 w-5`} />
												<span>{wikiPage.title}</span>
											</Link>
										</li>
									))}
								</ul>
							</section>
						);
					})}
				</div>
			</nav>
		</aside>
	);
}
