// src/legacy/QuestNetV1Migration.ts
// LEGACY: Quest-Net 1.0 migration helpers
// Remove this file + the importFromFile hook once everyone has migrated.

import { Campaign } from "../domains/Campaign/Campaign";
import { Context } from "../domains/Context/Context";
import { Character } from "../domains/Character/Character";
import { Entity } from "../domains/Entity/Entity";
import { Item } from "../domains/Item/Item";
import { Skill } from "../domains/Skill/Skill";
import { Status } from "../domains/Status/Status";
import { Audio } from "../domains/Audio/Audio";
import { Note } from "../domains/Note/Note";
import { CampaignSettingActions } from "../domains/CampaignSetting/CampaignSettingActions";
import { APP_VERSION, type VersionString } from "../version";
import { runMigrations } from "../updates/migrator";
import { ContextActions } from "../domains/Context/ContextActions";

// ------------------------
// v1 save type definitions
// ------------------------

interface V1ItemSlot {
  id: string;
  usesLeft?: number;
}

interface V1StatusSlot {
  id: string;
  turnsLeft?: number;
}

interface V1SkillSlot {
  id: string;
  usesLeft?: number;
}

interface V1Character {
  id: string;
  name: string;
  description?: string;
  maxHp: number;
  hp: number;
  maxMp?: number;
  mp?: number;
  maxSp?: number;
  sp?: number;
  spRegenRate?: number;
  equipment: V1ItemSlot[] | string[];
  inventory: V1ItemSlot[] | string[];
  skills: V1SkillSlot[] | string[];
  statusEffects: V1StatusSlot[] | string[];
}

interface V1Entity {
  id: string;
  name: string;
  description?: string;
  hp: number;
  maxHp: number;
  sp?: number;
  maxSp?: number;
  spRegenRate?: number;
  inventory: V1ItemSlot[] | string[];
  skills: V1SkillSlot[] | string[];
  statusEffects: V1StatusSlot[] | string[];
}

interface V1Item {
  id: string;
  name: string;
  description?: string;
  isEquippable: boolean;
  uses?: number;
  tags?: string[];
}

interface V1Skill {
  id: string;
  name: string;
  description?: string;
  damage?: number;
  spCost?: number;
  uses?: number;
  tags?: string[];
}

interface V1Status {
  id: string;
  name: string;
  description?: string;
  tags?: string[];
}

interface V1Image {
  id: string;
  name: string;
  url: string;
  tags?: string[];
}

interface V1AudioTrack {
  id: string;
  youtubeId: string;
  name: string;
  url: string;
  status: string;
  color: string;
}

interface V1CombatState {
  isActive: boolean;
  currentTurn: number;
  initiativeSide: "party" | "enemies";
  positions: Record<
    string,
    { x: number; y: number; h?: number } | { x: number; y: number }
  >;
}

interface V1AudioState {
  currentTrackId: string;
  volume: number; // 0..100
  playlist: V1AudioTrack[];
}

interface V1GlobalCollections {
  items: V1Item[];
  skills: V1Skill[];
  statusEffects: V1Status[];
  images: V1Image[];
  entities: V1Entity[];
}

interface V1GameState {
  party: V1Character[];
  globalCollections: V1GlobalCollections;
  combat: V1CombatState;
  field: unknown[];
  display: { showFocusImage: boolean };
  audio: V1AudioState;
  lastModified: number;
}

export interface QuestNetV1Save {
  gameState: V1GameState;
  images: Record<string, unknown>;
}

// ------------------------
// Type guards + public API
// ------------------------

export function isQuestNetV1Save(data: unknown): data is QuestNetV1Save {
  if (!data || typeof data !== "object") return false;
  const d = data as any;
  return (
    "gameState" in d &&
    d.gameState &&
    typeof d.gameState === "object" &&
    "globalCollections" in d.gameState &&
    "images" in d
  );
}

/**
 * Main entry point used by CampaignActions.importFromFile.
 * It:
 *  - converts Quest-Net 1.0 save -> v2 Campaign
 *  - runs schema migrations
 *  - pushes the campaign into the current Context
 *  - persists via ContextActions.save
 */
export async function importQuestNetV1Save(
  v1: QuestNetV1Save,
  context: Context,
  onProgress?: (progress: { current: number; total: number; status: string }) => void
): Promise<Campaign> {
  // 1) Build a basic Campaign from the v1 data
  const { campaign, version } = migrateV1SaveToCampaign(v1);

  // 2) Run your existing migrator on this single-campaign context
  const tempContext: Context = {
    User: structuredClone(context.User),
    Campaigns: [structuredClone(campaign)],
    AppSettings: structuredClone(context.AppSettings as any),
    version,
  };

  const migratedContext = runMigrations(tempContext, APP_VERSION);
  let finalCampaign = migratedContext.Campaigns[0];

  // 3) Give it a fresh ID to avoid conflicts
  finalCampaign.Id = crypto.randomUUID();

  // 4) Ensure unique RoomCode
  const existingRoomCodes = context.Campaigns.map((c) => c.RoomCode);
  if (existingRoomCodes.includes(finalCampaign.RoomCode)) {
    finalCampaign.RoomCode = generateLegacyRoomCode();
  }

  // 5) No imageData to import (v1 images live in IndexedDB & are out of scope)
  onProgress?.({
    current: 0,
    total: 1,
    status: "Saving migrated campaign...",
  });

  context.Campaigns.push(finalCampaign);
  ContextActions.save(context);

  onProgress?.({
    current: 1,
    total: 1,
    status: "Import complete!",
  });

  return finalCampaign;
}

// ------------------------
// Internal helpers
// ------------------------

function generateLegacyRoomCode(): string {
  return `legacy-${Math.floor(Math.random() * 100000)}`;
}

function normalizeSlots(
  slots: V1ItemSlot[] | string[] | undefined
): { Id: string; UsesLeft?: number }[] {
  if (!slots || slots.length === 0) return [];

  return (slots as any[]).map((s) => {
    if (typeof s === "string") {
      return { Id: s };
    }
    return { Id: s.id, UsesLeft: s.usesLeft };
  });
}

/**
 * Core structural migration: v1 -> v2 Campaign (pre-migrations)
 */
function migrateV1SaveToCampaign(
  v1: QuestNetV1Save
): { campaign: Campaign; version: VersionString } {
  const gs = v1.gameState;

  // Start from default settings so we get all your new knobs
  const settings = CampaignSettingActions.createDefault();

  // --- Global collections ---

  const items: Item[] = gs.globalCollections.items.map((i) => ({
    Id: i.id,
    Name: i.name,
    Description: i.description,
    Tags: i.tags,
    IsEquippable: i.isEquippable,
    MaxUses: i.uses,
  }));

  const skills: Skill[] = gs.globalCollections.skills.map((s) => ({
    Id: s.id,
    Name: s.name,
    Description: s.description
      ? `${s.description}\n\n(Legacy: damage=${s.damage ?? "?"}, SP cost=${s.spCost ?? 0
      })`
      : `Legacy skill (damage=${s.damage ?? "?"}, SP cost=${s.spCost ?? 0})`,
    Tags: s.tags,
    MaxUses: s.uses,
    // StatCost / DiceRoll left for the DM to configure post-import
  }));

  const statuses: Status[] = gs.globalCollections.statusEffects.map((st) => ({
    Id: st.id,
    Name: st.name,
    Description: st.description,
    Tags: st.tags,
    // Duration left undefined (permanent) – v1 didn’t encode it explicitly
  }));

  const entities: Entity[] = gs.globalCollections.entities.map<Entity>((e) => {
    const inventory = normalizeSlots(e.inventory);
    const skillsSlots = normalizeSlots(e.skills);
    const statusSlots = normalizeSlots(e.statusEffects);

    return {
      Id: e.id,
      Name: e.name,
      Description: e.description,
      Image: undefined,
      Stats: buildActorStatsFromV1({
        hp: e.hp,
        maxHp: e.maxHp,
        mp: undefined,
        maxMp: undefined,
        sp: e.sp,
        maxSp: e.maxSp,
        spRegenRate: e.spRegenRate,
      }),
	  Actions: [],
      Attributes: {
        legacySource: "quest-net-1.0",
        legacyId: e.id,
      },
      Position: { x: 0, y: 0, h: 0 }, // we’ll try to override from combat.positions below
      MoveSpeed: 6,
      CanFly: false,
      Size: "medium",
      Inventory: inventory,
      Equipment: [], // v1 didn’t distinguish equip vs inventory for entities
      Skills: skillsSlots,
      Statuses: statusSlots,
      Tags: [],
    };
  });

  // --- Audio ---

  const audios: Audio[] = gs.audio.playlist.map((track) => ({
    Id: track.id,
    Name: track.name,
    YoutubeId: track.youtubeId,
    Tags: ["legacy"],
  }));

  // --- Characters (party -> CharacterRoster + active GameState.Characters) ---

  const characters: Character[] = gs.party.map((c) => {
    const inventory = normalizeSlots(c.inventory);
    const equipment = normalizeSlots(c.equipment);
    const skillSlots = normalizeSlots(c.skills);
    const statusSlots = normalizeSlots(c.statusEffects);

    const notes: Note[] = [
      {
        Id: crypto.randomUUID(),
        title: "Imported from Quest-Net 1.0",
        content: `Original ID: ${c.id}`,
        lastUpdated: Date.now(),
      },
    ];

    const stats = buildActorStatsFromV1({
      hp: c.hp,
      maxHp: c.maxHp,
      mp: c.mp,
      maxMp: c.maxMp,
      sp: c.sp,
      maxSp: c.maxSp,
      spRegenRate: c.spRegenRate,
    });

    return {
      Id: c.id,
      Name: c.name,
      Description: c.description,
      Image: undefined,
      Stats: stats,
	  Actions: [],
      Attributes: {
        legacySource: "quest-net-1.0",
        legacyId: c.id,
      },
      Position: pickPositionForId(gs.combat.positions, c.id),
      MoveSpeed: 6,
      CanFly: false,
      Size: "medium",
      Inventory: inventory,
      Equipment: equipment,
      Skills: skillSlots,
      Statuses: statusSlots,
      Tags: [],
      Notes: notes,
      CritMessage: undefined,
    };
  });

  // GameState.Audio: active track IDs (just current track if it exists)
  const audioIds: string[] = gs.audio.playlist.some(
    (t) => t.id === gs.audio.currentTrackId
  )
    ? [gs.audio.currentTrackId]
    : [];

  // --- Build Campaign ---

  const campaign: Campaign = {
    Id: crypto.randomUUID(),
    Name: "Imported Quest-Net 1.0 Campaign",
    RoomCode: generateLegacyRoomCode(),
    CreatedAt: gs.lastModified || Date.now(),
    CharacterRoster: [...characters],
    ItemTemplates: items,
    SkillTemplates: skills,
    StatusTemplates: statuses,
    EntityTemplates: entities,
    Terrains: [], // you can also seed TerrainActions.createDefault() if you want
    Audios: audios,
    Images: [], // v1 images are out-of-scope per your note
    Scenarios: [],
    GameState: {
      Characters: [...characters],
      Entities: [], // we don’t place entities on the field automatically
      CombatState: {
        isActive: gs.combat.isActive,
        currentTurn: gs.combat.currentTurn,
        initiativeSide: gs.combat.initiativeSide,
      },
      Audio: audioIds,
      Volume: gs.audio.volume / 100,
      Scene: {
        EnvironmentImageId: "",
        FocusImageId: "",
      },
      TerrainId: "DEFAULT_TERRAIN",
      CalendarDay: 0,
      RemainingShortRests: 2,
    },
    Log: [],
    LogHead: 0,
    Settings: settings,
  };

  // This is effectively a v2 campaign, but we let your migrator do final tweaks.
  const dataVersion: VersionString = "2.0.0";

  return { campaign, version: dataVersion };
}

// Helpers to construct Actor.Stats from v1 HP/MP/SP

function buildActorStatsFromV1(params: {
  hp: number;
  maxHp: number;
  mp?: number;
  maxMp?: number;
  sp?: number;
  maxSp?: number;
  spRegenRate?: number;
}): import("../domains/CampaignSetting/CampaignSetting").StatDefinition[] {
  const result: import("../domains/CampaignSetting/CampaignSetting").StatDefinition[] =
    [];

  // HP
  result.push({
    Id: "hp",
    Name: "HP",
    Color: "#ef4444",
    Current: params.hp,
    Max: params.maxHp,
  });

  // MP (optional)
  if (params.maxMp != null) {
    result.push({
      Id: "mp",
      Name: "MP",
      Color: "#3b82f6",
      Current: params.mp ?? params.maxMp,
      Max: params.maxMp,
    });
  }

  // SP (optional)
  if (params.maxSp != null) {
    result.push({
      Id: "sp",
      Name: "SP",
      Color: "#22c55e",
      Current: params.sp ?? params.maxSp,
      Max: params.maxSp,
      RegenRate: params.spRegenRate,
    });
  }

  return result;
}

function pickPositionForId(
  positions: V1CombatState["positions"],
  id: string
): { x: number; y: number; h: number } {
  const pos = positions[id];
  if (!pos) return { x: 0, y: 0, h: 0 };

  return {
    x: (pos as any).x ?? 0,
    y: (pos as any).y ?? 0,
    h: (pos as any).h ?? 0,
  };
}
