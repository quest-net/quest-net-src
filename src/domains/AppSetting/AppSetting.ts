// AppSettings live on the Context as an open-ended `Record<string, string>`
// (see Context.ts). Every value is read and written through AppSettingUtils,
// which owns the string encoding, defaults and clamping per key. The bag is
// deliberately untyped: it also carries keys no UI declares, such as the
// `scripting.disabled` kill switch in Scripting/scriptConstants.ts.

/**
 * The UI exposes four friendly stops, while persistence stores the actual
 * world-space value so hand-edited/custom radii remain representable.
 */
export const HERO_OCCLUSION_RADIUS_SETTING = {
  DEFAULT: 1.25,
  MIN: 1.25,
  MAX: 10,
  PRESETS: [
    { label: "Tight", value: 1.25 },
    { label: "Small", value: 2.5 },
    { label: "Medium", value: 4 },
    { label: "Wide", value: 6 },
  ],
} as const;

export const DEFAULT_IMAGE_PROMPT =
  'Produce a square image that will serve as an icon for a {ObjectType} ' +
  'with name: {ObjectName} and description: {ObjectDescription}. ' +
  'White background, no text, fantasy illustration style.';
