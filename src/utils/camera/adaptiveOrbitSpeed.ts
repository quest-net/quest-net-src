// Distance/zoom-adaptive orbit sensitivity for OrbitControls.
//
// OrbitControls rotation is angular and independent of how zoomed-in the view
// is, so when the view is "close" the same drag rotates the scene the same
// angle but sweeps the visible content across the viewport much faster -- it
// feels twitchy. This ramps `rotateSpeed` linearly with how far "out" the view
// is: at (or beyond) the reference framing it returns `maxSpeed`; as the view
// closes in it falls toward `minSpeed`.
//
// The helper is camera-agnostic -- it only consumes a normalized "out-ness"
// ratio. Each camera derives that ratio from whatever drives its zoom:
//   - perspective (dolly): ratio = currentDistance / referenceDistance
//   - orthographic (zoom): ratio = referenceZoom / currentZoom  (referenceZoom = 1)
// Both are 1 at the default framing and shrink below 1 as the view zooms in.

export interface AdaptiveOrbitSpeedConfig {
	/** rotateSpeed when fully zoomed in. */
	minSpeed: number;
	/** rotateSpeed at (or beyond) the reference framing. */
	maxSpeed: number;
}

/**
 * @param outnessRatio current zoomed-out-ness relative to the reference framing
 *   -- 1 at the default/entry framing, <1 when zoomed in, >1 when zoomed out.
 */
export function adaptiveOrbitRotateSpeed(
	outnessRatio: number,
	config: AdaptiveOrbitSpeedConfig,
): number {
	const scaled = outnessRatio * config.maxSpeed;
	return Math.max(config.minSpeed, Math.min(config.maxSpeed, scaled));
}
