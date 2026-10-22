// Regression: terrains minted for a campaign that does not own the payload
// buffer (new campaign, or default stamps re-added on restore) must reach OPFS.
// Before the fix the default terrain and all default stamps had no voxels.
//   node test-kit/run.mjs test-kit/scenarios/new-campaign-terrains.mjs --players 0
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { FIXTURE_PATH } from "../kit.mjs";

// Opens the campaign (the buffer reset that used to lose the voxels), then
// reports which terrains have no stored payload.
async function openAndFindMissing(dm, campaignId) {
	await dm.goto(campaignId);
	// Wait for THIS campaign: the previous one stays active during the switch.
	await dm.waitFor((c, id) => c.Id === id && !!window.__qnActionService, {
		arg: campaignId,
		message: "campaign opened",
	});
	return dm.eval(async (qn, id) => {
		const { CampaignUtils } = await qn.import("domains/Campaign/CampaignUtils.ts");
		const { TerrainStorageService } = await qn.import("services/TerrainStorageService.ts");
		const campaign = qn.campaign;
		if (campaign.Id !== id) throw new Error(`active campaign is ${campaign.Id}, wanted ${id}`);
		const missing = await CampaignUtils.findMissingBinaries(campaign);
		const sizes = {};
		for (const t of campaign.VoxelTerrains) {
			const payload = await TerrainStorageService.getPayloadForServing(campaign, t.Id);
			sizes[t.Name] = payload?.voxels.length ?? 0;
		}
		return { missingTerrains: missing.terrainIds, sizes };
	}, campaignId);
}

export default async function newCampaignTerrains(kit) {
	const { dm } = kit;

	// 1. A brand-new campaign, created exactly like the Campaigns page does.
	const newId = await dm.eval(async (qn) => {
		const { CampaignUtils } = await qn.import("domains/Campaign/CampaignUtils.ts");
		return (await CampaignUtils.create({ name: "Fresh" }, qn.ctx)).Id;
	});
	const fresh = await openAndFindMissing(dm, newId);
	console.log("new campaign terrains:", fresh.sizes);
	assert.deepEqual(fresh.missingTerrains, [], "new campaign has every terrain payload");
	assert.ok(fresh.sizes["Default Terrain"] > 0, "default terrain has voxels");

	// 2. Restore an export missing one default stamp: restore re-adds it.
	const data = JSON.parse(await readFile(FIXTURE_PATH, "utf8"));
	const stampIndex = data.campaign.VoxelTerrains.findIndex((t) => t.Name === "Large Oak");
	assert.ok(stampIndex >= 0, "fixture has the Large Oak stamp");
	const [removed] = data.campaign.VoxelTerrains.splice(stampIndex, 1);
	delete data.terrainData[removed.Id];
	const restoredId = await dm.eval(async (qn, data) => {
		const { CampaignUtils } = await qn.import("domains/Campaign/CampaignUtils.ts");
		return (await CampaignUtils.restoreFromExportData(data, qn.ctx, { mode: "copy" })).Id;
	}, data);
	const restored = await openAndFindMissing(dm, restoredId);
	assert.ok(restored.sizes["Large Oak"] > 0, "re-added stamp has voxels");
	assert.deepEqual(restored.missingTerrains, [], "restored campaign has every terrain payload");

	console.log("screenshot:", await dm.shot("new-campaign"));
}
