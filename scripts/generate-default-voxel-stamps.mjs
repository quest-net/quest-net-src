import { promises as fs } from "fs";
import path from "path";
import ts from "typescript";
import { fileURLToPath, pathToFileURL } from "url";

const PREFERRED_STAMP_RESOLUTION = 3;
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const STAMPS_ROOT = path.join(REPO_ROOT, "public", "stamps");
const OUTPUT_PATH = path.join(REPO_ROOT, "src", "data", "defaultVoxelStamps.ts");
const TS_CACHE_DIR = path.join(REPO_ROOT, "node_modules", ".cache", "quest-net-ts");
const TRAILING_NAME_MODIFIERS = new Set(["Large", "Medium", "Small", "Tall"]);

if (typeof globalThis.btoa === "undefined") {
	globalThis.btoa = (value) => Buffer.from(value, "binary").toString("base64");
}

if (typeof globalThis.atob === "undefined") {
	globalThis.atob = (value) => Buffer.from(value, "base64").toString("binary");
}

async function pathExists(filePath) {
	try {
		await fs.access(filePath);
		return true;
	} catch {
		return false;
	}
}

async function resolveTsImport(importerPath, specifier) {
	const basePath = path.resolve(path.dirname(importerPath), specifier);
	const candidates = path.extname(basePath)
		? [basePath]
		: [
			`${basePath}.ts`,
			`${basePath}.tsx`,
			path.join(basePath, "index.ts"),
			path.join(basePath, "index.tsx"),
		];

	for (const candidate of candidates) {
		if (await pathExists(candidate)) return candidate;
	}

	throw new Error(`Could not resolve ${specifier} from ${importerPath}`);
}

function outputPathForSource(sourcePath) {
	const relative = path.relative(REPO_ROOT, sourcePath);
	return path.join(TS_CACHE_DIR, relative).replace(/\.(ts|tsx)$/i, ".mjs");
}

function findRelativeImports(source) {
	const specifiers = new Set();
	const staticImport = /\b(?:import|export)\s+(?:[^'"]*?\s+from\s+)?["'](\.{1,2}\/[^"']+)["']/g;
	const dynamicImport = /\bimport\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/g;

	for (const regex of [staticImport, dynamicImport]) {
		let match = regex.exec(source);
		while (match) {
			specifiers.add(match[1]);
			match = regex.exec(source);
		}
	}

	return [...specifiers];
}

function escapeRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function transpileTsModule(sourcePath, seen = new Map()) {
	if (seen.has(sourcePath)) return seen.get(sourcePath);

	const outputPath = outputPathForSource(sourcePath);
	seen.set(sourcePath, outputPath);

	const source = await fs.readFile(sourcePath, "utf8");
	const importMap = new Map();

	for (const specifier of findRelativeImports(source)) {
		const importedSourcePath = await resolveTsImport(sourcePath, specifier);
		const importedOutputPath = await transpileTsModule(importedSourcePath, seen);
		let rewritten = path
			.relative(path.dirname(outputPath), importedOutputPath)
			.replace(/\\/g, "/");
		if (!rewritten.startsWith(".")) rewritten = `./${rewritten}`;
		importMap.set(specifier, rewritten);
	}

	let js = ts.transpileModule(source, {
		fileName: sourcePath,
		compilerOptions: {
			target: ts.ScriptTarget.ES2020,
			module: ts.ModuleKind.ESNext,
			jsx: ts.JsxEmit.ReactJSX,
		},
	}).outputText;

	for (const [specifier, rewritten] of importMap) {
		js = js.replace(
			new RegExp(`(["'])${escapeRegExp(specifier)}\\1`, "g"),
			`$1${rewritten}$1`
		);
	}

	await fs.mkdir(path.dirname(outputPath), { recursive: true });
	await fs.writeFile(outputPath, js, "utf8");
	return outputPath;
}

async function importTerrainVoxTools() {
	const entry = path.join(
		REPO_ROOT,
		"src",
		"utils",
		"terrain",
		"import",
		"VoxImportUtils.ts"
	);
	const outputPath = await transpileTsModule(entry);
	return import(`${pathToFileURL(outputPath).href}?t=${Date.now()}`);
}

async function listVoxFiles(dir) {
	const entries = await fs.readdir(dir, { withFileTypes: true });
	const files = [];

	for (const entry of entries) {
		const fullPath = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			files.push(...await listVoxFiles(fullPath));
			continue;
		}
		if (entry.isFile() && entry.name.toLowerCase().endsWith(".vox")) {
			files.push(fullPath);
		}
	}

	return files.sort((a, b) =>
		path.relative(STAMPS_ROOT, a).localeCompare(path.relative(STAMPS_ROOT, b))
	);
}

function slugify(value) {
	return value
		.replace(/\\/g, "/")
		.replace(/\.vox$/i, "")
		.split("/")
		.flatMap((part) => part.split(/[^a-zA-Z0-9]+/))
		.filter(Boolean)
		.map((part) => part.toLowerCase())
		.join("-");
}

function titleCaseSlug(value) {
	const words = value
		.replace(/\.vox$/i, "")
		.split(/[^a-zA-Z0-9]+/)
		.filter(Boolean)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase());
	const trailingWord = words[words.length - 1];
	if (words.length > 1 && TRAILING_NAME_MODIFIERS.has(trailingWord)) {
		words.unshift(words.pop());
	}
	return words.join(" ");
}

function getStampMetadata(filePath) {
	const relativePath = path.relative(STAMPS_ROOT, filePath).replace(/\\/g, "/");
	const parts = relativePath.split("/");
	const fileName = parts[parts.length - 1];
	const fileStem = fileName.replace(/\.vox$/i, "");
	const collection = parts.length > 1 ? parts[0] : "starter";
	const folderParts = parts.slice(1, -1);
	const idParts =
		collection === "starter"
			? [...folderParts, fileStem]
			: [collection, ...folderParts, fileStem];
	const templateId = slugify(idParts.join("/"));
	const pathTag = ["path:stamps", ...folderParts.map(slugify)]
		.filter(Boolean)
		.join("/");

	return {
		templateId,
		name: titleCaseSlug(fileStem),
		tags: [
			pathTag || "path:stamps",
			`builtin:${slugify(collection)}-stamps`,
			`builtin-id:${templateId}`,
		],
	};
}

function pickResolution(options, filePath) {
	const valid = options.filter((option) => option.fits);
	if (valid.length === 0) {
		throw new Error(
			`${path.relative(REPO_ROOT, filePath)} is too large for every supported resolution.`
		);
	}

	return (
		valid.find((option) => option.resolution === PREFERRED_STAMP_RESOLUTION) ??
		valid[valid.length - 1]
	).resolution;
}

function stringLiteral(value) {
	return JSON.stringify(value);
}

function chunkedStringLiteral(value, indent) {
	const chunks = value.match(/.{1,100}/g) ?? [""];
	if (chunks.length === 1) return stringLiteral(value);

	return [
		"[",
		...chunks.map((chunk) => `${indent}\t${stringLiteral(chunk)},`),
		`${indent}].join("")`,
	].join("\n");
}

function formatTags(tags) {
	return tags.map((tag) => `\t\t\t${stringLiteral(tag)},`).join("\n");
}

function formatTemplate(template) {
	return [
		"\t{",
		`\t\tTemplateId: ${stringLiteral(template.TemplateId)},`,
		`\t\tName: ${stringLiteral(template.Name)},`,
		`\t\tWidth: ${template.Width},`,
		`\t\tLength: ${template.Length},`,
		`\t\tHeight: ${template.Height},`,
		`\t\tResolution: ${template.Resolution},`,
		`\t\tVoxels: ${chunkedStringLiteral(template.Voxels, "\t\t")},`,
		"\t\tTags: [",
		formatTags(template.Tags),
		"\t\t],",
		"\t},",
	].join("\n");
}

function formatOutput(templates) {
	return [
		"/*",
		" * This file is generated by scripts/generate-default-voxel-stamps.mjs.",
		" * Run npm run generate:stamps after changing .vox files under public/stamps.",
		" */",
		"",
		"import {",
		"\tcreateDefaultVoxelTerrainBackground,",
		"\tcreateDefaultVoxelTerrainLighting,",
		"\ttype VoxelTerrain,",
		"} from \"../domains/VoxelTerrain/VoxelTerrain\";",
		"",
		"export interface DefaultVoxelStampTemplate {",
		"\tTemplateId: string;",
		"\tName: string;",
		"\tWidth: number;",
		"\tLength: number;",
		"\tHeight: number;",
		"\tResolution: number;",
		"\tVoxels: string;",
		"\tTags: readonly string[];",
		"}",
		"",
		"const DEFAULT_VOXEL_STAMP_BUILTIN_ID_PREFIX = \"builtin-id:\";",
		"",
		"export const DEFAULT_VOXEL_STAMP_TEMPLATES = [",
		templates.map(formatTemplate).join("\n"),
		"] as const satisfies readonly DefaultVoxelStampTemplate[];",
		"",
		"function createDefaultVoxelStamp(stamp: DefaultVoxelStampTemplate): VoxelTerrain {",
		"\treturn {",
		"\t\tId: crypto.randomUUID(),",
		"\t\tName: stamp.Name,",
		"\t\tWidth: stamp.Width,",
		"\t\tLength: stamp.Length,",
		"\t\tHeight: stamp.Height,",
		"\t\tResolution: stamp.Resolution,",
		"\t\tVoxels: stamp.Voxels,",
		"\t\tVoxelsLoaded: true,",
		"\t\tLighting: createDefaultVoxelTerrainLighting(),",
		"\t\tBackground: createDefaultVoxelTerrainBackground(),",
		"\t\tTags: [...stamp.Tags],",
		"\t};",
		"}",
		"",
		"export function getDefaultVoxelStampTemplateId(",
		"\tterrain: Pick<VoxelTerrain, \"Tags\">",
		"): string | null {",
		"\tconst tag = terrain.Tags?.find((candidate) =>",
		"\t\tcandidate.startsWith(DEFAULT_VOXEL_STAMP_BUILTIN_ID_PREFIX)",
		"\t);",
		"\treturn tag?.slice(DEFAULT_VOXEL_STAMP_BUILTIN_ID_PREFIX.length) ?? null;",
		"}",
		"",
		"export function createDefaultVoxelStamps(",
		"\texistingTemplateIds: ReadonlySet<string> = new Set()",
		"): VoxelTerrain[] {",
		"\treturn DEFAULT_VOXEL_STAMP_TEMPLATES",
		"\t\t.filter((stamp) => !existingTemplateIds.has(stamp.TemplateId))",
		"\t\t.map(createDefaultVoxelStamp);",
		"}",
		"",
		"export function addMissingDefaultVoxelStamps(campaign: {",
		"\tVoxelTerrains?: VoxelTerrain[];",
		"}): number {",
		"\tcampaign.VoxelTerrains ??= [];",
		"\tconst existingTemplateIds = new Set<string>();",
		"\tfor (const terrain of campaign.VoxelTerrains) {",
		"\t\tconst templateId = getDefaultVoxelStampTemplateId(terrain);",
		"\t\tif (templateId) existingTemplateIds.add(templateId);",
		"\t}",
		"",
		"\tconst missing = createDefaultVoxelStamps(existingTemplateIds);",
		"\tcampaign.VoxelTerrains.push(...missing);",
		"\treturn missing.length;",
		"}",
		"",
	].join("\n");
}

async function main() {
	const { buildTerrainFromVox, getVoxResolutionOptions, parseVoxFile } =
		await importTerrainVoxTools();
	const voxFiles = await listVoxFiles(STAMPS_ROOT);
	const templates = [];

	for (const filePath of voxFiles) {
		const buffer = await fs.readFile(filePath);
		const parsed = parseVoxFile(buffer.buffer.slice(
			buffer.byteOffset,
			buffer.byteOffset + buffer.byteLength
		));
		const resolution = pickResolution(getVoxResolutionOptions(parsed), filePath);
		const terrain = buildTerrainFromVox(parsed, resolution);
		const metadata = getStampMetadata(filePath);

		templates.push({
			TemplateId: metadata.templateId,
			Name: metadata.name,
			Width: terrain.Width,
			Length: terrain.Length,
			Height: terrain.Height,
			Resolution: terrain.Resolution,
			// buildTerrainFromVox now returns raw SVO bytes; the source file embeds
			// the payload as a base64 string literal (readable, diffable), decoded
			// back to bytes at load time in createDefaultVoxelStamp.
			Voxels: Buffer.from(terrain.Voxels).toString("base64"),
			Tags: metadata.tags,
		});
	}

	await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
	await fs.writeFile(OUTPUT_PATH, formatOutput(templates), "utf8");
	console.log(
		`Generated ${templates.length} default voxel stamp templates at ${path.relative(REPO_ROOT, OUTPUT_PATH)}.`
	);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
