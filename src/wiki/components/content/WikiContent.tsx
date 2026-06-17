import type { ReactNode } from "react";
import { Link } from "react-router-dom";

export type WikiTone =
	| "primary"
	| "secondary"
	| "accent"
	| "info"
	| "success"
	| "warning"
	| "error"
	| "neutral";

const borderToneClass: Record<WikiTone, string> = {
	primary: "border-primary/40",
	secondary: "border-secondary/40",
	accent: "border-accent/40",
	info: "border-info/40",
	success: "border-success/40",
	warning: "border-warning/50",
	error: "border-error/40",
	neutral: "border-neutral/30",
};

const borderLeftToneClass: Record<WikiTone, string> = {
	primary: "border-l-primary",
	secondary: "border-l-secondary",
	accent: "border-l-accent",
	info: "border-l-info",
	success: "border-l-success",
	warning: "border-l-warning",
	error: "border-l-error",
	neutral: "border-l-neutral",
};

const subtleToneClass: Record<WikiTone, string> = {
	primary: "bg-primary/10",
	secondary: "bg-secondary/10",
	accent: "bg-accent/10",
	info: "bg-info/10",
	success: "bg-success/10",
	warning: "bg-warning/10",
	error: "bg-error/10",
	neutral: "bg-neutral/10",
};

const solidToneClass: Record<WikiTone, string> = {
	primary: "bg-primary text-primary-content",
	secondary: "bg-secondary text-secondary-content",
	accent: "bg-accent text-accent-content",
	info: "bg-info text-info-content",
	success: "bg-success text-success-content",
	warning: "bg-warning text-warning-content",
	error: "bg-error text-error-content",
	neutral: "bg-neutral text-neutral-content",
};

const textToneClass: Record<WikiTone, string> = {
	primary: "text-primary",
	secondary: "text-secondary",
	accent: "text-accent",
	info: "text-info",
	success: "text-success",
	warning: "text-warning",
	error: "text-error",
	neutral: "text-neutral",
};

export function WikiCode({ children }: { children: ReactNode }) {
	return (
		<code className="rounded bg-base-content px-1.5 py-0.5 font-mono text-sm font-semibold text-base-100">
			{children}
		</code>
	);
}

export function WikiPageLink({
	slug,
	children,
}: {
	slug: string;
	children: ReactNode;
}) {
	const to = slug ? `/wiki/${slug}/` : "/wiki/";

	return (
		<Link className="link link-primary font-bold" to={to}>
			{children}
		</Link>
	);
}

export function WikiHighlight({
	children,
	tone = "accent",
}: {
	children: ReactNode;
	tone?: WikiTone;
}) {
	return (
		<strong className={`rounded px-1.5 py-0.5 font-black ${solidToneClass[tone]}`}>
			{children}
		</strong>
	);
}

export function WikiCallout({
	tone = "info",
	title,
	children,
}: {
	tone?: WikiTone;
	title: string;
	children: ReactNode;
}) {
	return (
		<div
			className={`my-4 rounded-lg border p-4 text-base-content ${borderToneClass[tone]} ${subtleToneClass[tone]}`}
		>
			<div
				className={`mb-1 text-sm font-black uppercase tracking-wide ${textToneClass[tone]}`}
			>
				{title}
			</div>
			<div className="space-y-2">{children}</div>
		</div>
	);
}

export function WikiCardGrid({
	items,
	columns = 3,
}: {
	items: { title: ReactNode; body: ReactNode; tone?: WikiTone }[];
	columns?: 2 | 3;
}) {
	const columnClass = columns === 2 ? "md:grid-cols-2" : "md:grid-cols-3";

	return (
		<div className={`grid gap-3 ${columnClass}`}>
			{items.map((item, index) => {
				const tone = item.tone ?? "neutral";
				return (
					<div
						key={index}
						className={`rounded-lg border bg-base-100/80 p-3 ${borderToneClass[tone]}`}
					>
						<div className={`font-black ${textToneClass[tone]}`}>{item.title}</div>
						<div className="mt-1 text-sm leading-6">{item.body}</div>
					</div>
				);
			})}
		</div>
	);
}

export function WikiFieldGrid({
	items,
	columns = 2,
}: {
	items: { name: string; detail: ReactNode; tone?: WikiTone }[];
	columns?: 1 | 2;
}) {
	const columnClass = columns === 1 ? "" : "md:grid-cols-2";

	return (
		<div className={`my-4 grid gap-3 ${columnClass}`}>
			{items.map((item) => {
				const tone = item.tone ?? "neutral";
				return (
					<div
						key={item.name}
						className={`rounded-lg border border-base-300 bg-base-200/60 p-4 border-l-4 ${borderLeftToneClass[tone]}`}
					>
						<div className="mb-1 font-mono text-sm font-black">{item.name}</div>
						<div className="text-sm leading-6 opacity-70">{item.detail}</div>
					</div>
				);
			})}
		</div>
	);
}

export function WikiFlow({ children }: { children: ReactNode }) {
	return <div className="grid gap-3">{children}</div>;
}

export function WikiFlowStep({
	number,
	title,
	children,
	tone = "accent",
}: {
	number: string;
	title: string;
	children: ReactNode;
	tone?: WikiTone;
}) {
	return (
		<div className="flex gap-3 rounded-lg border border-base-300 bg-base-200/70 p-4">
			<div
				className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sm font-black ${solidToneClass[tone]}`}
			>
				{number}
			</div>
			<div>
				<div className="font-black">{title}</div>
				<div className="mt-1 text-sm leading-6 opacity-70">{children}</div>
			</div>
		</div>
	);
}

export function WikiDiagram({
	title,
	children,
}: {
	title?: string;
	children: ReactNode;
}) {
	return (
		<div className="my-4 rounded-lg border border-base-300 bg-base-200/70 p-4">
			{title && <div className="mb-3 font-black text-secondary">{title}</div>}
			{children}
		</div>
	);
}

export function WikiDiagramNode({
	title,
	children,
	tone = "neutral",
}: {
	title: ReactNode;
	children: ReactNode;
	tone?: WikiTone;
}) {
	return (
		<div
			className={`rounded-lg border bg-base-100/80 p-3 ${borderToneClass[tone]}`}
		>
			<div className={`font-black ${textToneClass[tone]}`}>{title}</div>
			<div className="mt-1 text-sm leading-6">{children}</div>
		</div>
	);
}
