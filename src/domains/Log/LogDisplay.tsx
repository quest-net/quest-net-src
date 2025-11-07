// domains/Log/LogDisplay.tsx - Updated

import { useState, useRef, useEffect, useMemo } from "react";
import { useQuestContext } from "../Context/ContextProvider";
import { useActionService } from "../../services/Actions/ActionServiceProvider";
import { CampaignActions } from "../Campaign/CampaignActions";
import { LogEntry, LogCategory } from "./LogEntry";
import { LogActions } from "./LogActions";

// Category color configuration - easily customizable
const CATEGORY_COLORS: Record<LogCategory, string> = {
	combat: "text-red-400",
	character: "text-blue-400",
	item: "text-yellow-400",
	skill: "text-purple-400",
	dice: "text-green-400",
	movement: "text-gray-400",
	scene: "text-cyan-400",
	chat: "text-orange-400",
	system: "text-slate-400",
};

const CATEGORY_BG: Record<LogCategory, string> = {
	combat: "bg-red-950/30",
	character: "bg-blue-950/30",
	item: "bg-yellow-950/30",
	skill: "bg-purple-950/30",
	dice: "bg-green-950/30",
	movement: "bg-gray-950/30",
	scene: "bg-cyan-950/30",
	chat: "bg-orange-950/30",
	system: "bg-slate-950/30",
};

const FILTER_STORAGE_KEY = "quest-net-log-filters";
const INITIAL_MESSAGES_SHOWN = 50;
const MESSAGES_PER_LOAD = 50;
const SCROLL_THRESHOLD = 100; // Auto-scroll if within 100px of bottom

interface LogDisplayProps {
	isFloating?: boolean;
	onClose?: () => void;
}

export function LogDisplay({ isFloating = false, onClose }: LogDisplayProps) {
	const context = useQuestContext();
	const { actionService } = useActionService();
	const [message, setMessage] = useState("");
	const [searchQuery, setSearchQuery] = useState("");
	const logEndRef = useRef<HTMLDivElement>(null);
	const logContainerRef = useRef<HTMLDivElement>(null);
	const [showFilters, setShowFilters] = useState(false);
	const [messagesToShow, setMessagesToShow] = useState(INITIAL_MESSAGES_SHOWN);
	const [isNearBottom, setIsNearBottom] = useState(true);
	const userScrolledUp = useRef(false);

	const campaign = CampaignActions.getActiveCampaign(context);
	const userRole = context.User.Role;
	const selectedCharacterId =
		context.User.SelectedCharacters[campaign.RoomCode];

	// Load filters from localStorage
	const [hiddenCategories, setHiddenCategories] = useState<Set<LogCategory>>(
		() => {
			try {
				const saved = localStorage.getItem(FILTER_STORAGE_KEY);
				if (saved) {
					return new Set(JSON.parse(saved));
				}
			} catch (e) {
				console.error("Failed to load log filters:", e);
			}
			return new Set();
		}
	);

	// Save filters to localStorage whenever they change
	useEffect(() => {
		try {
			localStorage.setItem(
				FILTER_STORAGE_KEY,
				JSON.stringify(Array.from(hiddenCategories))
			);
		} catch (e) {
			console.error("Failed to save log filters:", e);
		}
	}, [hiddenCategories]);

	// Helps recompute memos when Log is mutated in-place via push/splice
	const logLength = campaign.Log.length;
	const lastLogId = logLength > 0 ? campaign.Log[logLength - 1].Id : "∅";

	// Filter by visibility using centralized helper
	const visibleLog = useMemo(() => {
		return campaign.Log.filter((entry) =>
			LogActions.canUserSeeEntry(entry, userRole, selectedCharacterId)
		);
	}, [campaign.Log, userRole, selectedCharacterId, logLength, lastLogId]);

	// Filter by category preferences
	const categoryFilteredLog = useMemo(
		() => visibleLog.filter((entry) => !hiddenCategories.has(entry.Category)),
		[visibleLog, hiddenCategories]
	);

	// Filter by search query
	const searchFilteredLog = useMemo(() => {
		if (!searchQuery.trim()) return categoryFilteredLog;
		
		const query = searchQuery.toLowerCase();
		return categoryFilteredLog.filter(
			(entry) =>
				entry.Action.toLowerCase().includes(query) ||
				entry.Details?.toLowerCase().includes(query)
		);
	}, [categoryFilteredLog, searchQuery]);

	// Get only the messages we want to display (last N messages)
	const displayedLog = useMemo(() => {
		const totalMessages = searchFilteredLog.length;
		const startIndex = Math.max(0, totalMessages - messagesToShow);
		return searchFilteredLog.slice(startIndex);
	}, [searchFilteredLog, messagesToShow]);

	const hasMoreMessages = searchFilteredLog.length > messagesToShow;
	const remainingMessages = searchFilteredLog.length - messagesToShow;

	// Check if user is near bottom of scroll
	const checkScrollPosition = () => {
		const container = logContainerRef.current;
		if (!container) return;

		const distanceFromBottom =
			container.scrollHeight - container.scrollTop - container.clientHeight;
		const nearBottom = distanceFromBottom < SCROLL_THRESHOLD;
		
		setIsNearBottom(nearBottom);
		userScrolledUp.current = !nearBottom;
	};

	// Handle scroll events
	const handleScroll = () => {
		checkScrollPosition();

		const container = logContainerRef.current;
		if (!container) return;

		// Load more messages when scrolling near the top
		if (container.scrollTop < 100 && hasMoreMessages) {
			const oldScrollHeight = container.scrollHeight;
			setMessagesToShow((prev) => prev + MESSAGES_PER_LOAD);
			
			// Maintain scroll position after loading
			requestAnimationFrame(() => {
				if (container) {
					const newScrollHeight = container.scrollHeight;
					container.scrollTop = newScrollHeight - oldScrollHeight;
				}
			});
		}
	};

	// Auto-scroll to bottom when new messages arrive (if user hasn't scrolled up)
	useEffect(() => {
		if (isNearBottom && logEndRef.current && !userScrolledUp.current) {
			logEndRef.current.scrollIntoView({ behavior: "smooth" });
		}
	}, [displayedLog.length, isNearBottom]);

	// Scroll to bottom button handler
	const scrollToBottom = () => {
		logEndRef.current?.scrollIntoView({ behavior: "smooth" });
		setIsNearBottom(true);
		userScrolledUp.current = false;
	};

	const toggleCategory = (category: LogCategory) => {
		setHiddenCategories((prev) => {
			const next = new Set(prev);
			if (next.has(category)) {
				next.delete(category);
			} else {
				next.add(category);
			}
			return next;
		});
	};

	const handleSendMessage = () => {
		if (!actionService || !message.trim()) return;

		// For players, use their selected character's ID as actorId
		let actorId: string | undefined;
		if (userRole !== "dm") {
			const selectedCharId =
				context.User.SelectedCharacters[campaign.RoomCode];
			actorId = selectedCharId;
		}

		actionService.execute("log:create", {
			action: message.trim(),
			category: "chat",
			level: "info",
			visibility: ["all"],
			actorId: actorId,
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
		// If it has an actorId, it's from a player
		if (entry.ActorId) {
			const character = campaign.GameState.Characters.find(
				(c) => c.Id === entry.ActorId
			);
			return character?.Name || "Player";
		}

		// If it's dice or chat without actorId, it's from DM
		if (entry.Category === "dice" || entry.Category === "chat") {
			return "DM";
		}

		// Otherwise it's a system message
		return "System";
	};

	// Categories available to current user
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
			{/* Header with Search */}
			<div className="flex justify-between items-center gap-3 mb-4">
				<div className="flex items-center gap-2">
					<h3 className="font-bold text-lg">Log</h3>
					<button
						onClick={() => setShowFilters(!showFilters)}
						className="btn btn-ghost btn-xs"
						title="Toggle filters"
					>
						<span className="icon-[mdi--filter] w-4 h-4"></span>
					</button>
				</div>

				{/* Compact Search Bar */}
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

			{/* Search Results Info */}
			{searchQuery && (
				<p className="text-xs opacity-60 mb-3 -mt-2">
					Found {searchFilteredLog.length} message{searchFilteredLog.length !== 1 ? "s" : ""}
				</p>
			)}

			{/* Collapsible Filter Pills */}
			{showFilters && (
				<div className="flex flex-wrap gap-2 mb-4 p-2 bg-base-200 rounded-lg">
					{availableCategories.map((cat) => (
						<button
							key={cat}
							onClick={() => toggleCategory(cat)}
							className={`badge badge-sm cursor-pointer transition-all ${
								hiddenCategories.has(cat)
									? "badge-ghost opacity-40"
									: "badge-neutral"
							}`}
							title={`${hiddenCategories.has(cat) ? "Show" : "Hide"} ${cat}`}
						>
							<span className={`${CATEGORY_COLORS[cat]} font-semibold`}>
								{cat}
							</span>
						</button>
					))}
				</div>
			)}

			{/* Log Entries */}
			<div
				ref={logContainerRef}
				onScroll={handleScroll}
				className="flex-1 overflow-y-auto bg-base-300 rounded-lg p-3 space-y-1 font-mono text-sm relative"
			>
				{hasMoreMessages && (
					<div className="text-center py-2 opacity-60 text-xs sticky top-0 bg-base-300 z-10">
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
					<p className="text-center text-base-content opacity-50">
						{searchQuery ? "No messages match your search" : "No log entries"}
					</p>
				) : (
					displayedLog.map((entry) => {
						const label = getEntryLabel(entry);
						const colorClass = CATEGORY_COLORS[entry.Category];
						const bgClass = CATEGORY_BG[entry.Category];

						return (
							<div
								key={entry.Id}
								className={`flex gap-2 p-1 rounded ${bgClass} hover:bg-opacity-50 transition-colors`}
								title={
									entry.Timestamp
										? new Date(entry.Timestamp).toLocaleString()
										: undefined
								}
							>
								<span className={`${colorClass} font-bold shrink-0 min-w-12`}>
									[{label}]
								</span>
								<span className="text-white wrap-break-word">{entry.Action}</span>
							</div>
						);
					})
				)}
				<div ref={logEndRef}></div>

				{/* Scroll to Bottom Button */}
				{!isNearBottom && (
					<button
						onClick={scrollToBottom}
						className="absolute bottom-4 right-4 btn btn-sm btn-circle btn-primary shadow-lg"
						title="Scroll to bottom"
					>
						<span className="icon-[mdi--arrow-down] w-4 h-4"></span>
					</button>
				)}
			</div>

			{/* Message Input */}
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