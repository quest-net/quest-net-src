// utils/ThemeUtils.ts

import { useState, useEffect } from 'react';
import Color from "colorjs.io";

/**
 * Parses a CSS color value and converts to RGB
 */
function parseColorValue(value: string): [number, number, number] {
	const trimmed = value.trim();
  
	// 1) Hex first (#rgb, #rrggbb)
	if (trimmed.startsWith("#")) {
	  const hex = trimmed.slice(1);
	  let r: number, g: number, b: number;
  
	  if (hex.length === 3) {
		r = parseInt(hex[0] + hex[0], 16);
		g = parseInt(hex[1] + hex[1], 16);
		b = parseInt(hex[2] + hex[2], 16);
	  } else {
		r = parseInt(hex.slice(0, 2), 16);
		g = parseInt(hex.slice(2, 4), 16);
		b = parseInt(hex.slice(4, 6), 16);
	  }
  
	  return [r, g, b];
	}
  
	// 2) Raw rgb/rgba
	if (trimmed.startsWith("rgb")) {
	  const match = trimmed.match(/rgba?\(([0-9.]+)[,\s]+([0-9.]+)[,\s]+([0-9.]+)/i);
	  if (match) {
		return [
		  parseFloat(match[1]),
		  parseFloat(match[2]),
		  parseFloat(match[3]),
		];
	  }
	}
  
	// 3) Everything else (oklch, lch, hsl, etc) → let Color.js handle it
	try {
	  const c = new Color(trimmed); // Color will parse OKLCH, LCH, etc.
	  const srgb = c.to("srgb");    // convert to sRGB
	  const [r, g, b] = srgb.coords; // 0–1 floats
  
	  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
	} catch (err) {
	  console.warn(`Could not parse color via Color.js: ${value}`, err);
	  return [0, 0, 0];
	}
  }

export type ThemeColorName =
	| 'primary'
	| 'primary-content'
	| 'secondary'
	| 'secondary-content'
	| 'accent'
	| 'accent-content'
	| 'neutral'
	| 'neutral-content'
	| 'base-100'
	| 'base-200'
	| 'base-300'
	| 'base-content'
	| 'info'
	| 'success'
	| 'warning'
	| 'error';

export interface ThemeColor {
	hex: string;
	rgb: [number, number, number]; // 0-255
	rgbNormalized: [number, number, number]; // 0-1
}

/**
 * Gets a theme color in multiple formats
 */
export function getThemeColor(colorName: ThemeColorName): ThemeColor {
	const cssVarName = `--color-${colorName}`;
	const computedValue = getComputedStyle(document.documentElement)
		.getPropertyValue(cssVarName)
		.trim();
	
	if (!computedValue) {
		console.warn(`Theme color not found: ${colorName}`);
		return {
			hex: '#000000',
			rgb: [0, 0, 0],
			rgbNormalized: [0, 0, 0],
		};
	}
	
	const [r, g, b] = parseColorValue(computedValue);
	
	// Convert to hex
	const toHex = (n: number) => Math.round(n).toString(16).padStart(2, '0');
	const hex = `#${toHex(r)}${toHex(g)}${toHex(b)}`;
	
	return {
		hex,
		rgb: [Math.round(r), Math.round(g), Math.round(b)],
		rgbNormalized: [r / 255, g / 255, b / 255],
	};
}

/**
 * Gets multiple theme colors at once
 */
export function getThemeColors(...colorNames: ThemeColorName[]): Record<string, ThemeColor> {
	const result: Record<string, ThemeColor> = {};
	
	for (const name of colorNames) {
		result[name] = getThemeColor(name);
	}
	
	return result;
}

/**
 * Hook to reactively get theme colors
 * Returns colors and updates when theme changes
 */
export function useThemeColors(...colorNames: ThemeColorName[]): Record<string, ThemeColor> {
	const [colors, setColors] = useState(() => getThemeColors(...colorNames));
	
	useEffect(() => {
		const updateColors = () => {
			setColors(getThemeColors(...colorNames));
		};
		
		// Listen for theme changes
		const observer = new MutationObserver(updateColors);
		observer.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ['data-theme'],
		});
		
		return () => observer.disconnect();
	}, [colorNames.join(',')]);
	
	return colors;
}