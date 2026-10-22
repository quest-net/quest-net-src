// Regression: the FIRST inspect after joining (double-click a card in the
// Party / Overview panel) must land on the Inspector tab. It used to bounce back
// to the first tab because the tab switched before Main knew about the
// selection. Clicks the real UI.
//   node test-kit/run.mjs test-kit/scenarios/inspect-tab.mjs
import assert from "node:assert/strict";

export const options = { characters: ["Beast Tamer"] };

const activeTab = (peer) =>
	peer.page.locator('button.btn-square[aria-pressed="true"]').first().getAttribute("title");

async function inspectFromPanel(peer, panelTitle, actorName) {
	await peer.page.locator(`button.btn-square[title="${panelTitle}"]`).click();
	// Double-click the card's name: stat bars and buttons ignore double-clicks.
	await peer.page.getByRole("heading", { name: actorName, exact: true }).first().dblclick();
	await peer.page.waitForTimeout(1000); // let any fallback effect run
	return activeTab(peer);
}

export default async function inspectTab(kit) {
	const { dm, players } = kit;
	const [tamer] = players;

	// Player: first inspect is their own Wolf (an owned actor) from the Party panel.
	assert.equal(await inspectFromPanel(tamer, "Party", "Wolf"), "Inspector", "player's first inspect opens the Inspector");
	await tamer.page.getByPlaceholder("Actor name").waitFor({ timeout: 5000 });
	assert.equal(await tamer.page.getByPlaceholder("Actor name").inputValue(), "Wolf");
	// A second inspect of someone else still works.
	assert.equal(await inspectFromPanel(tamer, "Party", "Aria"), "Inspector", "player's second inspect opens the Inspector");

	// DM: first inspect from the Overview panel.
	assert.equal(await inspectFromPanel(dm, "Overview", "Dire Wolf"), "Inspector", "DM's first inspect opens the Inspector");

	console.log("screenshot:", await tamer.shot("inspect-tab"));
}
