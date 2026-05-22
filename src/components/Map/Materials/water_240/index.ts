// src/components/Map/Materials/water_240/index.ts
//
// Special material: Water (palette index 240).
//
// Visual behaviour:
//   Top / bottom faces -- two-layer horizontal ripple in world XZ space.
//   Side faces         -- downward flow in world Y space, giving waterfalls
//                         and fountain columns a sense of motion.
//
// All effects are fully procedural (no textures).
// World-space coordinates are used throughout so greedy-merged quads tile
// seamlessly without UV stretching.
//
// Importing this module is enough to register the material; the import is a
// side-effect that calls SPECIAL_MATERIAL_REGISTRY.register().

import { SPECIAL_MATERIAL_REGISTRY } from '../SpecialMaterialRegistry';

SPECIAL_MATERIAL_REGISTRY.register({
	paletteIndex: 240,
	name: 'Water',
	editorColor: '#1a6ea8',

	// Top-level GLSL helpers. Prefixed "water_" to avoid name collisions.
	helperGLSL: /* glsl */`
		float water_hash(vec2 p) {
			return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
		}

		// Smooth value noise via bilinear interpolation of hashed corners.
		float water_noise(vec2 p) {
			vec2 i = floor(p);
			vec2 f = fract(p);
			vec2 u = f * f * (3.0 - 2.0 * f);
			return mix(
				mix(water_hash(i),                water_hash(i + vec2(1.0, 0.0)), u.x),
				mix(water_hash(i + vec2(0.0, 1.0)), water_hash(i + vec2(1.0, 1.0)), u.x),
				u.y
			);
		}

		// Fractal Brownian Motion: three octaves gives large swells + small ripples.
		float water_fbm(vec2 p) {
			return water_noise(p)                          * 0.500
			     + water_noise(p * 2.1 + vec2(1.7, 9.2))  * 0.250
			     + water_noise(p * 4.3 + vec2(8.3, 2.8))  * 0.125;
		}
	`,

	fragmentGLSL: /* glsl */`
		float isHoriz = step(0.5, abs(normal.y));

		// Surface UV: top/bottom faces use the XZ plane, side faces use a
		// plane that includes the Y axis so waterfalls scroll downward.
		vec2 surfaceUV = mix(
			vec2(worldPos.x + worldPos.z, worldPos.y + time * 0.5),
			worldPos.xz,
			isHoriz
		);
		// Gentle drift on top for both X and Z.
		vec2 topDrift = worldPos.xz + vec2(time * 0.06, time * 0.04);
		surfaceUV = mix(surfaceUV, topDrift, isHoriz);

		// Domain warp: offset the sample coordinates using a first FBM pass.
		// This breaks the regularity and creates the organic flowing look.
		float warpT = time * 0.07;
		vec2 warp = vec2(
			water_fbm(surfaceUV * 0.85 + warpT),
			water_fbm(surfaceUV * 0.85 + vec2(3.4, 8.1) + warpT)
		);

		// Main pattern: FBM sampled at the warped coordinates.
		float pattern = water_fbm(surfaceUV * 0.9 + warp * 1.4 + time * 0.04);

		// Three-stop colour ramp: deep -> mid -> crest highlight.
		vec3 colorDeep  = vec3(0.03, 0.20, 0.48);
		vec3 colorMid   = vec3(0.07, 0.40, 0.70);
		vec3 colorCrest = vec3(0.30, 0.68, 0.88);
		vec3 waterColor = pattern < 0.5
			? mix(colorDeep,  colorMid,   pattern * 2.0)
			: mix(colorMid,   colorCrest, (pattern - 0.5) * 2.0);

		// --- Per-pixel bump normals via screen-space derivatives ---
		// dFdx/dFdy give the rate-of-change of 'pattern' across adjacent fragments.
		// Dividing by the world-space step size normalises to slope-per-world-unit,
		// so the result is independent of camera zoom, resolution, or projection type.
		// This entirely replaces vertex displacement: every pixel gets its own correct
		// normal with no geometry topology involved, so T-junction seams are impossible.
		float wdx = length(dFdx(worldPos.xz));
		float wdz = length(dFdy(worldPos.xz));
		float slopeX = dFdx(pattern) / max(wdx, 0.0001);
		float slopeZ = dFdy(pattern) / max(wdz, 0.0001);
		vec3 bumpNormal = normalize(normal + vec3(-slopeX, 0.0, -slopeZ) * 2.5 * isHoriz);

		// --- Fresnel (using bump normal for per-pixel accuracy) ---
		vec3 viewDir = normalize(cameraPosition - worldPos);
		float NdotV = max(dot(bumpNormal, viewDir), 0.0);
		float fresnel = pow(1.0 - NdotV, 4.0);
		waterColor = mix(waterColor, colorCrest + vec3(0.15, 0.12, 0.08), fresnel * 0.55 * isHoriz);

		// --- Specular glint from bump normal ---
		// Half-vector between view and an approximate sun direction gives sharp sparkle
		// at wave crests, which is the dominant visual cue for 3D water deformation.
		vec3 sunDir = normalize(vec3(0.5, 1.5, 0.5));
		vec3 halfVec = normalize(viewDir + sunDir);
		float spec = pow(max(dot(bumpNormal, halfVec), 0.0), 64.0);
		waterColor += vec3(1.0, 0.98, 0.95) * spec * 0.8 * isHoriz;

		// Preserve lighting and AO baked by the standard material pass.
		float luma = dot(fragColor.rgb, vec3(0.2126, 0.7152, 0.0722));
		fragColor.rgb = waterColor * (0.35 + luma * 0.65);

		// --- Foam crests (applied after lighting so shadows don't dampen it) ---
		float foamNoise = water_fbm(surfaceUV * 3.0 - time * 0.1);
		float foam = smoothstep(0.55, 0.78, pattern) * step(0.35, foamNoise);
		fragColor.rgb = mix(fragColor.rgb, vec3(0.92, 0.96, 1.0), foam * 0.90 * isHoriz);
	`,
});
