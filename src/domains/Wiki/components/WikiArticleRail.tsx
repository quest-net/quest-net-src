import {
	CATEGORY_STYLES,
	getPageRoute,
	getTagClass,
} from "../WikiConfig";
import type { WikiPage } from "../pages/WikiPage";

interface WikiArticleRailProps {
	visiblePage: WikiPage;
}

export function WikiArticleRail({ visiblePage }: WikiArticleRailProps) {
	const categoryStyle = CATEGORY_STYLES[visiblePage.category];

	return (
		<aside className="hidden xl:block xl:sticky xl:top-20 xl:self-start">
			<div className="overflow-hidden rounded-lg border border-base-300 bg-base-100 shadow-lg">
				<div className="bg-neutral px-4 py-3 text-neutral-content">
					<div className="flex items-center gap-2 font-bold">
						<span className="icon-[mdi--format-list-bulleted-square] h-5 w-5" />
						Article Map
					</div>
					<div className="mt-1 text-xs text-neutral-content/70">
						Jump through the current page
					</div>
				</div>
				<nav className="p-3">
					<ul className="space-y-1 text-sm">
						{visiblePage.sections.map((section, index) => (
							<li key={section.id}>
								<button
									type="button"
									onClick={() =>
										document.getElementById(section.id)?.scrollIntoView({
											behavior: "smooth",
											block: "start",
										})
									}
									className={`flex w-full items-center gap-3 rounded-md py-2 text-left transition-colors hover:bg-base-200 ${
										(section.level ?? 0) > 0 ? "px-3 pl-8 text-xs" : "px-3"
									}`}
								>
									<span
										className={`rounded-full ${categoryStyle.tintClass} ${
											(section.level ?? 0) > 0 ? "h-1.5 w-1.5" : "h-2 w-2"
										}`}
									/>
									<span className="font-mono text-xs opacity-50">
										{String(index + 1).padStart(2, "0")}
									</span>
									<span>{section.title}</span>
								</button>
							</li>
						))}
					</ul>
				</nav>
			</div>

			<div className="mt-4 rounded-lg border border-base-300 bg-base-100 p-4 shadow-lg">
				<h2 className="mb-3 flex items-center gap-2 font-bold">
					<span className="icon-[mdi--information-outline] h-5 w-5 text-primary" />
					Page Signals
				</h2>
				<div className="space-y-3 text-sm">
					<div>
						<div className="mb-1 text-xs font-semibold uppercase opacity-50">
							Route
						</div>
						<code className="block rounded-md bg-base-200 px-3 py-2 font-mono text-xs">
							{getPageRoute(visiblePage)}
						</code>
					</div>
					<div>
						<div className="mb-1 text-xs font-semibold uppercase opacity-50">
							Keywords
						</div>
						<div className="flex flex-wrap gap-2">
							{visiblePage.tags.slice(0, 6).map((tag) => (
								<span key={tag} className={`badge ${getTagClass(tag)} badge-sm`}>
									{tag}
								</span>
							))}
						</div>
					</div>
				</div>
			</div>
		</aside>
	);
}
