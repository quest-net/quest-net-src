import { useEffect, useMemo } from "react";
import * as THREE from "three";
import type { Character } from "../../../domains/Character/Character";
import type { Entity } from "../../../domains/Entity/Entity";
import type { VoxelTerrain } from "../../../domains/VoxelTerrain/VoxelTerrain";
import { buildActorTokenDescriptors } from "../Actors3D/actorTokenDescriptors";
import {
	getActorGroundPosition,
	getStandeeBottomOffset,
	isActorAirborne,
} from "../Actors3D/actorTokenPlacement";
import { getActorTokenWorldSize } from "../Actors3D/actorTokenTexture";
import type { ActorTokenDescriptor, ThreeDSceneResources } from "../Actors3D/actorTokenTypes";
import {
	THREE_D_STICKER_PLACEMENT,
	THREE_D_STICKER_TEXTURE,
} from "../threeDMapConstants";

interface ThreeDStickerLayerProps {
	resources: ThreeDSceneResources;
	terrain: VoxelTerrain;
	characters: Character[];
	entities: Entity[];
	cutoutImageIds: ReadonlySet<string>;
	activeStickers: ReadonlyMap<string, string>;
}

function createStickerTexture(emoji: string): THREE.CanvasTexture {
	const canvas = document.createElement("canvas");
	canvas.width = THREE_D_STICKER_TEXTURE.SIZE;
	canvas.height = THREE_D_STICKER_TEXTURE.SIZE;

	const ctx = canvas.getContext("2d");
	if (!ctx) {
		throw new Error("Unable to create sticker canvas");
	}

	const center = THREE_D_STICKER_TEXTURE.SIZE / 2;
	const gradient = ctx.createRadialGradient(
		center,
		center,
		0,
		center,
		center,
		THREE_D_STICKER_TEXTURE.BACKDROP_RADIUS
	);
	gradient.addColorStop(0, THREE_D_STICKER_TEXTURE.BACKDROP_INNER_COLOR);
	gradient.addColorStop(1, THREE_D_STICKER_TEXTURE.BACKDROP_OUTER_COLOR);
	ctx.fillStyle = gradient;
	ctx.fillRect(0, 0, THREE_D_STICKER_TEXTURE.SIZE, THREE_D_STICKER_TEXTURE.SIZE);

	ctx.font = `${THREE_D_STICKER_TEXTURE.FONT_SIZE}px ${THREE_D_STICKER_TEXTURE.FONT_FAMILY}`;
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	ctx.shadowColor = THREE_D_STICKER_TEXTURE.SHADOW_COLOR;
	ctx.shadowBlur = THREE_D_STICKER_TEXTURE.SHADOW_BLUR;
	ctx.shadowOffsetY = THREE_D_STICKER_TEXTURE.SHADOW_OFFSET_Y;
	ctx.fillText(emoji, center, center);

	ctx.shadowColor = "transparent";
	ctx.shadowBlur = 0;
	ctx.shadowOffsetY = 0;
	ctx.fillText(emoji, center, center);

	const texture = new THREE.CanvasTexture(canvas);
	texture.colorSpace = THREE.SRGBColorSpace;
	texture.needsUpdate = true;
	return texture;
}

function getStickerPosition(actor: ActorTokenDescriptor, terrain: VoxelTerrain): THREE.Vector3 {
	const position = getActorGroundPosition(actor, terrain);
	const airborne = isActorAirborne(actor, terrain);
	const bottomOffset = getStandeeBottomOffset(actor, airborne);
	const { height } = getActorTokenWorldSize(actor.size, actor.cutout);
	position.y += bottomOffset + height + THREE_D_STICKER_PLACEMENT.BASE_Y_GAP;
	return position;
}

function getStickerWorldSize(actor: ActorTokenDescriptor): number {
	const { width } = getActorTokenWorldSize(actor.size, actor.cutout);
	return THREE.MathUtils.clamp(
		width * THREE_D_STICKER_PLACEMENT.WORLD_SIZE_MULTIPLIER,
		THREE_D_STICKER_PLACEMENT.MIN_WORLD_SIZE,
		THREE_D_STICKER_PLACEMENT.MAX_WORLD_SIZE
	);
}

function createActiveStickerSignature(activeStickers: ReadonlyMap<string, string>): string {
	return Array.from(activeStickers.entries())
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([actorId, emoji]) => `${actorId}:${emoji}`)
		.join("|");
}

function easeOutBack(t: number): number {
	const c1 = 1.70158;
	const c3 = c1 + 1;
	return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

export function ThreeDStickerLayer({
	resources,
	terrain,
	characters,
	entities,
	cutoutImageIds,
	activeStickers,
}: ThreeDStickerLayerProps) {
	const descriptorsByActorId = useMemo(() => {
		const descriptors = buildActorTokenDescriptors(
			characters,
			entities,
			cutoutImageIds
		);
		const map = new Map<string, ActorTokenDescriptor>();
		for (const descriptor of descriptors) {
			map.set(descriptor.id, descriptor);
		}
		return map;
	}, [characters, entities, cutoutImageIds]);
	const activeStickerSignature = useMemo(
		() => createActiveStickerSignature(activeStickers),
		[activeStickers]
	);
	const activeStickerEntries = useMemo(
		() => Array.from(activeStickers.entries()),
		// Keep the existing sprites alive while useActiveStickers refreshes time
		// but the active actor/emoji set has not actually changed.
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[activeStickerSignature]
	);

	useEffect(() => {
		if (activeStickerEntries.length === 0) return;

		const group = new THREE.Group();
		const textures: THREE.Texture[] = [];
		const materials: THREE.Material[] = [];
		const stickers: Array<{
			sprite: THREE.Sprite;
			baseY: number;
			worldSize: number;
			startedAt: number;
		}> = [];

		resources.scene.add(group);

		for (const [actorId, emoji] of activeStickerEntries) {
			const actor = descriptorsByActorId.get(actorId);
			if (!actor) continue;

			const texture = createStickerTexture(emoji);
			const material = new THREE.SpriteMaterial({
				map: texture,
				transparent: true,
				depthTest: true,
				depthWrite: false,
			});
			const sprite = new THREE.Sprite(material);
			const position = getStickerPosition(actor, terrain);
			const worldSize = getStickerWorldSize(actor);
			sprite.position.copy(position);
			sprite.scale.setScalar(worldSize * THREE_D_STICKER_PLACEMENT.POP_START_SCALE);
			sprite.renderOrder = THREE_D_STICKER_PLACEMENT.RENDER_ORDER;

			textures.push(texture);
			materials.push(material);
			stickers.push({
				sprite,
				baseY: position.y,
				worldSize,
				startedAt: performance.now(),
			});
			group.add(sprite);
		}

		const tick = (now: number) => {
			for (const sticker of stickers) {
				const ageMs = now - sticker.startedAt;
				const popT = Math.min(1, ageMs / THREE_D_STICKER_PLACEMENT.POP_DURATION_MS);
				const popScale =
					THREE_D_STICKER_PLACEMENT.POP_START_SCALE +
					(1 - THREE_D_STICKER_PLACEMENT.POP_START_SCALE) * easeOutBack(popT);
				const bob =
					Math.sin(ageMs / 1000 * THREE_D_STICKER_PLACEMENT.BOB_SPEED) *
					THREE_D_STICKER_PLACEMENT.BOB_HEIGHT;
				const scale = sticker.worldSize * popScale;
				sticker.sprite.position.y = sticker.baseY + bob;
				sticker.sprite.scale.set(scale, scale, 1);
			}
		};
		tick(performance.now());
		resources.animationCallbacks.add(tick);

		return () => {
			resources.animationCallbacks.delete(tick);
			resources.scene.remove(group);
			group.clear();
			for (const material of materials) {
				material.dispose();
			}
			for (const texture of textures) {
				texture.dispose();
			}
		};
	}, [
		resources,
		terrain,
		descriptorsByActorId,
		activeStickerEntries,
		activeStickerSignature,
	]);

	return null;
}
