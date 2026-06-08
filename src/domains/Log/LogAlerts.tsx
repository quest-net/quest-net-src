// domains/Log/LogAlerts.tsx - Updated with Crit/Fumble Detection

import { useEffect, useState } from "react";
import { useQuestContext } from "../Context/ContextProvider";
import { CampaignActions } from "../Campaign/CampaignActions";
import { LogEntry } from "./LogEntry";
import { LogActions } from "./LogActions";
import { DM_MENTION_ID } from "./MentionUtils";

interface Alert {
	id: string;
	entry: LogEntry;
}

const ALERT_DURATION = 5000; // 5 seconds
const MAX_ALERT_AGE = 10000; // Only show alerts for logs created in the last 10 seconds

// Helper functions to detect crits and fumbles from dice roll logs
const isDiceRoll = (entry: LogEntry): boolean => entry.Category === "dice";

const isCritRoll = (entry: LogEntry): boolean => {
	if (!isDiceRoll(entry)) return false;

	const action = entry.Action || "";
	const details = entry.Details || "";

	// Check if it's a d20 or d100 roll
	const isD20 = /d20(?!\d)/i.test(action) || /d20(?!\d)/i.test(details);
	const isD100 = /d100/i.test(action) || /d100/i.test(details);

	if (!isD20 && !isD100) return false;

	// Check breakdown for max values (kept dice)
	// Matches patterns like [20], =20 for d20 or [100], =100 for d100
	if (isD20 && /(?:\[20\]|=20)(?!\d)/.test(details)) return true;
	if (isD100 && /(?:\[100\]|=100)/.test(details)) return true;

	return false;
};

const isFumbleRoll = (entry: LogEntry): boolean => {
	if (!isDiceRoll(entry)) return false;

	const action = entry.Action || "";
	const details = entry.Details || "";

	// Only d20 or d100 can fumble
	const isD20OrD100 = /d(?:20|100)(?!\d)/i.test(action);
	if (!isD20OrD100) return false;

	// Check breakdown for minimum value (kept dice)
	// Matches patterns like [1], =1
	return /(?:\[1\]|=1)(?!\d)/.test(details);
};

export function LogAlerts() {
	const context = useQuestContext();
	const campaign = CampaignActions.getActiveCampaign(context);
	const [alerts, setAlerts] = useState<Alert[]>([]);
	const [processedIds, setProcessedIds] = useState<Set<string>>(new Set());
	const userRole = context.User.Role;
	const selectedCharacterId =
		context.User.SelectedCharacters[campaign.RoomCode];

	// True when this entry @mentions the current viewer (their selected
	// character, or the DM via the "DM" sentinel).
	const isMentionForMe = (entry: LogEntry): boolean => {
		if (!entry.MentionedActorIds || entry.MentionedActorIds.length === 0)
			return false;
		if (selectedCharacterId && entry.MentionedActorIds.includes(selectedCharacterId))
			return true;
		if (userRole === "dm" && entry.MentionedActorIds.includes(DM_MENTION_ID))
			return true;
		return false;
	};

	useEffect(() => {
		const now = Date.now();

		// Get chronologically sorted log
		const chronologicalLog = LogActions.getChronologicalLog(campaign);

		// Surface important/critical logs, plus any chat message that @mentions
		// the current viewer regardless of its level.
		const newAlerts = chronologicalLog.filter((entry) => {
			const levelOk = entry.Level === "important" || entry.Level === "critical";
			const fresh = now - entry.Timestamp < MAX_ALERT_AGE;
			const canSee = LogActions.canUserSeeEntry(entry, userRole);
			return (
				(levelOk || isMentionForMe(entry)) &&
				fresh &&
				!processedIds.has(entry.Id) &&
				canSee
			);
		});

		if (newAlerts.length === 0) return;

		// Add new alerts
		const alertsToAdd = newAlerts.map((entry) => ({
			id: entry.Id,
			entry,
		}));

		setAlerts((prev) => [...prev, ...alertsToAdd]);
		setProcessedIds((prev) => new Set([...prev, ...newAlerts.map((e) => e.Id)]));

		// Auto-dismiss after duration
		alertsToAdd.forEach((alert) => {
			setTimeout(() => {
				setAlerts((prev) => prev.filter((a) => a.id !== alert.id));
			}, ALERT_DURATION);
		});
	}, [
		campaign.Log,
		campaign.LogHead,
		campaign.Log.length,
		processedIds,
		userRole,
		selectedCharacterId,
		campaign.RoomCode,
	]);

	const dismissAlert = (id: string) => {
		setAlerts((prev) => prev.filter((a) => a.id !== id));
	};

	// Helper to get custom crit message for a character
	const getCritMessage = (entry: LogEntry): string => {
		if (!entry.ActorId) return "CRITICAL!";

		// Look for character in GameState first (they might be spawned)
		const character = campaign.GameState.Characters.find(
			(c) => c.Id === entry.ActorId
		);

		// If not found in GameState, check CharacterRoster
		const rosterChar = character || campaign.CharacterRoster.find(
			(c) => c.Id === entry.ActorId
		);

		return rosterChar?.CritMessage || "CRITICAL!";
	};

	// Display name of whoever sent a chat message (character name, or "DM").
	const getSenderName = (entry: LogEntry): string => {
		if (entry.ActorId) {
			const character =
				campaign.GameState.Characters.find((c) => c.Id === entry.ActorId) ||
				campaign.CharacterRoster.find((c) => c.Id === entry.ActorId);
			return character?.Name || "Player";
		}
		return "DM";
	};

	if (alerts.length === 0) return null;

	return (
		<div className="fixed top-4 left-1/2 transform -translate-x-1/2 z-50 space-y-2 pointer-events-none">
			{alerts.map((alert) => {
				// Detect special dice roll types
				const isDice = isDiceRoll(alert.entry);
				const isCrit = isCritRoll(alert.entry);
				const isFumble = isFumbleRoll(alert.entry);
				const isMention = isMentionForMe(alert.entry);

				// Get custom crit message if applicable
				const critMessage = isCrit ? getCritMessage(alert.entry) : "CRITICAL!";

				// Choose icon based on roll type
				let icon = "icon-[mdi--information]";
				if (isMention) {
					icon = "icon-[mdi--at]";
				} else if (isCrit) {
					icon = "icon-[game-icons--trophy]";
				} else if (isFumble) {
					icon = "icon-[game-icons--broken-skull]";
				} else if (isDice) {
					icon = "icon-[game-icons--dice-twenty-faces-one]";
				}

				// Choose alert style based on roll type
				let alertClass = "alert-info";
				let animationClass = "animate-slide-in";

				if (isMention) {
					alertClass = "alert-warning";
				} else if (isCrit) {
					alertClass = "alert-success";
					animationClass = "animate-bounce";
				} else if (isFumble) {
					alertClass = "alert-error";
					animationClass = "animate-shake";
				}

				return (
					<div
						key={alert.id}
						className={`alert ${alertClass} shadow-lg max-w-md pointer-events-auto ${animationClass} py-2 min-h-0 ${isCrit ? "border-2 border-success" : ""
							} ${isFumble ? "border-2 border-error" : ""
							}`}
					>
						<span className={`${icon} w-5 h-5 shrink-0 ${isCrit ? "text-success-content" : ""
							} ${isFumble ? "text-error-content" : ""
							}`}></span>
						<div className="flex-1 min-w-0">
							<h3 className={`font-semibold text-sm leading-tight ${isCrit ? "text-success-content" : ""
								} ${isFumble ? "text-error-content" : ""
								}`}>
								{isCrit && `🎉 ${critMessage} `}
								{isFumble && "💀 "}
								{isMention && `💬 ${getSenderName(alert.entry)}: `}
								{alert.entry.Action}
							</h3>
							{alert.entry.Details && (
								<div className={`text-xs opacity-80 leading-tight mt-0.5 ${isCrit ? "text-success-content" : ""
									} ${isFumble ? "text-error-content" : ""
									}`}>
									{alert.entry.Details}
								</div>
							)}
						</div>
						<button
							className="btn btn-xs btn-circle btn-ghost shrink-0"
							onClick={(e) => {
								e.stopPropagation();
								dismissAlert(alert.id);
							}}
						>
							<span className="icon-[mdi--close] w-3 h-3"></span>
						</button>
					</div>
				);
			})}

			{/* Add shake animation CSS */}
			<style>{`
				@keyframes shake {
					0%, 100% { transform: translateX(0); }
					10%, 30%, 50%, 70%, 90% { transform: translateX(-4px); }
					20%, 40%, 60%, 80% { transform: translateX(4px); }
				}
				.animate-shake {
					animation: shake 0.5s ease-in-out;
				}
			`}</style>
		</div>
	);
}