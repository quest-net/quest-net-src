// utils/ThemeUtils.ts

import { useState, useEffect } from "react";

export type ThemeColorName =
	| "primary"
	| "primary-content"
	| "secondary"
	| "secondary-content"
	| "accent"
	| "accent-content"
	| "neutral"
	| "neutral-content"
	| "base-100"
	| "base-200"
	| "base-300"
	| "base-content"
	| "info"
	| "success"
	| "warning"
	| "error";

// One reusable 1x1 canvas: assigning any CSS color the browser understands to
// fillStyle and reading the painted pixel back is the platform's own color
// parser, so DaisyUI's oklch() theme values resolve (and gamut-clamp) to sRGB
// without a color library or hand-rolled hex/rgb parsing.
let probe: CanvasRenderingContext2D | null = null;

function cssColorToHex(cssColor: string): string {
	probe ??= document.createElement("canvas").getContext("2d", {
		willReadFrequently: true,
	});
	if (!probe) return "#000000";
	// An unparseable value leaves fillStyle untouched, so seed the fallback first.
	probe.fillStyle = "#000000";
	probe.fillStyle = cssColor;
	probe.fillRect(0, 0, 1, 1);
	const [r, g, b] = probe.getImageData(0, 0, 1, 1).data;
	return `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

/** The current theme's value for one DaisyUI color, as "#rrggbb". */
function getThemeColor(colorName: ThemeColorName): string {
	const computedValue = getComputedStyle(document.documentElement)
		.getPropertyValue(`--color-${colorName}`)
		.trim();

	if (!computedValue) {
		console.warn(`Theme color not found: ${colorName}`);
		return "#000000";
	}

	return cssColorToHex(computedValue);
}

function getThemeColors(
	colorNames: ThemeColorName[]
): Record<ThemeColorName, string> {
	const result = {} as Record<ThemeColorName, string>;
	for (const name of colorNames) {
		result[name] = getThemeColor(name);
	}
	return result;
}

/**
 * Hook to reactively get theme colors as hex strings.
 * Returns colors and updates when the theme changes.
 */
export function useThemeColors(
	...colorNames: ThemeColorName[]
): Record<ThemeColorName, string> {
	const [colors, setColors] = useState(() => getThemeColors(colorNames));

	useEffect(() => {
		const updateColors = () => {
			setColors(getThemeColors(colorNames));
		};

		// Listen for theme changes
		const observer = new MutationObserver(updateColors);
		observer.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ["data-theme"],
		});

		return () => observer.disconnect();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [colorNames.join(",")]);

	return colors;
}
