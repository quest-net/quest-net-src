// .qvx import: the reader accepts plain and deflated files, rejects corrupt
// ones, and the terrain editor's Import button loads a .qvx exactly.
//   node test-kit/run.mjs test-kit/scenarios/qvx-import.mjs --players 0
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { crc32, deflateRawSync } from "node:zlib";

/** Minimal .qvx writer (format: the separate qvx tools' SPEC.md). */
function makeQvx(terrain, svo, deflate) {
	const chunk = (id, data) => {
		const head = Buffer.alloc(8);
		head.write(id, 0, "ascii");
		head.writeUInt32LE(data.length, 4);
		const tail = Buffer.alloc(4);
		tail.writeUInt32LE(crc32(data), 0);
		return Buffer.concat([head, data, tail]);
	};
	const body = deflate ? deflateRawSync(svo) : svo;
	return Buffer.concat([
		Buffer.from([0x51, 0x56, 0x58, 0x1a, 1, 0, 0, 0]),
		chunk("META", Buffer.from(JSON.stringify({ format: "qvx", version: 1, terrain }))),
		chunk("VOXL", Buffer.concat([Buffer.from([deflate ? 1 : 0]), body])),
	]);
}

export default async function qvxImport(kit) {
	const { dm } = kit;
	const fixture = JSON.parse(await readFile(new URL("../kitchen-sink.json", import.meta.url), "utf8"));
	const source = fixture.campaign.VoxelTerrains.find((t) => t.Name === "Forest Clearing");
	const svo = Buffer.from(fixture.terrainData[source.Id].voxels, "base64");
	const terrain = {
		Name: "From QVX",
		Width: source.Width,
		Length: source.Length,
		Height: source.Height,
		Resolution: source.Resolution ?? 1,
		Lighting: { Color: "#ff7a3d", Intensity: 1.15, Rotation: 252, Elevation: 18 },
		Background: { Color: "#7c2d6f" },
	};
	const plain = makeQvx(terrain, svo, false);
	const deflated = makeQvx(terrain, svo, true);
	const corrupt = Buffer.from(deflated);
	corrupt[corrupt.length - 6] ^= 0xff;

	// Reader, in the real app.
	const results = await dm.eval(async (qn, files) => {
		const { parseQvxFile } = await qn.import("utils/terrain/import/QvxImportUtils.ts");
		const toBuffer = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer;
		const out = {};
		for (const [name, b64] of Object.entries(files)) {
			try {
				const r = await parseQvxFile(toBuffer(b64));
				out[name] = { ok: true, voxels: btoa(String.fromCharCode(...r.Voxels)), width: r.Width, lighting: r.Lighting };
			} catch (e) {
				out[name] = { ok: false, error: String(e.message ?? e) };
			}
		}
		return out;
	}, { plain: plain.toString("base64"), deflated: deflated.toString("base64"), corrupt: corrupt.toString("base64") });

	assert.ok(results.plain.ok, results.plain.error);
	assert.equal(results.plain.voxels, svo.toString("base64"), "plain .qvx voxels are exact");
	assert.ok(results.deflated.ok, results.deflated.error);
	assert.equal(results.deflated.voxels, svo.toString("base64"), "deflated .qvx voxels are exact");
	assert.equal(results.deflated.lighting.Color, "#ff7a3d");
	assert.ok(!results.corrupt.ok && /corrupted/.test(results.corrupt.error), "corrupt file rejected");

	// The real UI: Terrains tab -> Create Terrain -> Import the file -> Save.
	const page = dm.page;
	await page.getByRole("button", { name: "Terrains" }).first().click();
	await page.getByRole("button", { name: "Create Terrain" }).click();
	const before = await dm.state((c) => c.VoxelTerrains.length);
	await page.locator('input[type="file"][accept=".vox,.qvx"]').setInputFiles({ name: "from.qvx", mimeType: "application/octet-stream", buffer: deflated });
	await page.waitForTimeout(1000);
	await dm.shot("qvx-import");
	await page.getByRole("button", { name: "Create", exact: true }).first().click();
	await dm.waitFor((c, n) => c.VoxelTerrains.length === n, { arg: before + 1, message: "terrain created" });

	const created = await dm.state((c) => c.VoxelTerrains[c.VoxelTerrains.length - 1]);
	assert.equal(created.ContentHash, fixture.terrainData[source.Id].contentHash, "stored voxels match the file exactly");
	assert.deepEqual([created.Width, created.Length, created.Height, created.Resolution], [terrain.Width, terrain.Length, terrain.Height, terrain.Resolution]);
	assert.deepEqual(created.Lighting, terrain.Lighting);
	assert.deepEqual(created.Background, terrain.Background);
}
