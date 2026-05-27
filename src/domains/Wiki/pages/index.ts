import { CATEGORY_ORDER } from "../WikiConfig";
import type {
	WikiPage,
	WikiPageDefinition,
	WikiSection,
	WikiSectionDefinition,
} from "./WikiPage";

interface WikiPageModule {
	default: WikiPageDefinition;
}

interface WikiSectionModule {
	default: WikiSectionDefinition;
}

const pageModules = import.meta.glob<WikiPageModule>(
	["./**/*.tsx", "!./**/sections/*.tsx"],
	{ eager: true }
) as Record<string, WikiPageModule>;
const sectionModules = import.meta.glob<WikiSectionModule>("./**/sections/*.tsx", {
	eager: true,
}) as Record<string, WikiSectionModule>;

function toKebab(value: string): string {
	return value
		.replace(/([a-z0-9])([A-Z])/g, "$1-$2")
		.replace(/[\s_]+/g, "-")
		.toLowerCase();
}

function derivePageSlug(path: string): string {
	const parts = path
		.replace(/^\.\//, "")
		.replace(/\.tsx$/, "")
		.split("/");
	const last = parts[parts.length - 1]?.toLowerCase();

	if (last === "page" || last === "index") {
		parts.pop();
	}

	if (parts.length === 1 && parts[0].toLowerCase() === "overview") {
		return "";
	}

	return parts.map(toKebab).join("/");
}

function deriveSectionPageSlug(path: string): string {
	const pagePath = path.replace(/^\.\//, "").split("/sections/")[0];
	return pagePath.toLowerCase() === "overview"
		? ""
		: pagePath.split("/").map(toKebab).join("/");
}

function deriveSectionId(path: string): string {
	const fileName = path.split("/").pop()?.replace(/\.tsx$/, "") ?? "section";
	return toKebab(fileName);
}

function sortSections(sections: WikiSection[]): WikiSection[] {
	return [...sections].sort(
		(a, b) => (a.order ?? 500) - (b.order ?? 500) || a.title.localeCompare(b.title)
	);
}

function sortPages(pages: WikiPage[]): WikiPage[] {
	return [...pages].sort((a, b) => {
		const categorySort =
			CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category);
		if (categorySort !== 0) return categorySort;

		return (
			(a.order ?? (a.slug === "" ? -100 : 500)) -
				(b.order ?? (b.slug === "" ? -100 : 500)) ||
			a.title.localeCompare(b.title)
		);
	});
}

const sectionsBySlug = Object.entries(sectionModules).reduce<
	Record<string, WikiSection[]>
>((groups, [path, module]) => {
	const pageSlug = deriveSectionPageSlug(path);
	const section = module.default;
	const normalizedSection: WikiSection = {
		id: section.id ?? deriveSectionId(path),
		title: section.title,
		body: section.body,
		order: section.order,
	};

	return {
		...groups,
		[pageSlug]: [...(groups[pageSlug] ?? []), normalizedSection],
	};
}, {});

export const WIKI_PAGES: WikiPage[] = sortPages(
	Object.entries(pageModules).map(([path, module]) => {
		const definition = module.default;
		const slug = definition.slug ?? derivePageSlug(path);
		const sections = [
			...(definition.sections ?? []).map((section: WikiSection, index: number) => ({
				...section,
				order: section.order ?? index,
			})),
			...(sectionsBySlug[slug] ?? []),
		];

		return {
			...definition,
			slug,
			sections: sortSections(sections),
		};
	})
);

export function getWikiPageBySlug(slug: string): WikiPage | undefined {
	const normalized = slug.replace(/^\/+|\/+$/g, "");
	return WIKI_PAGES.find((page) => page.slug === normalized);
}
