
import { useState, useRef, useEffect } from "react";
import { useQuestContext } from "../../domains/Context/ContextProvider";
import { useActionService } from "../../services/Actions/ActionServiceProvider";
import { CampaignActions } from "../../domains/Campaign/CampaignActions";

const RATE_LIMIT_MS = 10000; // 10 seconds
const COMMON_EMOJIS = [
    "😂", "😢", "😱", "😬", "🤔", "😈",
    "❤️", "💀", "🔥", "✨", "🎉",
    "👍", "👎", "🙏", "👋", "😫",
    "❓", "❗", "😡", "😮",
];

export function StickerPicker() {
    const context = useQuestContext();
    const { actionService } = useActionService();
    const [isOpen, setIsOpen] = useState(false);
    const [lastUsedTime, setLastUsedTime] = useState(0);
    const [timeLeft, setTimeLeft] = useState(0);
    const popoverRef = useRef<HTMLDivElement>(null);

    const campaign = CampaignActions.getActiveCampaign(context);
    const isPlayer = context.User.Role === "player";
    const selectedCharacterId = context.User.SelectedCharacters[campaign.RoomCode];

    // Disable if player but no character selected
    const isDisabled = isPlayer && !selectedCharacterId;

    // Close on click outside
    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    // Countdown timer
    useEffect(() => {
        if (lastUsedTime === 0) return;

        const interval = setInterval(() => {
            const now = Date.now();
            const diff = now - lastUsedTime;
            if (diff >= RATE_LIMIT_MS) {
                setTimeLeft(0);
                clearInterval(interval);
            } else {
                setTimeLeft(Math.ceil((RATE_LIMIT_MS - diff) / 1000));
            }
        }, 100);

        return () => clearInterval(interval);
    }, [lastUsedTime]);

    const handleStickerClick = (emoji: string) => {
        if (timeLeft > 0 || isDisabled) return;

        // Determine actor ID
        let actorId = undefined;
        if (isPlayer) {
            actorId = selectedCharacterId;
        } else {
            // DM doesn't have a single actor automatically, maybe we just don't send actorId
            // Or we could try to send "DM" as actorId if the backend/log allows it
            // For now, let's leave it undefined for DM, which means it shows as DM in log
            // But for map display, we need an actor ID to attach to.
            // If DM has a selected actor, maybe use that?
            // The current hook filters by entry.ActorId. If DM sends no ActorId, it won't show on map.
            // Let's rely on DM selecting an actor.
            // Getting selected actor from MapState is hard here without context.
            // But wait, the requirement is "Stickers... will appear above **their character token**".
            // So for DM, maybe it only works if they are acting as an NPC? 
            // Or maybe we skip DM map stickers for now?
            // Let's stick to the player flow first.
            // Actually, let's try to grab selected actor from MapState if possible, but MapStateProvider is inside Main. 
            // Main wraps StickerPicker inside MapStateProvider, so we CAN use useMapState()!
        }

        // Actually, we can't easily access MapState here because we are IN Main, 
        // and MapStateProvider wraps the content. 
        // StickerPicker will be inside MapStateProvider if we place it correctly.
        // But for filtering, let's stick to the requirement: "players can use to emote... above THEIR character token"

        if (isPlayer && !actorId) return;

        if (actionService) {
            actionService.execute("log:create", {
                category: "sticker",
                action: `sent a sticker: ${emoji}`,
                details: emoji,
                level: "info",
                visibility: ["all"],
                actorId: actorId
            });

            setLastUsedTime(Date.now());
            setIsOpen(false);
            setTimeLeft(RATE_LIMIT_MS / 1000);
        }
    };

    const toggleOpen = () => {
        if (timeLeft > 0 || isDisabled) return;
        setIsOpen(!isOpen);
    };

    return (
        <div className="relative" ref={popoverRef}>
            <button
                className={`btn btn-square btn-lg shadow-lg text-xl ${timeLeft > 0 || isDisabled ? "btn-disabled opacity-50" : "btn-accent"
                    }`}
                onClick={toggleOpen}
                title={isDisabled ? "Select a character first" : timeLeft > 0 ? `Wait ${timeLeft}s` : "Send Sticker"}
            >
                {timeLeft > 0 ? (
                    <span className="text-xs font-bold">{timeLeft}</span>
                ) : (
                    "😀"
                )}
            </button>

            {isOpen && (
                <div className="absolute bottom-14 right-0 p-2 bg-base-100 rounded-lg shadow-xl border border-base-300 grid grid-cols-4 gap-1 w-48 z-50">
                    {COMMON_EMOJIS.map((emoji) => (
                        <button
                            key={emoji}
                            className="btn btn-ghost btn-sm text-xl h-10 w-10 p-0"
                            onClick={() => handleStickerClick(emoji)}
                        >
                            {emoji}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
