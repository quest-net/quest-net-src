// Test kit: one DM + N players, each in its own isolated browser context
// (separate localStorage / IndexedDB / OPFS = separate person), wired through a
// local Nostr relay and a dedicated Vite dev server. See test-kit/README.md.
import { readFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { chromium } from "playwright";
import { createServer } from "vite";
import { startRelay } from "./relay.mjs";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const FIXTURE_PATH = path.join(ROOT, "test-kit", "kitchen-sink.json");
export const OUT_DIR = path.join(ROOT, "test-kit", "out");
// Fixed identity so URLs never change: a GUID routes to DMView, a room code to PlayerView.
export const DM_CAMPAIGN_ID = "00000000-0000-4000-8000-00000000c0de";
export const ROOM_CODE = "testkit";

/** One simulated person: a page plus helpers that run inside it. */
class Peer {
	constructor(kit, name, context, page) {
		this.kit = kit;
		this.name = name;
		this.context = context;
		this.page = page;
		this.logs = [];
		page.on("console", (msg) => {
			const line = `[${name}] ${msg.type()}: ${msg.text()}`;
			this.logs.push(line);
			if (kit.verbose || msg.type() === "error") console.log(line);
		});
		page.on("pageerror", (err) => {
			const line = `[${name}] pageerror: ${err.message}`;
			this.logs.push(line);
			console.log(line);
		});
	}

	/**
	 * Runs `fn(qn, arg)` inside the page. `qn` gives:
	 *   qn.import("domains/Campaign/CampaignUtils.ts") -> the app's own module instance
	 *   qn.ctx       -> the live contextStore proxy (write through it, like the app does)
	 *   qn.campaign  -> contextStore.ActiveCampaign
	 *   qn.actions   -> the mounted ActionService (or null)
	 *   qn.plain(x)  -> toPlain(x), for returning proxy data to Node
	 */
	async eval(fn, arg) {
		return this.page.evaluate(
			async ({ src, arg }) => {
				const imp = (p) => import(/* @vite-ignore */ `/src/${p}`);
				const { contextStore } = await imp("domains/Context/contextStore.ts");
				const { toPlain } = await imp("utils/toPlain.ts");
				const qn = {
					import: imp,
					ctx: contextStore,
					get campaign() {
						return contextStore.ActiveCampaign;
					},
					get actions() {
						return window.__qnActionService ?? null;
					},
					plain: toPlain,
				};
				// eslint-disable-next-line no-new-func
				return await new Function(`return (${src})`)()(qn, arg);
			},
			{ src: fn.toString(), arg }
		);
	}

	/** Dispatch a registered action as this person and wait for it to apply locally. */
	act(actionKey, params) {
		return this.eval(
			(qn, { actionKey, params }) => qn.actions.executeAndWait(actionKey, params),
			{ actionKey, params }
		);
	}

	/** Plain copy of this person's view of the campaign (optionally a sub-path via fn). */
	state(fn = (c) => c) {
		return this.eval(
			(qn, src) => qn.plain(new Function(`return (${src})`)()(qn.campaign)),
			fn.toString()
		);
	}

	/** Poll `fn(campaign, arg)` in this page until it returns truthy. */
	async waitFor(fn, { arg, timeout = 20000, message } = {}) {
		await this.page.waitForFunction(
			({ src, arg }) => {
				const c = window.__qnCtx?.ActiveCampaign;
				return !!c && !!new Function(`return (${src})`)()(c, arg);
			},
			{ src: fn.toString(), arg },
			{ timeout, polling: 250 }
		).catch((err) => {
			throw new Error(`[${this.name}] waitFor timed out: ${message ?? fn}\n${err.message}`);
		});
	}

	async shot(label) {
		await mkdir(OUT_DIR, { recursive: true });
		const file = path.join(OUT_DIR, `${label}-${this.name}.png`);
		await this.page.screenshot({ path: file });
		return file;
	}

	goto(hashPath) {
		return this.page.goto(`${this.kit.baseUrl}/#/${hashPath}`);
	}
}

export async function openPeer(kit, name) {
	const context = await kit.browser.newContext({ viewport: { width: 1400, height: 900 } });
	const page = await context.newPage();
	const peer = new Peer(kit, name, context, page);
	await page.goto(`${kit.baseUrl}/#/`);
	await page.waitForFunction(() => document.querySelector("#root")?.childElementCount > 0, null, {
		timeout: 60000,
	});
	await peer.eval((qn, name) => {
		qn.ctx.User.Name = name;
		window.__qnCtx = qn.ctx; // sync access for waitFor polling
	}, name);
	return peer;
}

/**
 * Starts everything. Options:
 *   players   number of player peers (default 2; each claims GameState.Characters[i])
 *   characters  names to claim per player instead, e.g. ["Beast Tamer", null];
 *             null = no character (the player sits on the character select screen)
 *   fixture   path to a CampaignExportData JSON, or null to start with no campaign
 *   headed    show the browser windows
 *   port      Vite port (default 3100, so it never collides with `npm run dev`)
 */
export async function startKit({
	players = 2,
	characters: characterNames,
	fixture = FIXTURE_PATH,
	headed = false,
	port = 3100,
	relayPort = 7777,
	verbose = false,
} = {}) {
	const kit = { verbose, players: [] };

	kit.relay = await startRelay(relayPort);
	process.env.VITE_RELAY_URLS = `ws://localhost:${relayPort}`;
	kit.vite = await createServer({
		root: ROOT,
		logLevel: "warn",
		server: { port, strictPort: true },
	});
	await kit.vite.listen();
	kit.baseUrl = `http://localhost:${port}`;

	kit.browser = await chromium.launch({
		channel: "chrome", // the installed Chrome; no Playwright browser download needed
		headless: !headed,
		// Without this, WebRTC hides host candidates behind mDNS names that
		// often fail to resolve between local contexts.
		args: ["--disable-features=WebRtcHideLocalIpsWithMdns"],
	});

	kit.dm = await openPeer(kit, "DM");

	if (fixture) {
		const data = JSON.parse(await readFile(fixture, "utf8"));
		data.campaign.RoomCode = ROOM_CODE;
		await kit.dm.eval(
			async (qn, { data, id }) => {
				const { CampaignUtils } = await qn.import("domains/Campaign/CampaignUtils.ts");
				await CampaignUtils.restoreFromExportData(data, qn.ctx, {
					mode: "replace",
					targetCampaignId: id,
				});
			},
			{ data, id: DM_CAMPAIGN_ID }
		);
		await kit.dm.goto(DM_CAMPAIGN_ID);
		await kit.dm.page.waitForFunction(() => !!window.__qnActionService, null, { timeout: 30000 });

		const characters = await kit.dm.state((c) =>
			c.GameState.Characters.map((ch) => ({ id: ch.Id, name: ch.Name }))
		);
		const playerCount = characterNames ? characterNames.length : players;
		for (let i = 0; i < playerCount; i++) {
			const p = await openPeer(kit, `P${i + 1}`);
			const characterId = characterNames
				? characters.find((ch) => ch.name === characterNames[i])?.id
				: characters[i]?.id;
			if (characterNames && characterNames[i] && !characterId) {
				throw new Error(`fixture has no spawned character named "${characterNames[i]}"`);
			}
			if (characterId) {
				await p.eval(
					async (qn, { room, characterId }) => {
						const { UserUtils } = await qn.import("domains/User/UserUtils.ts");
						UserUtils.selectCharacter({ campaignId: room, characterId }, qn.ctx);
					},
					{ room: ROOM_CODE, characterId }
				);
			}
			await p.goto(ROOM_CODE);
			kit.players.push(p);
		}
		await Promise.all(kit.players.map((p) => waitForDm(p)));
	}

	kit.peers = () => [kit.dm, ...kit.players];
	kit.close = async () => {
		await kit.browser?.close().catch(() => {});
		await kit.vite?.close().catch(() => {});
		kit.relay?.close();
	};
	return kit;
}

/** A player is "in" once it holds the DM's campaign and knows the DM's peer id. */
export async function waitForDm(peer, timeout = 45000) {
	await peer.page
		.waitForFunction(
			() => !!window.__qnActionService?.getDmPeerId?.(),
			null,
			{ timeout, polling: 250 }
		)
		.catch((err) => {
			throw new Error(`[${peer.name}] never connected to the DM: ${err.message}`);
		});
	await peer.waitFor((c) => c.GameState?.Characters?.length >= 0, {
		timeout,
		message: "campaign never arrived",
	});
}
