// components/Map/Targeting/targetingCursors.ts
//
// Custom cursors for item/skill targeting mode. Browsers only expose cursor
// shapes via CSS -- either the native keywords (crosshair, cell, ...) or a
// `url()` to an image. There is no JS library that adds genuine OS-cursor
// shapes; the "cursor libraries" that exist are DOM elements that chase the
// pointer (extra render cost + a frame of lag), which we don't want on the
// canvas. So we inline two small SVG reticles as data URIs -- full control,
// no dependency, no runtime cost. Each has a black backing stroke so it stays
// visible over both light terrain and dark shadow.

/** Builds a `cursor` value from an SVG string, hotspot centered at 16,16. */
function svgCursor(svg: string, fallback: string): string {
	return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 16 16, ${fallback}`;
}

// Corner-bracket reticle -- "aim at a tile".
const TILE_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
  <g fill="none" stroke="#000" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round">
    <path d="M7 12V7h5M20 7h5v5M25 20v5h-5M12 25H7v-5"/>
  </g>
  <g fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M7 12V7h5M20 7h5v5M25 20v5h-5M12 25H7v-5"/>
  </g>
</svg>`;

// Ringed crosshair -- "aim at an actor".
const ACTOR_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
  <g fill="none" stroke="#000" stroke-width="4.5" stroke-linecap="round">
    <circle cx="16" cy="16" r="8.5"/>
    <path d="M16 2v5M16 25v5M2 16h5M25 16h5"/>
  </g>
  <g fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round">
    <circle cx="16" cy="16" r="8.5"/>
    <path d="M16 2v5M16 25v5M2 16h5M25 16h5"/>
  </g>
  <circle cx="16" cy="16" r="1.5" fill="#fff" stroke="#000" stroke-width="1"/>
</svg>`;

export const TARGET_TILE_CURSOR = svgCursor(TILE_SVG, "crosshair");
export const TARGET_ACTOR_CURSOR = svgCursor(ACTOR_SVG, "crosshair");
