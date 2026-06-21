/**
 * Scene singleton facade.
 *
 * Shape: SINGLETON (one scene per campaign). Namespaced under `game.scene`.
 * Images are referenced by name|id and resolved internally (the DM never types an
 * image GUID).
 *
 * Both setters accept a falsy ref ("" / null / undefined) to CLEAR the slot: the
 * scene handlers already treat an empty `imageId` as "cleared", so we surface that
 * by dispatching `imageId: ""`. A non-empty ref that fails to resolve no-ops (we do
 * not clear on a typo).
 *
 * Backed by tier-1 util `ImageUtils.findImage(campaign, nameOrId)` (Id->Name->first
 * glob). No new actions — `scene:setEnvironmentImage` / `scene:setFocusImage` are
 * already scriptable and both take `{ imageId: string }`.
 */
import type { ScriptApiContext } from "./apiContext";
import type { RefByNameOrId } from "./actorApi";
import { ImageUtils } from "../../../domains/Image/ImageUtils";

export interface SceneApi {
	/**
	 * Set the environment (background) image (name|id). Pass a falsy ref ("" / null)
	 * to clear it. A non-empty ref that doesn't resolve no-ops. -> scene:setEnvironmentImage
	 */
	setEnvironment(image: RefByNameOrId): Promise<void>;
	/**
	 * Set the focus image (name|id). Pass a falsy ref ("" / null) to clear it. A
	 * non-empty ref that doesn't resolve no-ops. -> scene:setFocusImage
	 */
	setFocus(image: RefByNameOrId): Promise<void>;
}

/**
 * Resolve an image ref to an Id for a scene setter, honoring the clear path.
 *   - falsy ref   -> "" (clear the slot; the handler logs "cleared")
 *   - resolves    -> the image Id
 *   - won't match -> undefined (caller no-ops; never clears on a typo)
 */
function resolveSceneImageId(
	api: ScriptApiContext,
	image: RefByNameOrId
): string | undefined {
	if (!image) return "";
	return ImageUtils.findImage(api.campaign(), image)?.Id;
}

/** Build the scene singleton for one script run. */
export function makeSceneApi(api: ScriptApiContext): SceneApi {
	return {
		setEnvironment: async (image) => {
			const imageId = resolveSceneImageId(api, image);
			if (imageId === undefined) return;
			await api.action("scene:setEnvironmentImage", { imageId });
		},
		setFocus: async (image) => {
			const imageId = resolveSceneImageId(api, image);
			if (imageId === undefined) return;
			await api.action("scene:setFocusImage", { imageId });
		},
	};
}
