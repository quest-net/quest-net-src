import type { ReactNode } from "react";

export type WikiAudience = "DM Guide" | "Developer";
export type WikiCategory = "Start Here" | "Run The Game" | "Worldbuilding" | "Technical";

export interface WikiSection {
	id: string;
	title: string;
	body: ReactNode;
	order?: number;
}

export interface WikiPage {
	slug: string;
	title: string;
	audience: WikiAudience;
	category: WikiCategory;
	summary: string;
	tags: string[];
	icon: string;
	sections: WikiSection[];
	searchText: string;
	order?: number;
}

export type WikiPageDefinition = Omit<WikiPage, "slug" | "sections"> & {
	slug?: string;
	sections?: WikiSection[];
};

export type WikiSectionDefinition = Omit<WikiSection, "id"> & {
	id?: string;
};
