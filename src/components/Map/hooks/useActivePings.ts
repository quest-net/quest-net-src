// useActivePings.ts
// Map hook that surfaces currently-active ping events for tactical
// map highlighting. Mirrors useActiveStickers' shape but is keyed on
// the ping's log entry id (not on ActorId), since multiple users can
// ping different tiles simultaneously.

import { useMemo, useState, useEffect, useRef } from "react";
import { CampaignActions } from "../../../domains/Campaign/CampaignActions";
import { useQuestContext } from "../../../domains/Context/ContextProvider";
import { LogActions } from "../../../domains/Log/LogActions";
import {
	PING_DURATION_MS,
	parsePingDetails,
} from "../../../domains/Ping/Ping";
import { SoundEffectService } from "../../../services/SoundEffectService";

export interface ActivePing {
	id: string;
	x: number;
	y: number;
	actorId?: string;
	timestamp: number;
}

export interface UseActivePingsResult {
	pings: ActivePing[];
	now: number;
}

// Visual ping animation is driven imperatively by Three.js. React only needs
// to wake occasionally while pings are active so expired entries disappear.
const EXPIRATION_TICK_MS = 250;
// Idle poll: when no pings are active we still need to notice when a new
// one arrives — but a new ping triggers a campaign.Log update, so React
// will re-run the memo on its own. The timer below is purely for
// in-flight expiration and frame ticks.

export function useActivePings(): UseActivePingsResult {
	const context = useQuestContext();
	const campaign = CampaignActions.getActiveCampaign(context);
	const [now, setNow] = useState(() => Date.now());

	// Track which ping ids we've already played sounds for (mirrors useActiveStickers).
	const playedIdsRef = useRef<Set<string>>(new Set());

	// Compute active pings on every render so the timer can drive animation.
	const pings = useMemo(() => {
		const out: ActivePing[] = [];
		const logs = LogActions.getChronologicalLog(campaign);

		// Iterate newest -> oldest so we can break out as soon as we find
		// an entry that has expired.
		for (let i = logs.length - 1; i >= 0; i--) {
			const entry = logs[i];

			// Logs are roughly chronological. Once we find a non-ping entry that
			// is still within the window we can keep scanning, but once we find
			// any entry whose timestamp has expired we can stop because anything
			// older is also expired (clocks aside).
			if (now - entry.Timestamp > PING_DURATION_MS) break;

			if (entry.Category !== "ping") continue;
			const parsed = parsePingDetails(entry.Details);
			if (!parsed) continue;

			out.push({
				id: entry.Id,
				x: parsed.x,
				y: parsed.y,
				actorId: entry.ActorId,
				timestamp: entry.Timestamp,
			});

			// Play sound exactly once per ping.
			if (!playedIdsRef.current.has(entry.Id)) {
				playedIdsRef.current.add(entry.Id);
				SoundEffectService.play("ping:default");
			}
		}

		// Cap memory growth on the played-id set.
		if (playedIdsRef.current.size > 200) {
			const stillActive = new Set<string>();
			for (const p of out) stillActive.add(p.id);
			playedIdsRef.current = stillActive;
		}

		return out;
	}, [campaign.Log, campaign.LogHead, now]);

	// Drive animation/expiration only while pings are in flight.
	const hasPings = pings.length > 0;
	useEffect(() => {
		if (!hasPings) return;
		const handle = window.setInterval(() => {
			setNow(Date.now());
		}, EXPIRATION_TICK_MS);
		return () => window.clearInterval(handle);
	}, [hasPings]);

	return { pings, now };
}
