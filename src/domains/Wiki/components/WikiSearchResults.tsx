import { Link } from "react-router-dom";
import type { CategoryFilter } from "../WikiConfig";
import {
	CATEGORY_STYLES,
	getAudienceClass,
	getPagePath,
} from "../WikiConfig";
import type { WikiPage } from "../pages/WikiPage";

interface WikiSearchResultsProps {
	categoryFilter: CategoryFilter;
	query: string;
	results: WikiPage[];
	onClear: () => void;
}

export function WikiSearchResults({
	categoryFilter,
	query,
	results,
	onClear,
}: WikiSearchResultsProps) {
	if (!query.trim() && categoryFilter === "All") return null;

	return (
		<section className="rounded-lg border border-base-300 bg-base-100 p-4 shadow-md">
			<div className="mb-3 flex flex-wrap items-center justify-between gap-3">
				<div>
					<h2 className="text-lg font-bold">Search Results</h2>
					<p className="text-sm opacity-70">
						{results.length} page{results.length === 1 ? "" : "s"} match the
						current filter.
					</p>
				</div>
				<button type="button" onClick={onClear} className="btn btn-ghost btn-sm gap-2">
					<span className="icon-[mdi--filter-remove-outline] h-4 w-4" />
					Clear
				</button>
			</div>

			{results.length === 0 ? (
				<div className="rounded-lg border border-dashed border-base-300 bg-base-200 p-6 text-center">
					<span className="icon-[mdi--file-search-outline] mx-auto mb-2 h-8 w-8 opacity-70" />
					<p className="font-semibold">No matching wiki pages yet.</p>
					<p className="text-sm opacity-70">
						Try a broader term or choose a different category.
					</p>
				</div>
			) : (
				<div className="grid gap-3 md:grid-cols-2">
					{results.map((result) => {
						const style = CATEGORY_STYLES[result.category];
						return (
							<Link
								key={result.slug || "overview-result"}
								to={getPagePath(result)}
								className="group rounded-lg border border-base-300 bg-base-200 p-4 transition-all hover:border-primary hover:bg-base-100 hover:shadow-md"
							>
								<div className="mb-3 flex flex-wrap items-center gap-2">
									<span className={`badge ${style.labelClass}`}>
										{result.category}
									</span>
									<span className={`badge ${getAudienceClass(result.audience)}`}>
										{result.audience}
									</span>
								</div>
								<div className="flex items-start gap-3">
									<span className={`${result.icon} mt-1 h-5 w-5 text-primary`} />
									<div className="min-w-0">
										<h3 className="font-bold group-hover:text-primary">
											{result.title}
										</h3>
										<p className="mt-1 text-sm opacity-70">{result.summary}</p>
									</div>
								</div>
							</Link>
						);
					})}
				</div>
			)}
		</section>
	);
}
