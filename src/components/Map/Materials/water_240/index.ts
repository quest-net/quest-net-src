// src/components/Map/Materials/water_240/index.ts
//
// Special material: Water (palette index 240).
//
// Visual behaviour:
//   Top faces  -- layered world-space waves with crest foam and glints.
//   Side faces -- downward world-Y flow for waterfalls, fountains, and spills.
//
// Available inside fragmentGLSL:
//   vec3  worldPos       -- world-space position of the fragment
//   vec3  normal         -- world-space unit normal of the face
//   float time           -- elapsed time in seconds
//   inout vec4 fragColor -- current fragment colour (already lit + AO baked);
//                           write to fragColor.rgb to override.
//
// Available inside vertexGLSL (optional, for displacement):
//   inout vec3 transformed -- local-space vertex position; modify to displace
//   vec3  normal           -- local-space vertex normal (read-only)
//   float time             -- elapsed time in seconds
//
// helperGLSL / vertexHelperGLSL are injected at file scope (no nested
// functions in GLSL ES). Prefix any helpers with `water_` to avoid name
// collisions with other materials' helpers.

import type { SpecialMaterialDefinition } from '../types';

export const WATER_MATERIAL: SpecialMaterialDefinition = {
	paletteIndex: 240,
	name: 'Water',
	editorColor: '#1a6ea8',

	helperGLSL: /* glsl */`
		// Tuning knobs:
		// - Increase WATER_DARK_LIFT or brighten WATER_DEEP_* if pools read too dark.
		// - Increase WATER_LIGHT_COLOR_INFLUENCE if terrain lighting colour should tint water more.
		// - Adjust WATER_LOW/HIGH_LIGHT_* for lighting intensity response.
		// - Adjust WATER_FOAM_* to control foam density, opacity, and light tinting.
		const vec3 WATER_DEEP_TOP = vec3(0.035, 0.225, 0.325);
		const vec3 WATER_MID_TOP = vec3(0.030, 0.405, 0.575);
		const vec3 WATER_BRIGHT_TOP = vec3(0.095, 0.650, 0.780);
		const vec3 WATER_DEEP_SIDE = vec3(0.024, 0.155, 0.235);
		const vec3 WATER_MID_SIDE = vec3(0.030, 0.350, 0.485);
		const vec3 WATER_BRIGHT_SIDE = vec3(0.115, 0.600, 0.720);
		const vec3 WATER_BOTTOM = vec3(0.014, 0.095, 0.145);
		const vec3 WATER_FOAM = vec3(0.860, 0.980, 0.960);
		const float WATER_TOP_FOAM_DENSITY = 1.00;
		const float WATER_SIDE_FOAM_DENSITY = 1.00;
		const float WATER_TOP_FOAM_OPACITY = 0.84;
		const float WATER_SIDE_FOAM_OPACITY = 0.56;
		const float WATER_FOAM_LIGHT_COLOR_INFLUENCE = 0.40;
		const float WATER_FOAM_LIGHT_BRIGHTNESS_INFLUENCE = 0.32;
		const float WATER_FOAM_SHADOW_INFLUENCE = 0.35;
		const float WATER_DARK_LIFT = 0.045;
		const float WATER_LOW_LIGHT_INTENSITY = 0.30;
		const float WATER_HIGH_LIGHT_INTENSITY = 1.80;
		const float WATER_LOW_LIGHT_BRIGHTNESS = 0.55;
		const float WATER_HIGH_LIGHT_BRIGHTNESS = 1.2;
		const vec3 WATER_LOW_LIGHT_TINT = vec3(0.38, 0.52, 0.78);
		const vec3 WATER_LIGHT_TINT_MIN = vec3(0.40);
		const vec3 WATER_LIGHT_TINT_MAX = vec3(2.0);
		const float WATER_LIGHT_COLOR_INFLUENCE = 0.50;
		const float WATER_SHADOW_INFLUENCE = 0.52;

		float water_saturate(float value) {
			return clamp(value, 0.0, 1.0);
		}

		float water_luma(vec3 color) {
			return dot(color, vec3(0.2126, 0.7152, 0.0722));
		}

		float water_hash21(vec2 p) {
			p = fract(p * vec2(123.34, 456.21));
			p += dot(p, p + 45.32);
			return fract(p.x * p.y);
		}

		float water_noise(vec2 p) {
			vec2 i = floor(p);
			vec2 f = fract(p);
			vec2 u = f * f * (3.0 - 2.0 * f);

			float a = water_hash21(i);
			float b = water_hash21(i + vec2(1.0, 0.0));
			float c = water_hash21(i + vec2(0.0, 1.0));
			float d = water_hash21(i + vec2(1.0, 1.0));

			return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
		}

		float water_fbm(vec2 p) {
			float value = 0.0;
			float amplitude = 0.5;
			for (int i = 0; i < 4; i++) {
				value += water_noise(p) * amplitude;
				p = mat2(1.52, 1.18, -1.18, 1.52) * p + vec2(17.1, 9.2);
				amplitude *= 0.5;
			}
			return value;
		}

		float water_ridge(float value) {
			return 1.0 - abs(value * 2.0 - 1.0);
		}

		vec2 water_domain_warp(vec2 uv, float time) {
			vec2 slow = uv * 0.34 + vec2(time * 0.025, -time * 0.018);
			float x = water_fbm(slow);
			float y = water_fbm(slow + vec2(8.4, 2.7));
			return vec2(x, y) * 2.0 - 1.0;
		}

		float water_top_height(vec2 uv, float time) {
			vec2 warped = uv + water_domain_warp(uv, time) * 0.78;
			float slowPhase = water_fbm(warped * 0.38 + vec2(time * 0.018, -time * 0.014)) * 2.0 - 1.0;
			float crossPhase = water_fbm(warped * 0.72 + vec2(-time * 0.026, time * 0.021) + vec2(5.3, -3.7)) * 2.0 - 1.0;

			float largeA = sin(dot(warped, vec2(0.78, 0.63)) * 1.85 + time * 0.54 + slowPhase * 1.25);
			float largeB = sin(dot(warped, vec2(-0.36, 0.93)) * 2.45 - time * 0.41 + crossPhase * 0.95);
			float midA = sin(dot(warped, vec2(0.18, 0.98)) * 5.20 + time * 1.22 + largeA * 0.55 + crossPhase * 1.40);
			float midB = sin(dot(warped, vec2(0.96, -0.28)) * 7.40 - time * 1.58 + largeB * 0.45 + slowPhase * 1.10);
			float chop = water_fbm(warped * 4.6 + vec2(time * 0.13, -time * 0.10)) * 2.0 - 1.0;

			return largeA * 0.38 + largeB * 0.26 + midA * 0.15 + midB * 0.10 + chop * 0.11;
		}

		float water_color_field(vec2 uv, float time) {
			vec2 broadUv = uv * 0.42 + water_domain_warp(uv * 0.31 + vec2(6.7, -3.2), time * 0.35) * 0.58;
			vec2 midUv = uv * 1.28 + water_domain_warp(uv * 0.76 + vec2(-8.1, 4.6), time * 0.65) * 0.42;
			float broad = water_fbm(broadUv + vec2(time * 0.012, -time * 0.009));
			float mid = water_fbm(midUv + vec2(-time * 0.036, time * 0.025));
			float fine = water_fbm(uv * 3.35 + vec2(time * 0.075, -time * 0.055));
			return water_saturate(0.16 + broad * 0.48 + mid * 0.25 + fine * 0.13);
		}

		vec3 water_top_normal(vec2 uv, float time) {
			float eps = 0.045;
			float h = water_top_height(uv, time);
			float hx = water_top_height(uv + vec2(eps, 0.0), time);
			float hz = water_top_height(uv + vec2(0.0, eps), time);
			return normalize(vec3((h - hx) * 1.45, eps, (h - hz) * 1.45));
		}

		float water_top_foam(vec2 uv, float time, float heightValue, vec3 waterNormal) {
			float slope = length(waterNormal.xz) / max(waterNormal.y, 0.001);
			vec2 foamWarp = water_domain_warp(uv * 0.58 + vec2(11.3, -6.7), time * 0.82);
			vec2 foamUv = uv + foamWarp * 1.35;

			float crestJitter = water_fbm(foamUv * 0.74 + vec2(time * 0.032, -time * 0.027)) * 2.0 - 1.0;
			float crest = smoothstep(0.24, 0.84, heightValue + crestJitter * 0.34);
			float slopeCrest = smoothstep(0.76, 2.55, slope);
			float foamEnergy = water_saturate(crest * 0.58 + slopeCrest * 0.42);

			vec2 broadUv = foamUv * 1.45 + vec2(time * 0.105, -time * 0.064);
			float broadBreakup = water_fbm(broadUv + water_domain_warp(foamUv * 0.44, time) * 1.65);
			float threshold = mix(
				0.45,
				0.74,
				water_fbm(foamUv * 0.36 + vec2(-time * 0.018, time * 0.013))
			);
			float lace = water_ridge(
				water_fbm(foamUv * 7.6 + vec2(time * 0.21, -time * 0.16) + broadBreakup * 2.8)
			);
			float holes = water_fbm(foamUv * 4.9 + vec2(-time * 0.14, time * 0.11) + crestJitter);
			float brokenLace = smoothstep(threshold, 0.96, lace * 0.72 + broadBreakup * 0.20 + holes * 0.08);
			float foamAge = smoothstep(
				0.22,
				0.80,
				water_fbm(foamUv * 0.92 + vec2(-time * 0.052, time * 0.046) + water_fbm(foamUv * 2.1))
			);

			return water_saturate(foamEnergy * brokenLace * foamAge);
		}

		vec2 water_side_uv(vec3 worldPos, vec3 normal) {
			if (abs(normal.x) > abs(normal.z)) {
				return vec2(worldPos.z, worldPos.y);
			}
			return vec2(worldPos.x, worldPos.y);
		}

		float water_side_flow(vec2 uv, float time) {
			float column = water_fbm(vec2(uv.x * 0.92, uv.y * 0.08 + time * 0.08));
			float warp = (column - 0.5) * 1.55 + sin(uv.y * 0.37 + time * 0.29) * 0.12;
			float broad = water_fbm(vec2(uv.x * 1.20 + warp, uv.y * 0.48 + time * 0.72));
			float mid = water_fbm(vec2(uv.x * 3.60 + broad * 1.7, uv.y * 1.05 + time * 1.46));
			float fine = water_fbm(vec2(uv.x * 8.80 + mid * 2.2, uv.y * 2.10 + time * 2.65));
			float threads = water_ridge(fine * 0.95 + mid * 0.34);

			return water_saturate(broad * 0.48 + mid * 0.24 + threads * 0.42);
		}

		float water_side_foam(vec2 uv, float time) {
			float column = water_fbm(vec2(uv.x * 1.6, uv.y * 0.10 + time * 0.16));
			float falling = water_fbm(vec2(uv.x * 6.6 + column * 3.5, uv.y * 1.55 + time * 3.05));
			float spray = water_fbm(vec2(uv.x * 13.0 + falling * 2.4, uv.y * 3.2 + time * 4.4));
			float ribbon = water_ridge(falling + column * 0.38);
			float broken = smoothstep(0.50, 0.90, spray) * smoothstep(0.36, 0.88, ribbon);

			return water_saturate(broken * (0.45 + column * 0.55));
		}
	`,

	fragmentGLSL: /* glsl */`
		float topFace = smoothstep(0.35, 0.82, normal.y);
		float bottomFace = smoothstep(0.35, 0.82, -normal.y);

		float terrainLight = smoothstep(
			WATER_LOW_LIGHT_INTENSITY,
			WATER_HIGH_LIGHT_INTENSITY,
			uTerrainLightIntensity
		);
		float localShade = smoothstep(0.03, 0.55, water_luma(fragColor.rgb));
		vec3 terrainLightTint = uTerrainLightColor / max(water_luma(uTerrainLightColor), 0.001);
		terrainLightTint = clamp(terrainLightTint, WATER_LIGHT_TINT_MIN, WATER_LIGHT_TINT_MAX);

		vec2 topUv = worldPos.xz;
		float topHeight = water_top_height(topUv, time);
		vec3 topNormal = water_top_normal(topUv, time);
		vec3 viewDir = normalize(cameraPosition - worldPos);
		vec3 sunDir = normalize(vec3(-0.38, 0.88, 0.28));
		vec3 halfDir = normalize(viewDir + sunDir);

		float topFoam = water_top_foam(topUv, time, topHeight, topNormal);
		float topFoamMask = water_saturate(topFoam * WATER_TOP_FOAM_DENSITY);
		float topDiffuse = 0.70 + max(dot(topNormal, sunDir), 0.0) * 0.32;
		float fresnel = pow(1.0 - max(dot(topNormal, viewDir), 0.0), 2.7);
		float glint = pow(max(dot(topNormal, halfDir), 0.0), 72.0) *
			smoothstep(0.20, 0.72, topHeight + water_fbm(topUv * 3.4 + time * 0.08) * 0.35);

		float colorField = water_color_field(topUv, time);
		float crestTint = smoothstep(0.34, 0.82, topHeight) *
			smoothstep(0.28, 0.82, water_fbm(topUv * 2.15 + vec2(time * 0.022, -time * 0.018)));
		float topTone = water_saturate(colorField + crestTint * 0.16);
		vec3 topColor = mix(WATER_DEEP_TOP, WATER_MID_TOP, smoothstep(0.08, 0.78, topTone));
		topColor = mix(topColor, WATER_BRIGHT_TOP, smoothstep(0.62, 1.0, topTone) * 0.52);
		topColor *= topDiffuse;
		topColor += vec3(0.18, 0.48, 0.52) * fresnel * 0.32;
		topColor += vec3(0.92, 0.98, 0.94) * glint * 0.42;

		vec2 sideUv = water_side_uv(worldPos, normal);
		float flow = water_side_flow(sideUv, time);
		float sideFoam = water_side_foam(sideUv, time) * (0.34 + flow * 0.86);
		float sideFoamMask = water_saturate(sideFoam * WATER_SIDE_FOAM_DENSITY);
		float viewFacing = pow(1.0 - abs(dot(normalize(normal), viewDir)), 2.0);
		vec3 sideColor = mix(WATER_DEEP_SIDE, WATER_MID_SIDE, smoothstep(0.16, 0.82, flow));
		sideColor = mix(sideColor, WATER_BRIGHT_SIDE, smoothstep(0.62, 1.0, flow) * 0.38);
		sideColor += vec3(0.035, 0.16, 0.18) * viewFacing;

		vec3 waterColor = mix(sideColor, topColor, topFace);
		waterColor = mix(waterColor, WATER_BOTTOM, bottomFace * 0.70);
		float foamMask = max(topFoamMask * topFace, sideFoamMask * (1.0 - topFace));
		waterColor += vec3(WATER_DARK_LIFT, WATER_DARK_LIFT * 1.18, WATER_DARK_LIFT * 1.28) * (1.0 - foamMask * 0.35);

		vec3 lowLightWater = waterColor * WATER_LOW_LIGHT_TINT;
		waterColor = mix(lowLightWater, waterColor, terrainLight);
		waterColor = mix(waterColor, waterColor * terrainLightTint, WATER_LIGHT_COLOR_INFLUENCE);

		float lightLevel = mix(WATER_LOW_LIGHT_BRIGHTNESS, WATER_HIGH_LIGHT_BRIGHTNESS, terrainLight);
		float shadeLevel = mix(1.0 - WATER_SHADOW_INFLUENCE, 1.0, localShade);
		vec3 litWater = waterColor * lightLevel * shadeLevel;

		vec3 foamColor = mix(WATER_FOAM, WATER_FOAM * terrainLightTint, WATER_FOAM_LIGHT_COLOR_INFLUENCE);
		float foamLightLevel = mix(1.0, lightLevel, WATER_FOAM_LIGHT_BRIGHTNESS_INFLUENCE);
		float foamShadeLevel = mix(1.0, shadeLevel, WATER_FOAM_SHADOW_INFLUENCE);
		foamColor *= foamLightLevel * foamShadeLevel;
		float foamOpacity = mix(
			sideFoamMask * WATER_SIDE_FOAM_OPACITY,
			topFoamMask * WATER_TOP_FOAM_OPACITY,
			topFace
		);

		fragColor.rgb = mix(litWater, foamColor, foamOpacity);
	`,
};
