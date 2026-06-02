// domains/Log/LogDisplay.tsx

import {
	useState,
	useRef,
	useEffect,
	useLayoutEffect,
	useMemo,
} from "react";
import { LocalStorageUtilities } from "../../utils/LocalStorageUtilities";
import { useQuestContext } from "../Context/ContextProvider";
import { useActionService } from "../../services/Actions/ActionServiceProvider";
import { CampaignActions } from "../Campaign/CampaignActions";
import { LogEntry, LogCategory } from "./LogEntry";
import { LogActions } from "./LogActions";

// ============================================================================
// CATEGORY PALETTE
// ============================================================================
// Per-theme foreground colors. Backgrounds are derived from these via
// color-mix at runtime, so each row gets a subtle tint that matches its
// label color in both themes without fighting the surface.

const CATEGORY_FG_LIGHT: Record<LogCategory, string> = {
	combat: "#b91c1c",     // red-700
	character: "#1d4ed8",  // blue-700
	item: "#a16207",       // amber-700
	skill: "#7e22ce",      // purple-700
	dice: "#15803d",       // green-700
	movement: "#374151",   // gray-700
	scene: "#0e7490",      // cyan-700
	chat: "#c2410c",       // orange-700
	sticker: "#334155",    // slate-700
	ping: "#0e7490",       // cyan-700
	system: "#334155",     // slate-700
};

const CATEGORY_FG_DARK: Record<LogCategory, string> = {
	combat: "#f87171",     // red-400
	character: "#60a5fa",  // blue-400
	item: "#fbbf24",       // amber-400
	skill: "#c084fc",      // purple-400
	dice: "#4ade80",       // green-400
	movement: "#9ca3af",   // gray-400
	scene: "#22d3ee",      // cyan-400
	chat: "#fb923c",       // orange-400
	sticker: "#94a3b8",    // slate-400
	ping: "#22d3ee",       // cyan-400
	system: "#94a3b8",     // slate-400
};

// 12% of the foreground over the surface — subtle row band in either theme.
function tintBg(fg: string): string {
	return `color-mix(in oklab, ${fg} 12%, transparent)`;
}

// Tracks the current daisyUI theme set on <html data-theme="…">.
function useDataTheme(): "light" | "dark" {
	const [theme, setTheme] = useState<"light" | "dark">(() => {
		const t = document.documentElement.getAttribute("data-theme");
		return t === "dark" ? "dark" : "light";
	});

	useEffect(() => {
		const update = () => {
			const t = document.documentElement.getAttribute("data-theme");
			setTheme(t === "dark" ? "dark" : "light");
		};
		const observer = new MutationObserver(update);
		observer.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ["data-theme"],
		});
		return () => observer.disconnect();
	}, []);

	return theme;
}

const FILTER_STORAGE_KEY = "quest-net-log-filters";
const INITIAL_MESSAGES_SHOWN = 50;
const MESSAGES_PER_LOAD = 50;
const SCROLL_THRESHOLD = 100; // Considered "near bottom" within this many px.
const LOAD_MORE_TRIGGER = 100; // Distance from top that triggers load-more.

interface LogDisplayProps {
	isFloating?: boolean;
	onClose?: () => void;
}

export function LogDisplay({ isFloating = false, onClose }: LogDisplayProps) {
	const context = useQuestContext();
	const { actionService } = useActionService();
	const theme = useDataTheme();
	const palette = theme === "dark" ? CATEGORY_FG_DARK : CATEGORY_FG_LIGHT;

	const [message, setMessage] = useState("");
	const [searchQuery, setSearchQuery] = useState("");
	const [showFilters, setShowFilters] = useState(false);
	const [messagesToShow, setMessagesToShow] = useState(INITIAL_MESSAGES_SHOWN);
	const [showScrollButton, setShowScrollButton] = useState(false);

	const logEndRef = useRef<HTMLDivElement>(null);
	const logContainerRef = useRef<HTMLDivElement>(null);

	// `isNearBottom` lives in a ref so the auto-scroll effect doesn't refire
	// on its own state change — only on actual new content.
	const isNearBottomRef = useRef(true);

	// Snapshot for restoring scroll position after prepending older messages.
	const pendingScrollRestore = useRef<number | null>(null);

	// Track previous tail so we only auto-scroll when a new message lands.
	const prevDisplayedLengthRef = useRef(0);
	const prevLastIdRef = useRef<string | undefined>(undefined);

	const campaign = CampaignActions.getActiveCampaign(context);
	const userRole = context.User.Role;
	const selectedCharacterId =
		context.User.SelectedCharacters[campaign.RoomCode];

	// --- Filters (persisted) -------------------------------------------------
	const [hiddenCategories, setHiddenCategories] = useState<Set<LogCategory>>(
		() => {
			try {
				const saved = localStorage.getItem(FILTER_STORAGE_KEY);
				if (saved) return new Set(JSON.parse(saved));
			} catch (e) {
				console.error("Failed to load log filters:", e);
			}
			return new Set();
		}
	);

	useEffect(() => {
		LocalStorageUtilities.trySave(
			FILTER_STORAGE_KEY,
			Array.from(hiddenCategories)
		);
	}, [hiddenCategories]);

	// --- Derived log views ---------------------------------------------------
	// Recompute memos when Log is mutated in-place via push/splice.
	const logLength = campaign.Log.length;
	const lastLogId = logLength > 0 ? campaign.Log[logLength - 1].Id : "∅";

	const visibleLog = useMemo(() => {
		const chronologicalLog = LogActions.getChronologicalLog(campaign);
		return chronologicalLog.filter((entry) =>
			LogActions.canUserSeeEntry(entry, userRole)
		);
	}, [campaign.Log, campaign.LogHead, userRole, selectedCharacterId, logLength, lastLogId]);

	const categoryFilteredLog = useMemo(
		() => visibleLog.filter((entry) => !hiddenCategories.has(entry.Category)),
		[visibleLog, hiddenCategories]
	);

	const searchFilteredLog = useMemo(() => {
		if (!searchQuery.trim()) return categoryFilteredLog;
		const query = searchQuery.toLowerCase();
		return categoryFilteredLog.filter(
			(entry) =>
				entry.Action.toLowerCase().includes(query) ||
				entry.Details?.toLowerCase().includes(query)
		);
	}, [categoryFilteredLog, searchQuery]);

	const displayedLog = useMemo(() => {
		const total = searchFilteredLog.length;
		return searchFilteredLog.slice(Math.max(0, total - messagesToShow));
	}, [searchFilteredLog, messagesToShow]);

	const hasMoreMessages = searchFilteredLog.length > messagesToShow;
	const remainingMessages = searchFilteredLog.length - messagesToShow;

	// Reset pagination when filters/search change so we don't carry an
	// inflated window across a different result set.
	useEffect(() => {
		setMessagesToShow(INITIAL_MESSAGES_SHOWN);
	}, [searchQuery, hiddenCategories]);

	// --- Scroll handling -----------------------------------------------------
	const updateScrollPosition = () => {
		const container = logContainerRef.current;
		if (!container) return;
		const distanceFromBottom =
			container.scrollHeight - container.scrollTop - container.clientHeight;
		const nearBottom = distanceFromBottom < SCROLL_THRESHOLD;
		isNearBottomRef.current = nearBottom;
		setShowScrollButton(!nearBottom);
	};

	const handleScroll = () => {
		updateScrollPosition();
		const container = logContainerRef.current;
		if (!container) return;

		// Load older messages when near the top.
		if (container.scrollTop < LOAD_MORE_TRIGGER && hasMoreMessages) {
			pendingScrollRestore.current = container.scrollHeight;
			setMessagesToShow((prev) => prev + MESSAGES_PER_LOAD);
		}
	};

	// Restore scroll position synchronously after older messages prepend, so
	// the user stays anchored at the same row instead of jumping to the top.
	useLayoutEffect(() => {
		const container = logContainerRef.current;
		if (!container || pendingScrollRestore.current == null) return;
		const oldHeight = pendingScrollRestore.current;
		pendingScrollRestore.current = null;
		container.scrollTop = container.scrollHeight - oldHeight;
	}, [messagesToShow]);

	// Auto-scroll to bottom on *new* messages only — never on length decreases,
	// older-message loads, or filter/search shrinks. Disabled while searching.
	useLayoutEffect(() => {
		const length = displayedLog.length;
		const lastId = displayedLog[length - 1]?.Id;
		const grew = length > prevDisplayedLengthRef.current;
		const tailChanged = lastId !== prevLastIdRef.current;

		prevDisplayedLengthRef.current = length;
		prevLastIdRef.current = lastId;

		if (!grew || !tailChanged) return;
		if (searchQuery.trim()) return; // Don't yank away from search results.
		if (!isNearBottomRef.current) return;

		// Use "auto" (instant) for new-message tracking — "smooth" stutters when
		// multiple messages arrive in quick succession.
		logEndRef.current?.scrollIntoView({ behavior: "auto", block: "end" });
	}, [displayedLog, searchQuery]);

	const scrollToBottom = () => {
		// Smooth is fine here because it's a single explicit user action.
		logEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
		isNearBottomRef.current = true;
		setShowScrollButton(false);
	};

	// --- Filters & messaging -------------------------------------------------
	const toggleCategory = (category: LogCategory) => {
		setHiddenCategories((prev) => {
			const next = new Set(prev);
			if (next.has(category)) next.delete(category);
			else next.add(category);
			return next;
		});
	};

	const handleSendMessage = () => {
		if (!actionService || !message.trim()) return;

		let actorId: string | undefined;
		if (userRole !== "dm") {
			actorId = context.User.SelectedCharacters[campaign.RoomCode];
		}

		actionService.execute("log:create", {
			action: message.trim(),
			category: "chat",
			level: "info",
			visibility: ["all"],
			actorId,
		});

		setMessage("");
	};

	const handleKeyPress = (e: React.KeyboardEvent) => {
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			handleSendMessage();
		}
	};

	const getEntryLabel = (entry: LogEntry): string => {
		if (entry.ActorId) {
			const character = campaign.GameState.Characters.find(
				(c) => c.Id === entry.ActorId
			);
			return character?.Name || "Player";
		}
		if (entry.Category === "dice" || entry.Category === "chat") return "DM";
		return "System";
	};

	const availableCategories: LogCategory[] =
		userRole === "player"
			? ["chat", "dice"]
			: [
				"chat",
				"dice",
				"combat",
				"character",
				"item",
				"skill",
				"movement",
				"scene",
				"system",
			];

	return (
		<div className={`flex flex-col h-full ${isFloating ? "p-4" : ""}`}>
			{/* Header */}
			<div className="flex justify-between items-center gap-3 mb-4">
				<div className="flex items-center gap-2">
					<h3 className="font-bold text-lg">Log</h3>
					<button
						onClick={() => setShowFilters(!showFilters)}
						className="btn btn-ghost btn-xs"
						title="Toggle filters"
						aria-expanded={showFilters}
					>
						<span className="icon-[mdi--filter] w-4 h-4"></span>
					</button>
				</div>

				<div className="flex-1 max-w-xs relative">
					<input
						type="text"
						placeholder="Search..."
						value={searchQuery}
						onChange={(e) => setSearchQuery(e.target.value)}
						className="input input-sm input-bordered w-full pr-8"
					/>
					{searchQuery ? (
						<button
							onClick={() => setSearchQuery("")}
							className="absolute right-2 top-1/2 -translate-y-1/2 btn btn-ghost btn-xs btn-circle"
							aria-label="Clear search"
						>
							<span className="icon-[mdi--close] w-4 h-4"></span>
						</button>
					) : (
						<span className="absolute right-2 top-1/2 -translate-y-1/2 icon-[mdi--magnify] w-4 h-4 opacity-40 pointer-events-none"></span>
					)}
				</div>

				{isFloating && onClose && (
					<button
						onClick={onClose}
						className="btn btn-ghost btn-sm btn-circle"
						aria-label="Close log"
					>
						<span className="icon-[mdi--close] w-5 h-5"></span>
					</button>
				)}
			</div>

			{/* Search results info */}
			{searchQuery && (
				<p className="text-xs opacity-60 mb-3 -mt-2">
					Found {searchFilteredLog.length} message
					{searchFilteredLog.length !== 1 ? "s" : ""}
				</p>
			)}

			{/* Collapsible filter pills — colored by category, theme-aware. */}
			{showFilters && (
				<div className="flex flex-wrap gap-2 mb-4 p-2 bg-base-100 rounded-lg border border-base-content/10">
					{availableCategories.map((cat) => {
						const hidden = hiddenCategories.has(cat);
						const fg = palette[cat];
						return (
							<button
								key={cat}
								onClick={() => toggleCategory(cat)}
								className={`badge badge-sm cursor-pointer transition-all border ${hidden ? "opacity-40" : ""
									}`}
								style={{
									color: fg,
									backgroundColor: hidden ? "transparent" : tintBg(fg),
									borderColor: fg,
								}}
								title={`${hidden ? "Show" : "Hide"} ${cat}`}
								aria-pressed={!hidden}
							>
								<span className="font-semibold">{cat}</span>
							</button>
						);
					})}
				</div>
			)}

			{/* Log entries — surface uses base-200 so it's calm in both themes. */}
			<div
				ref={logContainerRef}
				onScroll={handleScroll}
				role="log"
				aria-live="polite"
				className="flex-1 overflow-y-auto bg-base-200 text-base-content rounded-lg p-3 space-y-1 font-mono text-sm relative border border-base-content/10"
			>
				{hasMoreMessages && (
					<div className="text-center py-2 opacity-60 text-xs sticky top-0 bg-base-200 z-10">
						<button
							onClick={() => setMessagesToShow((prev) => prev + MESSAGES_PER_LOAD)}
							className="btn btn-ghost btn-xs"
						>
							Load {Math.min(MESSAGES_PER_LOAD, remainingMessages)} more message
							{remainingMessages !== 1 ? "s" : ""} ({remainingMessages} remaining)
						</button>
					</div>
				)}

				{displayedLog.length === 0 ? (
					<p className="text-center opacity-50">
						{searchQuery ? "No messages match your search" : "No log entries"}
					</p>
				) : (
					displayedLog.map((entry) => {
						const fg = palette[entry.Category];
						const label = getEntryLabel(entry);
						return (
							<div
								key={entry.Id}
								className="flex gap-2 p-1 rounded"
								style={{ backgroundColor: tintBg(fg) }}
								title={
									entry.Timestamp
										? new Date(entry.Timestamp).toLocaleString()
										: undefined
								}
							>
								<span
									className="font-bold shrink-0 min-w-[6ch] truncate"
									style={{ color: fg }}
								>
									[{label}]
								</span>
								<span className="break-words text-base-content">
									{entry.Action}
								</span>
							</div>
						);
					})
				)}
				<div ref={logEndRef}></div>

			</div>

			{/* Scroll-to-bottom — pinned just above the input bar. */}
			{showScrollButton && (
				<div className="relative">
					<button
						onClick={scrollToBottom}
						className="absolute -top-12 right-3 btn btn-sm btn-circle btn-primary shadow-lg"
						title="Scroll to bottom"
						aria-label="Scroll to bottom"
					>
						<span className="icon-[mdi--arrow-down] w-4 h-4"></span>
					</button>
				</div>
			)}

			{/* Message input */}
			<div className="flex gap-2 mt-4">
				<input
					type="text"
					placeholder="Type a message..."
					className="input input-sm flex-1 font-mono"
					value={message}
					onChange={(e) => setMessage(e.target.value)}
					onKeyDown={handleKeyPress}
				/>
				<button
					onClick={handleSendMessage}
					className="btn btn-primary btn-sm"
					disabled={!message.trim()}
				>
					<span className="icon-[mdi--send] w-4 h-4"></span>
				</button>
			</div>
		</div>
	);
}
