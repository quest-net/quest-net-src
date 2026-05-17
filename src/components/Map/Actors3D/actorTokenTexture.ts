import * as THREE from "three";
import { loadImageBlob } from "../../../domains/Image/ImageLoading";
import type { ActorSize } from "../../../domains/Actor/Actor";
import {
	ACTOR_TOKEN_PLACEHOLDER,
	ACTOR_TOKEN_PICK,
	ACTOR_TOKEN_SIZE_SCALE,
	ACTOR_TOKEN_TEXTURE,
	ACTOR_TOKEN_WORLD_SIZE,
} from "./actorTokenConstants";
import type { ActorTokenDescriptor } from "./actorTokenTypes";

export interface ActorTokenPickBounds {
	minU: number;
	maxU: number;
	minV: number;
	maxV: number;
}

function isHexColor(value: string | undefined): value is string {
	return /^#[0-9a-f]{6}$/i.test(value ?? "");
}

export function getActorTokenWorldSize(
	size: ActorSize,
	cutout = false
): { width: number; height: number } {
	const scale = ACTOR_TOKEN_SIZE_SCALE[size] *
		(cutout ? ACTOR_TOKEN_WORLD_SIZE.CUTOUT_SCALE_MULTIPLIER : 1);
	return {
		width: ACTOR_TOKEN_WORLD_SIZE.BASE_WIDTH * scale,
		height: ACTOR_TOKEN_WORLD_SIZE.BASE_HEIGHT * scale,
	};
}

interface TextureLoaderOptions {
	isDM: boolean;
	imageService?: {
		getImage(imageId: string): Promise<Blob | null>;
	} | null;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
	ctx.beginPath();
	ctx.moveTo(x + r, y);
	ctx.lineTo(x + w - r, y);
	ctx.quadraticCurveTo(x + w, y, x + w, y + r);
	ctx.lineTo(x + w, y + h - r);
	ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
	ctx.lineTo(x + r, y + h);
	ctx.quadraticCurveTo(x, y + h, x, y + h - r);
	ctx.lineTo(x, y + r);
	ctx.quadraticCurveTo(x, y, x + r, y);
	ctx.closePath();
}

async function loadImageElement(blob: Blob): Promise<HTMLImageElement> {
	const objectUrl = URL.createObjectURL(blob);
	const image = new Image();

	try {
		await new Promise<void>((resolve, reject) => {
			image.onload = () => resolve();
			image.onerror = () => reject(new Error("Failed to load token image"));
			image.src = objectUrl;
		});
		return image;
	} finally {
		URL.revokeObjectURL(objectUrl);
	}
}

function drawImageCover(ctx: CanvasRenderingContext2D, image: HTMLImageElement) {
	const scale = Math.max(
		ACTOR_TOKEN_TEXTURE.SIZE / image.width,
		ACTOR_TOKEN_TEXTURE.SIZE / image.height
	);
	const width = image.width * scale;
	const height = image.height * scale;
	const x = (ACTOR_TOKEN_TEXTURE.SIZE - width) / 2;
	const y = (ACTOR_TOKEN_TEXTURE.SIZE - height) / 2;
	ctx.drawImage(image, x, y, width, height);
}

/**
 * Fits the full image inside the square texture, preserving aspect ratio,
 * with transparent padding on the short axis. Used for cutout tokens so a
 * tall character image is fully visible (no cropping) and any transparent
 * margins of the source image render through cleanly.
 */
function drawImageContain(ctx: CanvasRenderingContext2D, image: HTMLImageElement) {
	const scale = Math.min(
		ACTOR_TOKEN_TEXTURE.SIZE / image.width,
		ACTOR_TOKEN_TEXTURE.SIZE / image.height
	);
	const width = image.width * scale;
	const height = image.height * scale;
	const x = (ACTOR_TOKEN_TEXTURE.SIZE - width) / 2;
	const y = (ACTOR_TOKEN_TEXTURE.SIZE - height) / 2;
	ctx.drawImage(image, x, y, width, height);
}

function createPlaceholderGradient(
	ctx: CanvasRenderingContext2D,
	actor: ActorTokenDescriptor
): CanvasGradient {
	const baseColor =
		isHexColor(actor.color)
			? actor.color
			: actor.kind === "character"
				? ACTOR_TOKEN_PLACEHOLDER.CHARACTER_FILL
				: ACTOR_TOKEN_PLACEHOLDER.ENTITY_FILL;
	const gradient = ctx.createLinearGradient(
		0,
		0,
		ACTOR_TOKEN_TEXTURE.SIZE,
		ACTOR_TOKEN_TEXTURE.SIZE
	);
	gradient.addColorStop(0, baseColor);
	gradient.addColorStop(1, ACTOR_TOKEN_PLACEHOLDER.FILL);
	return gradient;
}

function getPlaceholderFont(fontSize: number): string {
	return `700 ${fontSize}px Inter, system-ui, sans-serif`;
}

function fitWordToWidth(
	ctx: CanvasRenderingContext2D,
	word: string,
	maxWidth: number
): string {
	if (ctx.measureText(word).width <= maxWidth) return word;

	let fitted = word;
	while (fitted.length > 1 && ctx.measureText(`${fitted}...`).width > maxWidth) {
		fitted = fitted.slice(0, -1);
	}
	return `${fitted}...`;
}

function wrapText(
	ctx: CanvasRenderingContext2D,
	text: string,
	maxWidth: number
): string[] {
	const words = text.trim().split(/\s+/).filter(Boolean);
	if (words.length === 0) return ["?"];

	const lines: string[] = [];
	let currentLine = "";

	for (const word of words) {
		const fittedWord = fitWordToWidth(ctx, word, maxWidth);
		const candidate = currentLine ? `${currentLine} ${fittedWord}` : fittedWord;
		if (ctx.measureText(candidate).width <= maxWidth) {
			currentLine = candidate;
			continue;
		}

		if (currentLine) lines.push(currentLine);
		currentLine = fittedWord;
	}

	if (currentLine) lines.push(currentLine);
	return lines;
}

function clampLinesToFit(
	ctx: CanvasRenderingContext2D,
	lines: string[],
	maxWidth: number
): string[] {
	if (lines.length <= ACTOR_TOKEN_PLACEHOLDER.TEXT_MAX_LINES) return lines;

	const clamped = lines.slice(0, ACTOR_TOKEN_PLACEHOLDER.TEXT_MAX_LINES);
	let lastLine = clamped[clamped.length - 1];
	while (lastLine.length > 1 && ctx.measureText(`${lastLine}...`).width > maxWidth) {
		lastLine = lastLine.slice(0, -1);
	}
	clamped[clamped.length - 1] = `${lastLine}...`;
	return clamped;
}

function getPlaceholderTextLayout(
	ctx: CanvasRenderingContext2D,
	name: string
): { lines: string[]; fontSize: number; lineHeight: number } {
	const maxWidth = ACTOR_TOKEN_TEXTURE.SIZE * ACTOR_TOKEN_PLACEHOLDER.TEXT_MAX_WIDTH_RATIO;
	for (
		let fontSize = ACTOR_TOKEN_PLACEHOLDER.TEXT_MAX_FONT_SIZE;
		fontSize >= ACTOR_TOKEN_PLACEHOLDER.TEXT_MIN_FONT_SIZE;
		fontSize -= 2
	) {
		ctx.font = getPlaceholderFont(fontSize);
		const lines = wrapText(ctx, name, maxWidth);
		const lineHeight = fontSize * ACTOR_TOKEN_PLACEHOLDER.TEXT_LINE_HEIGHT_MULTIPLIER;
		const totalHeight = lines.length * lineHeight;
		if (
			lines.length <= ACTOR_TOKEN_PLACEHOLDER.TEXT_MAX_LINES &&
			totalHeight <= ACTOR_TOKEN_TEXTURE.SIZE * ACTOR_TOKEN_PLACEHOLDER.TEXT_MAX_HEIGHT_RATIO
		) {
			return { lines, fontSize, lineHeight };
		}
	}

	const fontSize = ACTOR_TOKEN_PLACEHOLDER.TEXT_MIN_FONT_SIZE;
	ctx.font = getPlaceholderFont(fontSize);
	return {
		lines: clampLinesToFit(
			ctx,
			wrapText(ctx, name, maxWidth),
			maxWidth
		),
		fontSize,
		lineHeight: fontSize * ACTOR_TOKEN_PLACEHOLDER.TEXT_LINE_HEIGHT_MULTIPLIER,
	};
}

function drawPlaceholderToken(
	ctx: CanvasRenderingContext2D,
	actor: ActorTokenDescriptor
) {
	ctx.fillStyle = createPlaceholderGradient(ctx, actor);
	ctx.fillRect(0, 0, ACTOR_TOKEN_TEXTURE.SIZE, ACTOR_TOKEN_TEXTURE.SIZE);

	const { lines, fontSize, lineHeight } = getPlaceholderTextLayout(ctx, actor.name);
	const blockHeight = (lines.length - 1) * lineHeight;
	const startY = ACTOR_TOKEN_TEXTURE.SIZE / 2 - blockHeight / 2;

	ctx.font = getPlaceholderFont(fontSize);
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	ctx.fillStyle = ACTOR_TOKEN_TEXTURE.TEXT_FILL;
	ctx.shadowColor = ACTOR_TOKEN_PLACEHOLDER.TEXT_SHADOW_COLOR;
	ctx.shadowBlur = ACTOR_TOKEN_PLACEHOLDER.TEXT_SHADOW_BLUR;
	ctx.shadowOffsetY = ACTOR_TOKEN_PLACEHOLDER.TEXT_SHADOW_OFFSET_Y;

	lines.forEach((line, index) => {
		ctx.fillText(line, ACTOR_TOKEN_TEXTURE.SIZE / 2, startY + index * lineHeight);
	});

	ctx.shadowColor = "transparent";
	ctx.shadowBlur = 0;
	ctx.shadowOffsetY = 0;
}

function strokeTokenFrame(
	ctx: CanvasRenderingContext2D,
	color: string,
	lineWidth: number
) {
	ctx.lineWidth = lineWidth;
	ctx.strokeStyle = color;
	// Stroke is centered on its path: the path sits `lineWidth/2` inside the
	// canvas edge, and the *outer* edge of the stroke lands on the canvas edge.
	// Subtracting the same inset from the path's corner radius keeps that outer
	// edge aligned with OUTER_CORNER_RADIUS regardless of stroke width.
	const inset = lineWidth / 2;
	roundRect(
		ctx,
		inset,
		inset,
		ACTOR_TOKEN_TEXTURE.SIZE - lineWidth,
		ACTOR_TOKEN_TEXTURE.SIZE - lineWidth,
		ACTOR_TOKEN_TEXTURE.OUTER_CORNER_RADIUS - inset
	);
	ctx.stroke();
}

function drawDefaultTokenFrame(ctx: CanvasRenderingContext2D) {
	strokeTokenFrame(
		ctx,
		ACTOR_TOKEN_TEXTURE.DEFAULT_OUTLINE_COLOR,
		ACTOR_TOKEN_TEXTURE.DEFAULT_OUTLINE_LINE_WIDTH
	);
}

/**
 * Builds a transparent texture containing only the selection outline. Apply
 * it to a plane the same size as the standee, hidden by default, and toggle
 * `visible` when selection changes -- avoids redrawing the actor's portrait
 * texture every time selection flips.
 */
export function createSelectionOutlineTexture(): THREE.Texture {
	const canvas = document.createElement("canvas");
	canvas.width = ACTOR_TOKEN_TEXTURE.SIZE;
	canvas.height = ACTOR_TOKEN_TEXTURE.SIZE;

	const ctx = canvas.getContext("2d");
	if (!ctx) {
		throw new Error("Unable to create actor selection outline canvas");
	}

	ctx.clearRect(0, 0, ACTOR_TOKEN_TEXTURE.SIZE, ACTOR_TOKEN_TEXTURE.SIZE);
	strokeTokenFrame(
		ctx,
		ACTOR_TOKEN_TEXTURE.SELECTED_OUTLINE_COLOR,
		ACTOR_TOKEN_TEXTURE.SELECTED_OUTLINE_LINE_WIDTH
	);

	return createTextureFromCanvas(canvas);
}

function createTextureFromCanvas(canvas: HTMLCanvasElement): THREE.CanvasTexture {
	const texture = new THREE.CanvasTexture(canvas);
	texture.colorSpace = THREE.SRGBColorSpace;
	texture.needsUpdate = true;
	return texture;
}

function clamp01(value: number): number {
	return Math.max(0, Math.min(1, value));
}

function getAlphaPickBounds(
	ctx: CanvasRenderingContext2D,
	size: number
): ActorTokenPickBounds | null {
	const { data } = ctx.getImageData(0, 0, size, size);
	let minX = size;
	let minY = size;
	let maxX = -1;
	let maxY = -1;

	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			const alpha = data[(y * size + x) * 4 + 3];
			if (alpha <= ACTOR_TOKEN_PICK.ALPHA_THRESHOLD) continue;
			minX = Math.min(minX, x);
			minY = Math.min(minY, y);
			maxX = Math.max(maxX, x);
			maxY = Math.max(maxY, y);
		}
	}

	if (maxX < minX || maxY < minY) return null;

	const padding = ACTOR_TOKEN_PICK.BOUNDS_PADDING_PX;
	return {
		minU: clamp01((minX - padding) / size),
		maxU: clamp01((maxX + 1 + padding) / size),
		minV: clamp01(1 - (maxY + 1 + padding) / size),
		maxV: clamp01(1 - (minY - padding) / size),
	};
}

export async function createActorTokenTexture(
	actor: ActorTokenDescriptor,
	options: TextureLoaderOptions
): Promise<THREE.Texture> {
	const canvas = document.createElement("canvas");
	canvas.width = ACTOR_TOKEN_TEXTURE.SIZE;
	canvas.height = ACTOR_TOKEN_TEXTURE.SIZE;

	const ctx = canvas.getContext("2d");
	if (!ctx) {
		throw new Error("Unable to create actor token canvas");
	}

	let image: HTMLImageElement | null = null;
	if (actor.imageId) {
		try {
			const blob = await loadImageBlob(actor.imageId, options);
			image = blob ? await loadImageElement(blob) : null;
		} catch (error) {
			console.warn(`[3DMap] Failed to load actor token image ${actor.imageId}`, error);
			image = null;
		}
	}

	ctx.clearRect(0, 0, ACTOR_TOKEN_TEXTURE.SIZE, ACTOR_TOKEN_TEXTURE.SIZE);

	// Cutout tokens (transparent images) get a different treatment: no
	// rounded clip, no frame stroke, and the image is fitted-to-contain so
	// its transparent margins show through. Cutout only applies when an
	// actual image loads -- the placeholder fallback always uses the framed
	// path so unloaded actors still have a recognizable token.
	if (actor.cutout && image) {
		drawImageContain(ctx, image);
		const texture = createTextureFromCanvas(canvas);
		texture.userData.actorPickBounds = getAlphaPickBounds(
			ctx,
			ACTOR_TOKEN_TEXTURE.SIZE
		);
		return texture;
	}

	ctx.save();
	roundRect(
		ctx,
		0,
		0,
		ACTOR_TOKEN_TEXTURE.SIZE,
		ACTOR_TOKEN_TEXTURE.SIZE,
		ACTOR_TOKEN_TEXTURE.OUTER_CORNER_RADIUS
	);
	ctx.clip();

	if (image) {
		drawImageCover(ctx, image);
	} else {
		drawPlaceholderToken(ctx, actor);
	}

	ctx.restore();
	drawDefaultTokenFrame(ctx);

	return createTextureFromCanvas(canvas);
}
