// domains/Dice/DiceRoller.tsx

import { useState } from "react";
import { useQuestContext } from "../../domains/Context/ContextProvider";
import { useActionService } from "../../services/Actions/ActionServiceProvider";
import { CampaignActions } from "../../domains/Campaign/CampaignActions";
import { rollDiceFormula, isValidDiceFormula, flipCoin } from "../../utils/DiceUtils";

const DICE_OPTIONS = [
	{ label: "d2", formula: "1d2" },
	{ label: "d4", formula: "1d4" },
	{ label: "d6", formula: "1d6" },
	{ label: "d8", formula: "1d8" },
	{ label: "d10", formula: "1d10" },
	{ label: "d12", formula: "1d12" },
	{ label: "d20", formula: "1d20" },
	{ label: "d100", formula: "1d100" },
];

export function DiceRoller() {
	const context = useQuestContext();
	const { actionService } = useActionService();
	const [isExpanded, setIsExpanded] = useState(false);
	const [customFormula, setCustomFormula] = useState("");
	const [error, setError] = useState<string | null>(null);

	const campaign = CampaignActions.getActiveCampaign(context);
	const userRole = context.User.Role;

	// Get the roller's name
	const getRollerName = (): string => {
		if (userRole === "dm") {
			return "DM";
		}

		// For players, get their selected character's name
		const selectedCharacterId =
			context.User.SelectedCharacters[campaign.RoomCode];
		const selectedCharacter = selectedCharacterId
			? campaign.GameState.Characters.find((c) => c.Id === selectedCharacterId)
			: null;

		return selectedCharacter ? selectedCharacter.Name : context.User.Name;
	};

	const handleRoll = (formula: string) => {
		if (!actionService) return;

		try {
			setError(null);
			const result = rollDiceFormula(formula);
			const rollerName = getRollerName();

			// Get actor ID if rolling as a character
			let actorId: string | undefined = undefined;
			if (userRole === "player") {
				const selectedCharacterId =
					context.User.SelectedCharacters[campaign.RoomCode];
				if (selectedCharacterId) {
					actorId = selectedCharacterId;
				}
			}

			// Create log entry
			actionService.execute("log:create", {
				action: `${rollerName} rolled ${result.formula}: ${result.total}`,
				details: `Breakdown: ${result.breakdown}`,
				category: "dice",
				level: "info",
				visibility: ["all"],
				actorId,
			});

			// Clear custom formula on successful roll
			setCustomFormula("");
		} catch (err) {
			setError(err instanceof Error ? err.message : "Invalid dice formula");
		}
	};

	const handleCustomRoll = () => {
		if (!customFormula.trim()) return;

		if (!isValidDiceFormula(customFormula)) {
			setError("Invalid dice formula");
			return;
		}

		handleRoll(customFormula);
	};

	const handleKeyPress = (e: React.KeyboardEvent) => {
		if (e.key === "Enter") {
			e.preventDefault();
			handleCustomRoll();
		}
	};

	const handleCoinFlip = () => {
		if (!actionService) return;

		const result = flipCoin();
		const rollerName = getRollerName();

		// Get actor ID if rolling as a character
		let actorId: string | undefined = undefined;
		if (userRole === "player") {
			const selectedCharacterId =
				context.User.SelectedCharacters[campaign.RoomCode];
			if (selectedCharacterId) {
				actorId = selectedCharacterId;
			}
		}

		// Create log entry
		actionService.execute("log:create", {
			action: `${rollerName} flipped a coin: ${result}`,
			category: "dice",
			level: "info",
			visibility: ["all"],
			actorId,
		});
	};

	return (
		<div
            className="absolute bottom-2 left-2 z-50"
            onMouseEnter={() => setIsExpanded(true)}
            onMouseLeave={() => {
                setIsExpanded(false);
                setError(null);
            }}
        >
            {!isExpanded ? (
                // Compact dice icon
                <div className="btn btn-square btn-primary btn-xl shadow-lg">
                    <span className="icon-[fa-solid--dice-d20] w-8 h-8"></span>
                </div>
			) : (
				// Expanded dice roller
				<div className="card w-80 bg-base-100 shadow-xl">
					<div className="card-body p-4">
						<h3 className="font-bold text-lg mb-2">Roll Dice</h3>

						{/* Preset Dice Buttons */}
						<div className="grid grid-cols-4 gap-2 mb-3">
							{DICE_OPTIONS.map((dice) => (
								<button
									key={dice.label}
									onClick={() => handleRoll(dice.formula)}
									className="btn btn-sm btn-primary"
								>
									{dice.label}
								</button>
							))}
						</div>

						{/* Coin Flip Button */}
						<button
							onClick={handleCoinFlip}
							className="btn btn-sm btn-accent w-full mb-3"
						>
							<span className="icon-[mdi--coin] w-4 h-4 mr-1"></span>
							Flip Coin
						</button>

						{/* Custom Formula Input */}
						<div className="divider my-1">Custom</div>
						<div className="flex gap-2">
							<input
								type="text"
								placeholder="e.g., 2d6+3"
								className="input input-sm input-bordered flex-1 font-mono"
								value={customFormula}
								onChange={(e) => {
									setCustomFormula(e.target.value);
									setError(null);
								}}
								onKeyDown={handleKeyPress}
							/>
							<button
								onClick={handleCustomRoll}
								className="btn btn-primary btn-sm"
								disabled={!customFormula.trim()}
							>
								Roll
							</button>
						</div>

						{/* Error Message */}
						{error && (
							<div className="alert alert-error p-2 mt-2">
								<span className="text-xs">{error}</span>
							</div>
						)}

						{/* Help Text */}
						<p className="text-xs opacity-60 mt-2">
							Examples: 1d20, 2d6+3, 1d8+1d6-2
						</p>
					</div>
				</div>
			)}
		</div>
	);
}