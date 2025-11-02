// utils/ThemeUtils.ts

import { useState, useEffect } from 'react';

/**
 * Converts OKLCH color string to RGB values
 * OKLCH format: oklch(L C H) where L is 0-1, C is 0-0.4, H is 0-360
 */
function oklchToRgb(l: number, c: number, h: number): [number, number, number] {
	// Convert OKLCH to RGB (simplified conversion)
	// This is an approximation - for production, consider using a color library
	const hRad = (h * Math.PI) / 180;
	
	// Convert to Lab
	const a = c * Math.cos(hRad);
	const b = c * Math.sin(hRad);
	
	// Lab to XYZ (D65 illuminant)
	const fy = (l + 0.16) / 1.16;
	const fx = a / 500 + fy;
	const fz = fy - b / 200;
	
	const xr = fx ** 3 > 0.008856 ? fx ** 3 : (fx - 16 / 116) / 7.787;
	const yr = l > 0.008856 * 903.3 ? ((l + 0.16) / 1.16) ** 3 : l / 903.3;
	const zr = fz ** 3 > 0.008856 ? fz ** 3 : (fz - 16 / 116) / 7.787;
	
	const x = xr * 95.047;
	const y = yr * 100.0;
	const z = zr * 108.883;
	
	// XYZ to RGB
	let r = x * 0.032406 + y * -0.015372 + z * -0.004986;
	let g = x * -0.009689 + y * 0.018758 + z * 0.000415;
	let b2 = x * 0.000557 + y * -0.002040 + z * 0.010570;
	
	// Apply gamma correction
	r = r > 0.0031308 ? 1.055 * r ** (1 / 2.4) - 0.055 : 12.92 * r;
	g = g > 0.0031308 ? 1.055 * g ** (1 / 2.4) - 0.055 : 12.92 * g;
	b2 = b2 > 0.0031308 ? 1.055 * b2 ** (1 / 2.4) - 0.055 : 12.92 * b2;
	
	// Clamp to 0-1 range
	r = Math.max(0, Math.min(1, r));
	g = Math.max(0, Math.min(1, g));
	b2 = Math.max(0, Math.min(1, b2));
	
	return [r * 255, g * 255, b2 * 255];
}

/**
 * Parses a CSS color value and converts to RGB
 */
function parseColorValue(value: string): [number, number, number] {
	const trimmed = value.trim();
	
	// Handle hex colors (#RRGGBB or #RGB)
	if (trimmed.startsWith('#')) {
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
	
	// Handle oklch colors: oklch(L C H)
	if (trimmed.startsWith('oklch(')) {
		const match = trimmed.match(/oklch\(([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)\)/);
		if (match) {
			const l = parseFloat(match[1]);
			const c = parseFloat(match[2]);
			const h = parseFloat(match[3]);
			return oklchToRgb(l, c, h);
		}
	}
	
	// Handle rgb/rgba colors
	if (trimmed.startsWith('rgb')) {
		const match = trimmed.match(/rgba?\(([0-9.]+)[,\s]+([0-9.]+)[,\s]+([0-9.]+)/);
		if (match) {
			return [parseFloat(match[1]), parseFloat(match[2]), parseFloat(match[3])];
		}
	}
	
	// Fallback to black
	console.warn(`Could not parse color: ${value}`);
	return [0, 0, 0];
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