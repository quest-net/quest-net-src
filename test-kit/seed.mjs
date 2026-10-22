// Builds test-kit/kitchen-sink.json: a campaign touching most features, made
// through the real ACTION_REGISTRY handlers so it is always schema-correct.
// Run: node test-kit/run.mjs --seed   (then commit the JSON)
//
// When you add a feature, add a few lines here and re-seed. Old fixture files
// keep loading anyway: restoreFromExportData runs the campaign migrations.
import { writeFile } from "node:fs/promises";
import { FIXTURE_PATH, ROOM_CODE } from "./kit.mjs";

export async function seed(kit) {
	const { dm } = kit;

	const campaignId = await dm.eval(async (qn, room) => {
		const { CampaignUtils } = await qn.import("domains/Campaign/CampaignUtils.ts");
		const info = await CampaignUtils.create({ name: "Kitchen Sink", roomCode: room }, qn.ctx);
		return info.Id;
	}, ROOM_CODE);
	await dm.goto(campaignId);
	await dm.page.waitForFunction(() => !!window.__qnActionService, null, { timeout: 30000 });

	const json = await dm.eval(async (qn) => {
		const run = (key, params) => qn.actions.executeAndWait(key, params);
		const c = () => qn.campaign;
		const { CharacterUtils } = await qn.import("domains/Character/CharacterUtils.ts");
		const { EntityUtils } = await qn.import("domains/Entity/EntityUtils.ts");
		const { IndexedDBUtilities } = await qn.import("utils/IndexedDBUtilities.ts");
		const { CampaignUtils } = await qn.import("domains/Campaign/CampaignUtils.ts");
		const { createFlatVoxelTerrain } = await qn.import(
			"utils/terrain/editor/VoxelTerrainEditorUtils.ts"
		);
		const { encodeVoxels } = await qn.import("utils/terrain/data/VoxelDataUtils.ts");
		const id = () => crypto.randomUUID();

		// ---------------------------------------------------------------- images
		async function makeImage(name, { w, h, bg, fg, glyph, cutout }) {
			const canvas = new OffscreenCanvas(w, h);
			const g = canvas.getContext("2d");
			if (cutout) {
				g.fillStyle = bg;
				g.beginPath();
				g.ellipse(w / 2, h / 2, w * 0.42, h * 0.46, 0, 0, Math.PI * 2);
				g.fill();
			} else {
				const grad = g.createLinearGradient(0, 0, w, h);
				grad.addColorStop(0, bg);
				grad.addColorStop(1, fg);
				g.fillStyle = grad;
				g.fillRect(0, 0, w, h);
			}
			g.fillStyle = cutout ? fg : "#ffffffcc";
			g.font = `bold ${Math.floor(h * 0.4)}px sans-serif`;
			g.textAlign = "center";
			g.textBaseline = "middle";
			g.fillText(glyph, w / 2, h / 2);
			const blob = await canvas.convertToBlob({ type: "image/webp", quality: 0.8 });
			const image = {
				Id: id(),
				Name: name,
				FileSize: blob.size,
				MimeType: "image/webp",
				Width: w,
				Height: h,
				Cutout: cutout || undefined,
				Tags: [cutout ? "tokens" : "scenes"],
			};
			await IndexedDBUtilities.save(image.Id, blob);
			await run("image:create", { image });
			return image.Id;
		}
		const token = (name, bg, glyph) =>
			makeImage(name, { w: 256, h: 256, bg, fg: "#ffffff", glyph, cutout: true });
		const img = {
			aria: await token("Aria token", "#2563eb", "A"),
			borin: await token("Borin token", "#16a34a", "B"),
			cyra: await token("Cyra token", "#9333ea", "C"),
			goblin: await token("Goblin token", "#65a30d", "G"),
			wolf: await token("Wolf token", "#57534e", "W"),
			tamer: await token("Beast Tamer token", "#ca8a04", "T"),
			master: await token("Puppet Master token", "#be185d", "M"),
			puppet: await token("Puppet token", "#f472b6", "P"),
			necro: await token("Necromancer token", "#1e293b", "N"),
			skeleton: await token("Skeleton token", "#e7e5e4", "S"),
			potion: await token("Potion icon", "#dc2626", "+"),
			sword: await token("Sword icon", "#64748b", "/"),
			forest: await makeImage("Forest clearing", {
				w: 640, h: 360, bg: "#14532d", fg: "#84cc16", glyph: "Forest",
			}),
			cellar: await makeImage("Old cellar", {
				w: 640, h: 360, bg: "#1c1917", fg: "#78716c", glyph: "Cellar",
			}),
		};

		// -------------------------------------------------------------- settings
		await run("setting:edit", {
			updates: {
				AttributeDefinitions: [
					{ Id: "class", Name: "Class" },
					{ Id: "background", Name: "Background" },
				],
				SharedInventories: [{ Id: "party-stash", Name: "Party Stash", Stats: [], Inventory: [] }],
			},
		});

		// ------------------------------------------------------------- terrains
		// Voxel axes: x/z horizontal (tile x/y), y up. Palette 240 stone, 241
		// water, 242 grass, 244 wood, 245 lava; 0-239 regular colors.
		function forestVoxels(W, L) {
			const out = [];
			for (let z = 0; z < L; z++) {
				for (let x = 0; x < W; x++) {
					const hill = Math.max(0, 4 - Math.hypot(x - 19, z - 4)); // mound NE
					const pond = Math.hypot(x - 5, z - 18) < 3; // pond SW
					const top = pond ? 1 : 2 + Math.round(hill);
					for (let y = 0; y < top; y++) out.push({ x, y, z, color: y < top - 1 ? 30 : 242 });
					if (pond) out.push({ x, y: 1, z, color: 241 });
					if (z === 9 && x >= 10 && x <= 14) {
						for (let y = 2; y < 5; y++) out.push({ x, y, z, color: 240 }); // stone wall
					}
				}
			}
			out.push({ x: 8, y: 2, z: 13, color: 244 }, { x: 9, y: 2, z: 13, color: 244 }); // crates
			out.push({ x: 22, y: 2, z: 2, color: 245 }); // lava vent
			return out;
		}
		function cellarVoxels(W, L) {
			const out = [];
			for (let z = 0; z < L; z++) {
				for (let x = 0; x < W; x++) {
					out.push({ x, y: 0, z, color: 240 });
					if (x === 0 || z === 0 || x === W - 1 || z === L - 1) {
						for (let y = 1; y < 4; y++) out.push({ x, y, z, color: 240 });
					}
				}
			}
			return out;
		}
		const forest = createFlatVoxelTerrain({
			id: id(), name: "Forest Clearing", width: 24, length: 24, height: 2, maxHeight: 10, tags: ["outdoors"],
		});
		forest.Voxels = encodeVoxels(forestVoxels(24, 24));
		await run("terrain:create", { terrain: forest });
		const cellar = createFlatVoxelTerrain({
			id: id(), name: "Old Cellar", width: 12, length: 12, height: 1, maxHeight: 6, tags: ["indoors"],
		});
		cellar.Voxels = encodeVoxels(cellarVoxels(12, 12));
		await run("terrain:create", { terrain: cellar });
		await run("terrainLink:create", {
			a: { terrainId: forest.Id, x: 20, y: 20, h: 2 },
			b: { terrainId: cellar.Id, x: 6, y: 6, h: 1 },
		});
		const at = (x, y, h = 2) => ({ terrainId: forest.Id, x, y, h });

		// ---------------------------------------------- items / skills / statuses
		const items = {
			potion: { Id: id(), Name: "Healing Potion", Description: "Restores 2d4+2 Health.", Image: img.potion, MaxUses: 3, IsEquippable: false, DiceRoll: "2d4+2", CanTargetActor: true, Tags: ["consumables"] },
			sword: { Id: id(), Name: "Longsword", Description: "A trusty blade.", Image: img.sword, IsEquippable: true, DiceRoll: "1d8+2", Tags: ["weapons"] },
			torch: { Id: id(), Name: "Torch", IsEquippable: true, Tags: ["gear"] },
			ring: {
				Id: id(), Name: "Cursed Ring", Description: "Drains 1 Health every round.", IsEquippable: true, Tags: ["gear/cursed"],
				Parameters: [{ Key: "drain", Label: "Drain", Type: "number", Default: 1, Min: 0, Max: 10 }],
				Scripts: [{ Name: "Drain", Trigger: "combat:incrementRound", When: "after", Enabled: true, Code: "this.actor.changeStat('Health', -this.params.drain);" }],
			},
		};
		for (const item of Object.values(items)) await run("item:create", { item });
		const skills = {
			fireball: { Id: id(), Name: "Fireball", Description: "8d6 fire in a sphere.", DiceRoll: "8d6", CanTargetPosition: true, MaxUses: 1, Tags: ["spells"] },
			secondWind: { Id: id(), Name: "Second Wind", DiceRoll: "1d10+1", MaxUses: 1, Tags: ["martial"] },
		};
		for (const skill of Object.values(skills)) await run("skill:create", { skill });
		const statuses = {
			poisoned: {
				Id: id(), Name: "Poisoned", Description: "Loses Health each round.", Expiration: { type: "turns", count: 3 },
				Parameters: [{ Key: "potency", Label: "Potency", Type: "number", Default: 2, Min: 0, Max: 99 }],
				Scripts: [{ Name: "Poison tick", Trigger: "combat:incrementRound", When: "after", Enabled: true, Code: "this.actor.changeStat('Health', -this.params.potency);" }],
			},
			blessed: { Id: id(), Name: "Blessed", Expiration: { type: "longRest" } },
		};
		for (const status of Object.values(statuses)) await run("status:create", { status });

		// ------------------------------------------------------------ characters
		const heroes = [
			{ Name: "Aria", Image: img.aria, Color: "#2563eb", cls: "Wizard", pos: at(4, 4), CritMessage: "The arcane bends to my will!" },
			{ Name: "Borin", Image: img.borin, Color: "#16a34a", cls: "Fighter", pos: at(5, 4) },
			{ Name: "Cyra", Image: img.cyra, Color: "#9333ea", cls: "Rogue", pos: at(6, 4), Size: "small" },
			// Owners (owned actors below). Keep these after the first three: the
			// kit's default players claim GameState.Characters[0..n-1].
			{ Name: "Beast Tamer", Image: img.tamer, Color: "#ca8a04", cls: "Ranger", pos: at(7, 4) },
			{ Name: "Puppet Master", Image: img.master, Color: "#be185d", cls: "Artificer", pos: at(8, 4) },
			{ Name: "Necromancer", Image: img.necro, Color: "#1e293b", cls: "Necromancer", pos: at(9, 4) },
		];
		const heroIds = [];
		for (const h of heroes) {
			const base = CharacterUtils.createDefault(qn.ctx);
			const character = {
				...base,
				Name: h.Name,
				Description: `${h.Name} the ${h.cls}.`,
				Image: h.Image,
				Color: h.Color,
				Size: h.Size ?? "medium",
				CritMessage: h.CritMessage,
				Attributes: [
					{ Id: "class", Value: h.cls },
					{ Id: "background", Value: "Test fixture" },
				],
				Tags: ["party"],
			};
			await run("character:create", { character });
			await run("character:spawn", { characterId: character.Id, terrainId: forest.Id, position: h.pos });
			heroIds.push(character.Id);
		}
		// A benched character that stays in the roster (not spawned).
		await run("character:create", {
			character: { ...CharacterUtils.createDefault(qn.ctx), Name: "Dorn (benched)", Tags: ["party/reserve"] },
		});

		const [aria, borin, cyra, tamer, master, necro] = heroIds;
		await run("item:give", { itemIds: [items.potion.Id], actorIds: heroIds, count: 2 });
		await run("item:give", { itemIds: [items.sword.Id, items.torch.Id], actorIds: [borin], count: 1 });
		await run("item:equip", { actorId: borin, itemId: items.sword.Id });
		await run("item:give", { itemIds: [items.ring.Id], actorIds: [cyra], count: 1 });
		await run("skill:give", { skillIds: [skills.fireball.Id], actorIds: [aria], count: 1 });
		await run("skill:give", { skillIds: [skills.secondWind.Id], actorIds: [borin], count: 1 });
		await run("status:give", { statusIds: [statuses.blessed.Id], actorIds: [aria], count: 1 });
		await run("status:give", { statusIds: [statuses.poisoned.Id], actorIds: [cyra], count: 1 });
		await run("note:create", { characterId: aria, note: { title: "Quest", content: "Find what lurks in the cellar." } });

		// -------------------------------------------------------------- entities
		const goblin = { ...EntityUtils.createDefault(qn.ctx), Name: "Goblin", Image: img.goblin, Tags: ["monsters/goblins"], Size: "small" };
		const wolf = { ...EntityUtils.createDefault(qn.ctx), Name: "Dire Wolf", Image: img.wolf, Tags: ["monsters/beasts"], Size: "large", MoveSpeed: 8 };
		await run("entity:create", { entity: goblin });
		await run("entity:create", { entity: wolf });
		await run("entity:spawn", { entityId: goblin.Id, terrainId: forest.Id, position: at(14, 13) });
		await run("entity:spawn", { entityId: goblin.Id, terrainId: forest.Id, position: at(15, 13) });
		await run("entity:spawn", { entityId: wolf.Id, terrainId: forest.Id, position: at(16, 15) });
		// Hidden ambusher (DM-only) in the cellar.
		await run("entity:spawn", { entityId: goblin.Id, terrainId: cellar.Id, position: { terrainId: cellar.Id, x: 4, y: 8, h: 1 }, hidden: true });
		await run("item:spawn", { itemId: items.potion.Id, terrainId: forest.Id, position: at(10, 6) });

		// --------------------------------------------------------- owned actors
		// Persistent companion: a character owned by another character.
		const puppet = {
			...CharacterUtils.createDefault(qn.ctx), Name: "Puppet", Image: img.puppet, Color: "#f472b6",
			Size: "small", OwnerId: master, Tags: ["party/owned"],
		};
		await run("character:create", { character: puppet });
		await run("character:spawn", { characterId: puppet.Id, terrainId: forest.Id, position: at(8, 5) });
		// Template-owned entity: every Wolf spawned belongs to the Beast Tamer.
		const tamerWolf = {
			...EntityUtils.createDefault(qn.ctx), Name: "Wolf", Image: img.wolf, Tags: ["companions"],
			Size: "medium", MoveSpeed: 8, OwnerId: tamer,
		};
		await run("entity:create", { entity: tamerWolf });
		await run("entity:spawn", { entityId: tamerWolf.Id, terrainId: forest.Id, position: at(7, 5) });
		const wolfInstance = c().GameState.Entities.find((e) => e.Name === "Wolf");
		await run("item:give", { itemIds: [items.potion.Id], actorIds: [wolfInstance.Id], count: 1 });
		// Generic summon: an unowned Skeleton template, owned by whoever raises it.
		const skeleton = {
			...EntityUtils.createDefault(qn.ctx), Name: "Skeleton", Image: img.skeleton, Tags: ["monsters/undead"],
		};
		await run("entity:create", { entity: skeleton });
		const raiseDeadId = id();
		await run("skill:create", {
			skill: {
				Id: raiseDeadId, Name: "Raise Dead", Description: "Raises a Skeleton that obeys you.", Tags: ["spells"],
				Scripts: [{
					Name: "Raise a skeleton", Trigger: "skill:use", When: "after", Enabled: true,
					// Skill scripts fire on every skill:use, so react only to this skill used by this bearer.
					Code: `if (event.params.skillId !== "${raiseDeadId}" || event.params.actorId !== this.actor.Id) return;\nawait game.spawnActor("Skeleton", this.actor.Position, { owner: this.actor });`,
				}],
			},
		});
		await run("skill:give", { skillIds: [raiseDeadId], actorIds: [necro], count: 1 });

		// ------------------------------------------------- audio / scene / misc
		await run("audio:create", { audio: { Name: "Tavern ambience", YoutubeId: "dQw4w9WgXcQ", Tags: ["ambience"] } });
		await run("audio:create", { audio: { Name: "Battle theme", YoutubeId: "jfKfPfyJRdk", Tags: ["combat"] } });
		await run("scene:setEnvironmentImage", { imageId: img.forest });
		await run("scene:setFocusImage", { imageId: img.cellar });
		await run("calendar:edit", { updates: { CalendarDay: 3 } });
		await run("sticker:create", { emoji: "🔥", actorId: aria });
		await run("dice:roll", { actorId: borin, expr: "1d20+5", total: 17, breakdown: "[12] + 5" });
		await run("log:log", { action: "Session start", category: "system", details: "Fixture seeded by test-kit/seed.mjs" });
		await run("scenario:capture", { name: "Opening positions" });

		const data = await CampaignUtils.buildExportDataForCampaign(c());
		return JSON.stringify(data);
	});

	const data = JSON.parse(json);
	await writeFile(FIXTURE_PATH, JSON.stringify(data, null, "\t") + "\n");
	const counts = {
		characters: data.campaign.GameState.Characters.length,
		roster: data.campaign.CharacterRoster.length,
		entities: data.campaign.GameState.Entities.length,
		terrains: data.campaign.VoxelTerrains.length,
		images: Object.keys(data.imageData).length,
		terrainPayloads: Object.keys(data.terrainData).length,
	};
	console.log("wrote", FIXTURE_PATH, counts);
}
