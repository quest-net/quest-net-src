
import { useMemo, useState, useEffect } from "react";
import { CampaignActions } from "../../../domains/Campaign/CampaignActions";
import { useQuestContext } from "../../../domains/Context/ContextProvider";
import { LogActions } from "../../../domains/Log/LogActions";

const STICKER_DURATION_MS = 5000;

export function useActiveStickers() {
    const context = useQuestContext();
    const campaign = CampaignActions.getActiveCampaign(context);
    const [now, setNow] = useState(Date.now());

    // Force re-render periodically to clear old stickers
    useEffect(() => {
        const interval = setInterval(() => {
            setNow(Date.now());
        }, 1000);
        return () => clearInterval(interval);
    }, []);

    const activeStickers = useMemo(() => {
        const map = new Map<string, string>(); // ActorId -> Emoji

        // Get recent logs
        const logs = LogActions.getChronologicalLog(campaign);

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
        }

        return map;
    }, [campaign.Log, campaign.LogHead, now]);

    return activeStickers;
}
