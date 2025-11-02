// utils/DiceUtils.ts

interface DiceRollResult {
	formula: string;
	total: number;
	breakdown: string;
}

/**
 * Rolls a single die with the given number of sides
 */
function rollDie(sides: number): number {
	return Math.floor(Math.random() * sides) + 1;
}

/**
 * Parses and rolls a dice formula string like "1d6+5", "2d4+1d6-3"
 * Returns the total and a breakdown of the roll
 */
export function rollDiceFormula(formula: string): DiceRollResult {
	// Remove all whitespace
	const cleaned = formula.replace(/\s/g, "");

	// Validate formula
	if (!cleaned || !/^[\dd+\-]+$/i.test(cleaned)) {
		throw new Error(`Invalid dice formula: ${formula}`);
	}

	let total = 0;
	const breakdownParts: string[] = [];

	// Split by + and - while keeping the operators
	const parts = cleaned.split(/([+\-])/);

	let currentSign = 1; // 1 for positive, -1 for negative

	for (const part of parts) {
		if (part === "+") {
			currentSign = 1;
			continue;
		}
		if (part === "-") {
			currentSign = -1;
			continue;
		}

		if (!part) continue;

		// Check if it's a dice roll (e.g., "2d6") or a flat modifier (e.g., "5")
		const diceMatch = part.match(/^(\d+)?d(\d+)$/i);

		if (diceMatch) {
			// It's a dice roll
			const count = parseInt(diceMatch[1] || "1");
			const sides = parseInt(diceMatch[2]);

			if (count <= 0 || sides <= 0) {
				throw new Error(`Invalid dice specification: ${part}`);
			}

			const rolls: number[] = [];
			for (let i = 0; i < count; i++) {
				rolls.push(rollDie(sides));
			}

			const subtotal = rolls.reduce((sum, roll) => sum + roll, 0);
			total += subtotal * currentSign;

			const sign = currentSign === 1 ? "+" : "-";
			breakdownParts.push(
				`${sign}[${rolls.join("+")}]${count > 1 ? `=${subtotal}` : ""}`
			);
		} else {
			// It's a flat modifier
			const modifier = parseInt(part);
			if (isNaN(modifier)) {
				throw new Error(`Invalid modifier: ${part}`);
			}

			total += modifier * currentSign;

			const sign = currentSign === 1 ? "+" : "-";
			breakdownParts.push(`${sign}${Math.abs(modifier)}`);
		}
	}

	// Clean up the breakdown string
	let breakdown = breakdownParts.join("");
	// Remove leading + if present
	if (breakdown.startsWith("+")) {
		breakdown = breakdown.substring(1);
	}

	return {
		formula: cleaned,
		total,
		breakdown,
	};
}

/**
 * Validates a dice formula without rolling it
 */
export function isValidDiceFormula(formula: string): boolean {
	try {
		const cleaned = formula.replace(/\s/g, "");
		if (!cleaned) return false;
		if (!/^[\dd+\-]+$/i.test(cleaned)) return false;

		// Try to parse it
		const parts = cleaned.split(/([+\-])/);
		for (const part of parts) {
			if (part === "+" || part === "-" || !part) continue;

			const diceMatch = part.match(/^(\d+)?d(\d+)$/i);
			if (diceMatch) {
				const count = parseInt(diceMatch[1] || "1");
				const sides = parseInt(diceMatch[2]);
				if (count <= 0 || sides <= 0) return false;
			} else {
				const modifier = parseInt(part);
				if (isNaN(modifier)) return false;
			}
		}

		return true;
	} catch {
		return false;
	}
}

/**
 * Flips a coin and returns "Heads" or "Tails"
 */
export function flipCoin(): "Heads" | "Tails" {
	return Math.random() < 0.5 ? "Heads" : "Tails";
}