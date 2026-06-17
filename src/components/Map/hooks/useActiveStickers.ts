
import { useMemo, useState, useEffect, useRef } from "react";
import { CampaignUtils } from "../../../domains/Campaign/CampaignUtils";
import { useQuestContext } from "../../../domains/Context/ContextProvider";
import { LogUtils } from "../../../domains/Log/LogUtils";
import {
    STICKER_DURATION_MS,
    getStickerSoundId,
} from "../../../domains/Sticker/Sticker";
import { SoundEffectService } from "../../../services/SoundEffectService";

export function useActiveStickers() {
    const context = useQuestContext();
    const campaign = CampaignUtils.getActiveCampaign(context);
    const [now, setNow] = useState(Date.now());

    // Track which sticker log entry IDs we've already played sounds for
    const playedStickerIdsRef = useRef<Set<string>>(new Set());

    const activeStickers = useMemo(() => {
        const map = new Map<string, string>(); // ActorId -> Emoji

        // Get recent logs
        const logs = LogUtils.getChronologicalLog(campaign);

        // Iterate from newest to oldest to find the latest sticker for each actor efficiently
        // But getChronologicalLog returns oldest -> newest. So we reverse or iterate backwards.
        for (let i = logs.length - 1; i >= 0; i--) {
            const entry = logs[i];
            if (entry.Category !== "sticker") continue;
            if (!entry.ActorId || !entry.Details) continue;

            // Check if expired
            if (now - entry.Timestamp > STICKER_DURATION_MS) {
                // Since logs are chronological, if we hit an expired one, all previous ones are also expired
                // (mostly true, unless clocks are weird, but good enough)
                break;
            }

            // If this actor doesn't have a sticker yet (meaning this is the newest one), add it
            if (!map.has(entry.ActorId)) {
                map.set(entry.ActorId, entry.Details);
            }

            // Play sound for stickers we haven't seen yet
            if (!playedStickerIdsRef.current.has(entry.Id)) {
                playedStickerIdsRef.current.add(entry.Id);
                // Per-emoji override file with a fall-back to the default sound.
                SoundEffectService.playWithFallback(
                    getStickerSoundId(entry.Details),
                    "sticker:default"
                );
            }
        }

        // Prune old IDs from the set to prevent unbounded growth
        // (keep only IDs that are still in the active window)
        if (playedStickerIdsRef.current.size > 100) {
            const activeIds = new Set<string>();
            for (let i = logs.length - 1; i >= 0; i--) {
                const entry = logs[i];
                if (now - entry.Timestamp > STICKER_DURATION_MS) break;
                if (entry.Category === "sticker") activeIds.add(entry.Id);
            }
            playedStickerIdsRef.current = activeIds;
        }

        return map;
    }, [campaign.Log, campaign.LogHead, now]);

    // Re-render periodically to expire old stickers, but only while some are
    // active. When none are, a new sticker arrives via a campaign.Log change
    // (which re-runs the memo on its own), so no idle timer is needed. Mirrors
    // useActivePings' gating.
    const hasStickers = activeStickers.size > 0;
    useEffect(() => {
        if (!hasStickers) return;
        const interval = setInterval(() => {
            setNow(Date.now());
        }, 1000);
        return () => clearInterval(interval);
    }, [hasStickers]);

    return activeStickers;
}
