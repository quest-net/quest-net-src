// Guards two fixes from the 2026-10-26 UX audit, clicking the real DM UI:
//  - Overview cards: single click selects (stays on Overview), double click
//    opens the Inspector.
//  - Give dialog: selections persist across the Items/Skills tabs and confirm
//    gives everything selected.
// Also screenshots the Settings > Visibility tab at a 12-13" laptop width.
//   node test-kit/run.mjs test-kit/scenarios/ux-fixes.mjs --players 0
import assert from "node:assert/strict";

export const options = { characters: [] };

const activeTab = (page) =>
	page.locator('button.btn-square[aria-pressed="true"]').first().getAttribute("title");

export default async function uxFixes(kit) {
	const { dm } = kit;
	const page = dm.page;
	const target = "Dire Wolf";

	await page.locator('button.btn-square[title="Overview"]').click();
	const heading = page.getByRole("heading", { name: target, exact: true }).first();

	// Single click: selected, but still on Overview.
	await heading.click();
	await page.waitForTimeout(800);
	assert.equal(await activeTab(page), "Overview", "single click keeps the Overview tab");

	// Double click: Inspector.
	await heading.dblclick();
	await page.waitForTimeout(800);
	assert.equal(await activeTab(page), "Inspector", "double click opens the Inspector");

	const before = await dm.state((c) => {
		const wolf = c.GameState.Entities.find((e) => e.Name === "Dire Wolf");
		return {
			id: wolf.Id,
			inventory: (wolf.Inventory ?? []).length,
			skills: (wolf.Skills ?? []).length,
			item: c.ItemTemplates[0].Name,
			skill: c.SkillTemplates[0].Name,
		};
	});

	// Give: pick an item, switch tabs, pick a skill, confirm both.
	await page.getByRole("button", { name: "Give", exact: true }).click();
	const dialog = page.locator("dialog.modal-open");
	await dialog.getByText(before.item, { exact: true }).first().click();
	await dialog.getByRole("button", { name: /Skills/ }).click();
	await dialog.getByText(before.skill, { exact: true }).first().click();
	assert.match(
		await dialog.getByRole("button", { name: /Confirm/ }).innerText(),
		/\(2\)/,
		"confirm counts picks from both tabs"
	);
	await dm.shot("ux-give-two-tabs");
	await dialog.getByRole("button", { name: /Confirm/ }).click();

	await dm.waitFor(
		(c, b) => {
			const wolf = c.GameState.Entities.find((e) => e.Id === b.id);
			return (
				(wolf.Inventory ?? []).length > b.inventory && (wolf.Skills ?? []).length > b.skills
			);
		},
		{ arg: before, message: "item and skill both given" }
	);

	// Log: DM actions read [DM], rows name their subject.
	await page.locator('button.btn-square[title="Log"]').click();
	await page.waitForTimeout(500);
	await dm.shot("ux-log");

	// Settings > Visibility at a 12-13" laptop width.
	await page.setViewportSize({ width: 1280, height: 800 });
	await page.locator('[data-tip="Settings"]').first().click();
	await page.getByText("Visibility", { exact: true }).first().click();
	await page.waitForTimeout(500);
	console.log("screenshot:", await dm.shot("ux-settings-visibility-1280"));
}
