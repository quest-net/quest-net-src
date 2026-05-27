import {
	CATEGORY_STYLES,
	getAudienceClass,
	getTagClass,
} from "../WikiConfig";
import type { WikiPage } from "../pages/WikiPage";

interface WikiArticleProps {
	pageExists: boolean;
	visiblePage: WikiPage;
}

export function WikiArticle({ pageExists, visiblePage }: WikiArticleProps) {
	const categoryStyle = CATEGORY_STYLES[visiblePage.category];

	return (
		<article className="overflow-hidden rounded-lg border border-base-300 bg-base-100 shadow-lg">
			<div className="border-b border-base-300 bg-base-100 px-5 py-6 sm:px-7">
				{pageExists ? (
					<>
						<div className="mb-4 flex flex-wrap items-center gap-2">
							<span className={`badge ${categoryStyle.labelClass} gap-1`}>
								<span className={`${categoryStyle.icon} h-3 w-3`} />
								{visiblePage.category}
							</span>
							<span className={`badge ${getAudienceClass(visiblePage.audience)}`}>
								{visiblePage.audience}
							</span>
						</div>
						<div className="flex flex-col gap-4 sm:flex-row sm:items-start">
							<div
								className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-lg border ${categoryStyle.tintClass}`}
							>
								<span className={`${visiblePage.icon} h-8 w-8`} />
							</div>
							<div className="min-w-0">
								<h1 className="text-4xl font-black">{visiblePage.title}</h1>
								<p className="mt-3 max-w-4xl text-lg opacity-75">
									{visiblePage.summary}
								</p>
							</div>
						</div>
						<div className="mt-5 flex flex-wrap gap-2">
							{visiblePage.tags.map((tag) => (
								<span key={tag} className={`badge ${getTagClass(tag)} badge-outline`}>
									{tag}
								</span>
							))}
						</div>
					</>
				) : (
					<>
						<div className="badge badge-error mb-3">Missing Page</div>
						<h1 className="text-4xl font-black">Wiki Page Not Found</h1>
						<p className="mt-3 max-w-3xl text-base opacity-75">
							The requested wiki page does not exist yet. Use search or the page
							list to choose an available topic.
						</p>
					</>
				)}
			</div>

			<div className="divide-y divide-base-300">
				{visiblePage.sections.map((section, index) => (
					<section
						key={section.id}
						id={section.id}
						className={`scroll-mt-24 border-l-4 px-5 py-7 sm:px-7 ${
							(section.level ?? 0) > 0
								? "ml-4 bg-base-200/35 sm:ml-7"
								: ""
						} ${categoryStyle.sectionClass}`}
					>
						<div className="mb-3 flex items-center gap-3">
							<span className="font-mono text-sm font-bold opacity-50">
								{String(index + 1).padStart(2, "0")}
							</span>
							<h2
								className={`font-black ${
									(section.level ?? 0) > 0 ? "text-xl" : "text-2xl"
								}`}
							>
								{section.title}
							</h2>
						</div>
						<div className="max-w-4xl text-base leading-8 opacity-90 [&_code]:rounded [&_code]:bg-base-content [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-sm [&_code]:font-semibold [&_code]:text-base-100">
							{section.body}
						</div>
					</section>
				))}
			</div>
		</article>
	);
}
