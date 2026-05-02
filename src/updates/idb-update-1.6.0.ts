// src/updates/idb-update-1.6.0.ts
//
// IDB migration for v1.6.0: move all campaign data out of localStorage
// into IndexedDB, leaving only CampaignInfo stubs in Context.Campaigns.
//
// Migration order is critical: campaigns are extracted to IDB *before*
// any terrain/voxel migrations run, so localStorage never overflows.
//
// Two legacy sources are handled:
//   1. context.Campaigns — full Campaign[] objects (DM-owned campaigns)
//   2. localStorage "campaign_<roomCode>" keys — player-cached campaigns
//      (received from DM via Trystero; Id === RoomCode after sanitizeForPlayers)

import type { Context } from "../domains/Context/Context";
import type { Campaign, CampaignInfo } from "../domains/Campaign/Campaign";
import type { IndexedDBMigration } from "./types";
import { IndexedDBUtilities } from "../utils/IndexedDBUtilities";
import { LocalStorageUtilities } from "../utils/LocalStorageUtilities";

/** Discriminates a full Campaign from a CampaignInfo stub */
function isFullCampaign(entry: CampaignInfo | Campaign): entry is Campaign {
  return "CharacterRoster" in entry || "GameState" in entry;
}

/** Extracts a CampaignInfo stub from any campaign-like object */
function toStub(c: Campaign | CampaignInfo): CampaignInfo {
  return {
    Id: c.Id,
    Name: c.Name,
    RoomCode: c.RoomCode,
    CreatedAt: c.CreatedAt,
  };
}

export const idb_migration_1_6_0: IndexedDBMigration = {
  version: "1.6.0",

  async update(context: Context): Promise<Context> {
    // context.Campaigns may still be Campaign[] (legacy) or already CampaignInfo[]
    // We cast to the broader union so TypeScript doesn't complain.
    const entries = context.Campaigns as unknown as Array<Campaign | CampaignInfo>;
    const stubs: CampaignInfo[] = [];

    // 1. Move DM-owned campaigns from context.Campaigns into IDB
    for (const entry of entries) {
      if (isFullCampaign(entry)) {
        await IndexedDBUtilities.saveCampaign(entry);
        if (process.env.NODE_ENV !== "production") {
          console.log(
            `[IDB 1.6.0] Moved campaign to IDB: ${entry.Name} (${entry.Id})`
          );
        }
      }
      stubs.push(toStub(entry));
    }

    // 2. Move player-cached campaigns from localStorage ("campaign_<roomCode>") into IDB
    //    These have Id === RoomCode (StateSync.sanitizeForPlayers sets Id = RoomCode).
    const legacyKeys = LocalStorageUtilities.listKeysWithPrefix("campaign_");
    for (const key of legacyKeys) {
      const cached = LocalStorageUtilities.load<Campaign>(key);
      if (!cached) continue;

      const roomCode = key.slice("campaign_".length);
      cached.Id = roomCode;
      cached.RoomCode = roomCode;

      await IndexedDBUtilities.saveCampaign(cached);

      // Add stub only if not already present (avoid duplicates if somehow it was
      // in context.Campaigns too, which shouldn't happen but is worth guarding)
      if (!stubs.find((s) => s.Id === cached.Id)) {
        stubs.push(toStub(cached));
      }

      if (process.env.NODE_ENV !== "production") {
        console.log(
          `[IDB 1.6.0] Moved player-cached campaign to IDB: ${cached.Name} (key: ${key})`
        );
      }
    }

    return {
      ...context,
      Campaigns: stubs,
      ActiveCampaign: undefined,
    };
  },

  async reset(context: Context): Promise<Context> {
    // Reload full Campaign objects from IDB back into context.Campaigns,
    // and restore player-cached campaigns to localStorage.
    const restoredCampaigns: Campaign[] = [];

    for (const stub of context.Campaigns) {
      const campaign = await IndexedDBUtilities.loadCampaign(stub.Id);
      if (campaign) {
        restoredCampaigns.push(campaign);

        // Player-cached: Id === RoomCode — restore to localStorage
        if (campaign.Id === campaign.RoomCode) {
          LocalStorageUtilities.save(`campaign_${campaign.RoomCode}`, campaign);
        }
      }
    }

    return {
      ...context,
      // Cast required: pre-1.6.0 context.Campaigns type is Campaign[]
      Campaigns: restoredCampaigns as unknown as CampaignInfo[],
      ActiveCampaign: undefined,
    };
  },
};
