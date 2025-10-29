// domains/Log/LogDisplay.tsx

import { useState, useRef, useEffect } from "react";
import { useQuestContext } from "../Context/ContextProvider";
import { useActionService } from "../../services/Actions/ActionServiceProvider";
import { CampaignActions } from "../Campaign/CampaignActions";

export function LogDisplay() {
	const context = useQuestContext();
	const { actionService } = useActionService();
	const [isOpen, setIsOpen] = useState(false);
	const [message, setMessage] = useState("");
	const logEndRef = useRef<HTMLDivElement>(null);

	// Get campaign and filter log entries by visibility
	const campaign = CampaignActions.getActiveCampaign(context);
	const userRole = context.User.Role;

	const filteredLog = campaign.Log.filter((entry) => {
		// Show if visibility includes 'all'
		if (entry.Visibility.includes("all")) return true;

		// Show if visibility matches user role
		if (userRole === "dm" && entry.Visibility.includes("dm")) return true;
		if (userRole === "player" && entry.Visibility.includes("player"))
			return true;

		return false;
	});

	// Auto-scroll to bottom when log updates
	useEffect(() => {
		if (logEndRef.current) {
			logEndRef.current.scrollIntoView();
		}
	}, [filteredLog.length]);

	// Auto-scroll to bottom when log opens
	useEffect(() => {
		if (isOpen && logEndRef.current) {
			logEndRef.current.scrollIntoView();
		}
	}, [isOpen]);

	const handleSendMessage = () => {
		if (!actionService || !message.trim()) return;

		const category = userRole === "dm" ? "system" : "character";

		actionService.execute("log:create", {
			action: message.trim(),
			category: category,
			level: "info",
			visibility: ["all"],
		});

		setMessage("");
	};

	const handleKeyPress = (e: React.KeyboardEvent) => {
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			handleSendMessage();
		}
	};

	return (
		<div className="fixed bottom-4 right-4">
			{/* Toggle Button */}
			{!isOpen && (
				<button
					onClick={() => setIsOpen(true)}
					className="btn btn-circle btn-primary btn-lg shadow-lg"
					aria-label="Open log"
				>
					<span className="icon-[mdi--message-text] w-6 h-6"></span>
				</button>
			)}

			{/* Log Window */}
			{isOpen && (
				<div className="card w-96 h-96 bg-base-100 shadow-xl flex flex-col">
					{/* Header */}
					<div className="card-body p-4 flex flex-col h-full">
						<div className="flex justify-between items-center">
							<h3 className="font-bold text-lg">Log</h3>
							<button
								onClick={() => setIsOpen(false)}
								className="btn btn-ghost btn-sm btn-circle"
								aria-label="Close log"
							>
								<span className="icon-[mdi--close] w-5 h-5"></span>
							</button>
						</div>

						{/* Log Entries */}
						<div className="flex-1 overflow-y-auto space-y-1">
							{filteredLog.length === 0 ? (
								<p className="text-center text-base-content opacity-50">
									No log entries yet
								</p>
							) : (
								filteredLog.map((entry) => (
									<div key={entry.Id}>
										<div
											className="tooltip tooltip-left w-full text-left"
											data-tip={entry.Details || "No details"}
										>
											<p className="text-sm font-mono cursor-default">
												{entry.Action}
											</p>
										</div>
										<hr className="opacity-25" />
									</div>
								))
							)}
							{/* Invisible div at the end for auto-scroll */}
							<div ref={logEndRef}></div>
						</div>

						{/* Message Input */}
						<div className="flex gap-2">
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
				</div>
			)}
		</div>
	);
}
