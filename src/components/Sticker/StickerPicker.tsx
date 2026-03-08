
import { useState, useRef, useEffect } from "react";
import { useQuestContext } from "../../domains/Context/ContextProvider";
import { useActionService } from "../../services/Actions/ActionServiceProvider";
import { CampaignActions } from "../../domains/Campaign/CampaignActions";

const RATE_LIMIT_MS = 10000; // 10 seconds
const COMMON_EMOJIS = [
    "😂", "😢", "😱", "😬", "🤔", "😈",
    "❤️", "💀", "🔥", "✨", "🎉",
    "👍", "👎", "🍆", "👋", "😫",
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
            // DM doesn't have an actor
        }

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
