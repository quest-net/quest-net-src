// src/components/Dice/DiceRoller.tsx

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuestContext } from "../../domains/Context/ContextProvider";
import { useActionService } from "../../services/Actions/ActionServiceProvider";
import { CampaignActions } from "../../domains/Campaign/CampaignActions";
import {
	addDieToFormula,
	isValidDiceFormula,
	normalizeFormula,
	rollDiceFormula,
	makeRollLogText,
	DiceRollResult,
} from "../../utils/DiceUtils";

/** Enhanced Dice Roller with geometric shapes and visual effects */

const DICE_CONFIG = [
	{
		sides: 4,
		color: "from-slate-500 to-slate-600",
		icon: "icon-[mdi--dice-d4-outline]",
		name: "d4",
	},
	{
		sides: 6,
		color: "from-rose-500 to-rose-600",
		icon: "icon-[mdi--dice-d6-outline]",
		name: "d6",
	},
	{
		sides: 8,
		color: "from-pink-500 to-pink-600",
		icon: "icon-[mdi--dice-d8-outline]",
		name: "d8",
	},
	{
		sides: 10,
		color: "from-fuchsia-500 to-fuchsia-600",
		icon: "icon-[mdi--dice-d10-outline]",
		name: "d10",
	},
	{
		sides: 12,
		color: "from-purple-500 to-purple-600",
		icon: "icon-[mdi--dice-d12-outline]",
		name: "d12",
	},
	{
		sides: 20,
		color: "from-violet-500 to-violet-600",
		icon: "icon-[mdi--dice-d20-outline]",
		name: "d20",
	},
	{
		sides: 100,
		color: "from-indigo-500 to-indigo-600",
		icon: "icon-[tabler--number-100-small]",
		name: "d100",
	},
] as const;

interface PreviewDie {
	id: string;
	sides: number;
	kept: boolean;
	isMax: boolean;
	isMin: boolean;
	finalValue: number;
	displayValue: number;
	spinning: boolean;
	startedAt: number;
	durationMs: number;
}

interface Particle {
	id: string;
	x: number;
	y: number;
	vx: number;
	vy: number;
	life: number;
	maxLife: number;
	color: string;
	size: number;
	type: "confetti" | "dark";
}

function uid() {
	return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
/**
 * Converts polygon points to a rounded path
 * @param points - Array of [x, y] coordinate pairs
 * @param radius - Corner radius (recommend 6-8 for these dice)
 */
function roundedPolygonPath(
	points: [number, number][],
	radius: number
): string {
	if (points.length < 3) return "";

	const numPoints = points.length;
	let path = "";

	for (let i = 0; i < numPoints; i++) {
		const curr = points[i];
		const prev = points[(i - 1 + numPoints) % numPoints];
		const next = points[(i + 1) % numPoints];

		// Vector from prev to curr
		const v1x = curr[0] - prev[0];
		const v1y = curr[1] - prev[1];
		const len1 = Math.sqrt(v1x * v1x + v1y * v1y);

		// Vector from curr to next
		const v2x = next[0] - curr[0];
		const v2y = next[1] - curr[1];
		const len2 = Math.sqrt(v2x * v2x + v2y * v2y);

		// Normalize and scale by radius
		const offset1x = (v1x / len1) * Math.min(radius, len1 / 2);
		const offset1y = (v1y / len1) * Math.min(radius, len1 / 2);
		const offset2x = (v2x / len2) * Math.min(radius, len2 / 2);
		const offset2y = (v2y / len2) * Math.min(radius, len2 / 2);

		// Points for the rounded corner
		const p1x = curr[0] - offset1x;
		const p1y = curr[1] - offset1y;
		const p2x = curr[0] + offset2x;
		const p2y = curr[1] + offset2y;

		if (i === 0) {
			path += `M ${p1x} ${p1y}`;
		} else {
			path += ` L ${p1x} ${p1y}`;
		}

		// Arc to the next line segment
		path += ` Q ${curr[0]} ${curr[1]} ${p2x} ${p2y}`;
	}

	path += " Z";
	return path;
}
/**
 * Generates points for a regular polygon (equal sides and angles)
 * @param sides - Number of sides
 * @param centerX - Center X coordinate
 * @param centerY - Center Y coordinate
 * @param radius - Distance from center to vertices
 * @param rotation - Starting rotation in degrees (0 = point at top)
 */
function regularPolygonPoints(
	sides: number,
	centerX: number,
	centerY: number,
	radius: number,
	rotation: number = -90 // -90 puts a point at the top
): [number, number][] {
	const points: [number, number][] = [];
	const angleStep = (Math.PI * 2) / sides;
	const startAngle = (rotation * Math.PI) / 180;

	for (let i = 0; i < sides; i++) {
		const angle = startAngle + angleStep * i;
		const x = centerX + radius * Math.cos(angle);
		const y = centerY + radius * Math.sin(angle);
		points.push([x, y]);
	}

	return points;
}
// Geometric shape components with colored backgrounds
function DieShape({
	sides,
	value,
	isCrit,
	isFumble,
	rainbowPhase,
	className = "",
}: {
	sides: number;
	value: number;
	isCrit?: boolean;
	isFumble?: boolean;
	rainbowPhase?: number;
	className?: string;
}) {
	const config = DICE_CONFIG.find((c) => c.sides === sides);
	const gradientId = `gradient-${sides}-${Math.random()
		.toString(36)
		.slice(2, 7)}`;

	// Determine colors based on crit/fumble status
	let startColor, endColor;
	if (isCrit && (sides === 20 || sides === 100) && rainbowPhase !== undefined) {
		// Rainbow cycling for d20/d100 crits
		const colors = [
			["#ef4444", "#dc2626"], // red
			["#f97316", "#ea580c"], // orange
			["#eab308", "#ca8a04"], // yellow
			["#22c55e", "#16a34a"], // green
			["#3b82f6", "#2563eb"], // blue
			["#8b5cf6", "#7c3aed"], // purple
		];
		const colorIndex = Math.floor(rainbowPhase) % colors.length;
		[startColor, endColor] = colors[colorIndex];
	} else if (isCrit) {
		// Non-d20/d100 crits stay green
		startColor = "#22c55e";
		endColor = "#16a34a";
	} else if (isFumble) {
		startColor = "#ef4444";
		endColor = "#dc2626";
	} else {
		// Normal die colors - slate to indigo range
		startColor = config?.color.includes("slate")
			? "#64748b"
			: config?.color.includes("rose")
				? "#f43f5e"
				: config?.color.includes("pink")
					? "#ec4899"
					: config?.color.includes("fuchsia")
						? "#d946ef"
						: config?.color.includes("purple")
							? "#a855f7"
							: config?.color.includes("violet")
								? "#8b5cf6"
								: config?.color.includes("indigo")
									? "#6366f1"
									: "#6b7280";
		endColor = config?.color.includes("slate")
			? "#475569"
			: config?.color.includes("rose")
				? "#e11d48"
				: config?.color.includes("pink")
					? "#db2777"
					: config?.color.includes("fuchsia")
						? "#c026d3"
						: config?.color.includes("purple")
							? "#9333ea"
							: config?.color.includes("violet")
								? "#7c3aed"
								: config?.color.includes("indigo")
									? "#4f46e5"
									: "#4b5563";
	}

	const renderShape = () => {
		const radius = 24;

		switch (sides) {
			case 4: // Triangle - regular with point at top
				return (
					<path
						d={roundedPolygonPath(
							regularPolygonPoints(3, 50, 50, 40, -90),
							radius / 3
						)}
					/>
				);
			case 6: // Square
				return <rect x="20" y="20" width="60" height="60" rx="6" />;
			case 8: // Diamond
				return (
					<path
						d={roundedPolygonPath(
							[
								[50, 15],
								[85, 50],
								[50, 85],
								[15, 50],
							],
							radius / 4
						)}
					/>
				);
			case 10: // Diamond
				return (
					<path
						d={roundedPolygonPath(
							[
								[50, 15],
								[85, 50],
								[50, 85],
								[15, 50],
							],
							radius / 4
						)}
					/>
				);
			case 12: // Pentagon - regular with point at top
				return (
					<path
						d={roundedPolygonPath(
							regularPolygonPoints(5, 50, 50, 35, -90),
							radius / 5
						)}
					/>
				);
			case 20: // Hexagon
				return (
					<path
						d={roundedPolygonPath(
							[
								[50, 10],
								[85, 30],
								[85, 70],
								[50, 90],
								[15, 70],
								[15, 30],
							],
							radius / 6
						)}
					/>
				);
			case 100: // Octagon
				return (
					<path
						d={roundedPolygonPath(
							[
								[35, 15],
								[65, 15],
								[85, 35],
								[85, 65],
								[65, 85],
								[35, 85],
								[15, 65],
								[15, 35],
							],
							radius / 8
						)}
					/>
				);
			default:
				return null;
		}
	};

	// Simplified text positioning - always center
	const textY = "58";
	const textSize = sides === 100 ? "text-xl" : "text-2xl";

	return (
		<svg viewBox="0 0 100 100" className={className}>
			<defs>
				<linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
					<stop offset="0%" stopColor={startColor} />
					<stop offset="100%" stopColor={endColor} />
				</linearGradient>
			</defs>
			<g fill={`url(#${gradientId})`}>{renderShape()}</g>
			<text
				x="50"
				y={textY}
				textAnchor="middle"
				className={`${textSize} font-bold fill-white`}
				style={{
					filter: "drop-shadow(0px 2px 3px rgba(0,0,0,0.8))",
					paintOrder: "stroke fill",
				}}
			>
				{value}
			</text>
		</svg>
	);
}

export function DiceRoller() {
	const context = useQuestContext();
	const { actionService } = useActionService();
	const campaign = CampaignActions.getActiveCampaign(context);
	const userRole = context.User.Role;

	const [isOpen, setIsOpen] = useState<boolean>(() => {
		try {
			return (localStorage.getItem("questnet.dice.open") ?? "0") === "1";
		} catch {
			return false;
		}
	});

	const [formula, setFormula] = useState<string>("");
	const [autoRoll, setAutoRoll] = useState<boolean>(() => {
		try {
			return (localStorage.getItem("questnet.dice.autoroll") ?? "1") === "1";
		} catch {
			return true;
		}
	});
	const [rolling, setRolling] = useState(false);
	const [result, setResult] = useState<DiceRollResult | null>(null);
	const [previewDice, setPreviewDice] = useState<PreviewDie[]>([]);
	const [particles, setParticles] = useState<Particle[]>([]);
	const [rainbowPhase, setRainbowPhase] = useState(0);
	const [hasCrit, setHasCrit] = useState(false);

	const [, setHasFumble] = useState(false);

	const debounceRef = useRef<number | null>(null);
	const tickRef = useRef<number | null>(null);
	const particleTickRef = useRef<number | null>(null);
	const confettiSpawnRef = useRef<number | null>(null);
	const rainbowTickRef = useRef<number | null>(null);

	const { canRoll, error } = useMemo(() => {
		if (!formula.trim()) {
			return { canRoll: false, error: null };
		}
		try {
			const isValid = isValidDiceFormula(formula);
			return {
				canRoll: isValid,
				error: isValid ? null : "Invalid formula"
			};
		} catch (e) {
			return {
				canRoll: false,
				error: e instanceof Error ? e.message : "Invalid formula"
			};
		}
	}, [formula]);

	const getRollerName = (): string => {
		if (userRole === "dm") return "DM";
		const selectedCharacterId =
			context.User.SelectedCharacters[campaign.RoomCode];
		const selectedCharacter = selectedCharacterId
			? campaign.GameState.Characters.find((c) => c.Id === selectedCharacterId)
			: null;
		return selectedCharacter ? selectedCharacter.Name : context.User.Name;
	};

	const persistAutoRoll = (value: boolean) => {
		setAutoRoll(value);
		try {
			localStorage.setItem("questnet.dice.autoroll", value ? "1" : "0");
		} catch { }
	};

	const persistOpen = (value: boolean) => {
		setIsOpen(value);
		try {
			localStorage.setItem("questnet.dice.open", value ? "1" : "0");
		} catch { }
	};

	// Continuous confetti spawner
	const startContinuousConfetti = () => {
		if (confettiSpawnRef.current) return; // Already spawning

		// Spawn initial burst
		spawnParticles("confetti", 40);

		// Keep spawning every 200ms
		confettiSpawnRef.current = window.setInterval(() => {
			spawnParticles("confetti", 15);
		}, 400);
	};

	const stopContinuousConfetti = () => {
		if (confettiSpawnRef.current) {
			window.clearInterval(confettiSpawnRef.current);
			confettiSpawnRef.current = null;
		}
	};

	// Rainbow animation for d20/d100 crits
	const startRainbowAnimation = () => {
		if (rainbowTickRef.current) return;

		rainbowTickRef.current = window.setInterval(() => {
			setRainbowPhase((prev) => (prev + 0.15) % 6);
		}, 50);
	};

	const stopRainbowAnimation = () => {
		if (rainbowTickRef.current) {
			window.clearInterval(rainbowTickRef.current);
			rainbowTickRef.current = null;
		}
		setRainbowPhase(0);
	};

	const spawnParticles = (type: "confetti" | "dark", count: number = 30) => {
		const newParticles: Particle[] = [];
		for (let i = 0; i < count; i++) {
			const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.5;

			// MUCH MUCH smaller speeds - these are per-frame at 60fps!
			const speed =
				type === "confetti"
					? 0.1 + Math.random() * 0.2 // confetti: 0.1-0.3 per frame
					: 0.05 + Math.random() * 0.15; // fumble: 0.05-0.2 per frame

			newParticles.push({
				id: uid(),
				x: 50,
				y: 60,
				vx: Math.cos(angle) * speed,
				vy: Math.sin(angle) * speed - (type === "confetti" ? 0.8 : 0.1), // Gentle upward start
				life: 1,
				maxLife: 1,
				color:
					type === "confetti"
						? [
							"#fbbf24",
							"#f59e0b",
							"#ef4444",
							"#ec4899",
							"#8b5cf6",
							"#3b82f6",
						][Math.floor(Math.random() * 6)]
						: ["#1f2937", "#374151", "#4b5563"][Math.floor(Math.random() * 3)],
				size: 4 + Math.random() * 4,
				type,
			});
		}
		setParticles((prev) => [...prev, ...newParticles]);

		if (!particleTickRef.current) {
			const animateParticles = () => {
				setParticles((prev) => {
					const updated = prev
						.map((p) => ({
							...p,
							x: p.x + p.vx,
							y: p.y + p.vy,
							vy: p.vy + 0.015, // Very gentle gravity per frame
							life: p.life - 0.008, // Slower fade - lasts ~125 frames / ~2 seconds
						}))
						.filter((p) => p.life > 0);

					if (updated.length === 0) {
						particleTickRef.current = null;
						return [];
					} else {
						particleTickRef.current = requestAnimationFrame(animateParticles);
						return updated;
					}
				});
			};
			particleTickRef.current = requestAnimationFrame(animateParticles);
		}
	};

	// Unique fumble effect: shaking/crumbling particles from the die
	// Replace the startFumbleEffect function with this:
	const startFumbleEffect = () => {
		let shakeCount = 0;
		const shakeInterval = window.setInterval(() => {
			if (shakeCount >= 6) {
				clearInterval(shakeInterval);
				// Use spawnParticles instead of manually adding particles
				// This ensures the animation loop starts
				const fumbleParticles: Particle[] = [];
				for (let i = 0; i < 30; i++) {
					const angle = Math.random() * Math.PI * 2;
					const speed = 0.5 + Math.random() * 2;
					fumbleParticles.push({
						id: uid(),
						x: 50,
						y: 60,
						vx: Math.cos(angle) * speed,
						vy: Math.sin(angle) * speed + Math.random() * 2, // Fall down
						life: 1,
						maxLife: 1,
						color: ["#7f1d1d", "#991b1b", "#b91c1c", "#1f2937"][
							Math.floor(Math.random() * 4)
						],
						size: 2 + Math.random() * 3,
						type: "dark",
					});
				}

				setParticles((prev) => [...prev, ...fumbleParticles]);

				// CRITICAL: Start the animation loop if not already running
				if (!particleTickRef.current) {
					const animateParticles = () => {
						setParticles((prev) => {
							const updated = prev
								.map((p) => ({
									...p,
									x: p.x + p.vx,
									y: p.y + p.vy,
									vy: p.vy + 0.2, // gravity
									life: p.life - 0.02,
								}))
								.filter((p) => p.life > 0);

							if (updated.length === 0) {
								particleTickRef.current = null;
								return [];
							} else {
								particleTickRef.current =
									requestAnimationFrame(animateParticles);
								return updated;
							}
						});
					};
					particleTickRef.current = requestAnimationFrame(animateParticles);
				}
			}
			shakeCount++;
		}, 80);
	};

	const startAnimation = (roll: DiceRollResult, onComplete?: () => void) => {
		const now = Date.now();
		const dice: PreviewDie[] = roll.dice.map((d) => ({
			id: uid(),
			sides: d.sides,
			kept: d.kept,
			isMax: d.isMax,
			isMin: d.isMin,
			finalValue: d.value,
			displayValue: Math.max(
				1,
				Math.min(d.sides, Math.floor(Math.random() * d.sides) + 1)
			),
			spinning: true,
			startedAt: now,
			durationMs: 400 + Math.floor(Math.random() * 1500),
		}));

		setPreviewDice(dice);
		setRolling(true);

		if (tickRef.current) window.clearInterval(tickRef.current);
		tickRef.current = window.setInterval(() => {
			setPreviewDice((prev) => {
				const t = Date.now();
				const next = prev.map((p) => {
					if (!p.spinning) return p;
					const elapsed = t - p.startedAt;
					if (elapsed >= p.durationMs) {
						return { ...p, spinning: false, displayValue: p.finalValue };
					} else {
						const remaining = p.durationMs - elapsed;
						let newVal: number;
						if (remaining < 150) {
							const half = Math.ceil(p.sides / 2);
							if (p.finalValue <= half)
								newVal = Math.min(p.sides, p.finalValue + half);
							else newVal = Math.max(1, p.finalValue - half);
						} else {
							newVal = Math.floor(Math.random() * p.sides) + 1;
						}
						return { ...p, displayValue: newVal };
					}
				});

				if (next.every((d) => !d.spinning)) {
					if (tickRef.current) {
						window.clearInterval(tickRef.current);
						tickRef.current = null;
					}
					setRolling(false);

					// Check for crits/fumbles AFTER animation completes
					const critCheck = next.some(
						(d) => d.kept && (d.sides === 20 || d.sides === 100) && d.isMax
					);
					const fumbleCheck = next.some(
						(d) => d.kept && (d.sides === 20 || d.sides === 100) && d.isMin
					);

					setHasCrit(critCheck);
					setHasFumble(fumbleCheck);

					// IMPORTANT: Call onComplete callback BEFORE effects
					if (onComplete) {
						onComplete();
					}

					// Trigger effects with delay after roll settles
					if (critCheck) {
						setTimeout(() => {
							startContinuousConfetti();
							startRainbowAnimation();
						}, 300);
					} else if (fumbleCheck) {
						setTimeout(() => startFumbleEffect(), 300);
					}
				}
				return next;
			});
		}, 35);
	};

	const performRoll = () => {
		if (!canRoll) return;

		// Clear previous effects
		stopContinuousConfetti();
		stopRainbowAnimation();
		setHasCrit(false);
		setHasFumble(false);
		setParticles([]);

		const seed = Date.now() & 0xfffffff;
		const r = rollDiceFormula(formula, { seed });

		// Start animation and pass callback for when it completes
		startAnimation(r, () => {
			// NOW set the result (updates stats display)
			setResult(r);

			// NOW log to the action service
			if (actionService) {
				const rollerName = getRollerName();
				let actorId: string | undefined = undefined;
				if (userRole === "player") {
					const selectedCharacterId =
						context.User.SelectedCharacters[campaign.RoomCode];
					if (selectedCharacterId) actorId = selectedCharacterId;
				}

				// Determine visibility based on campaign settings
				const visibilitySettings = campaign.Settings.VisibilitySettings;
				let visibility: ("dm" | "player" | "owner" | "all")[];

				if (userRole === "dm") {
					// DM roll - check if players should see it
					visibility = visibilitySettings.playersSeeDMRolls ? ["all"] : ["dm"];
				} else {
					// Player roll - check if other players should see it
					visibility = visibilitySettings.playersSeePeerRolls
						? ["all"]
						: ["dm", "owner"];
				}

				actionService.execute("log:create", {
					action: `${rollerName} ${makeRollLogText(r)}`,
					details: `Breakdown: ${r.breakdown}`,
					category: "dice",
					level: "important",
					visibility,
					actorId,
				});
			}
		});

		setFormula("");
	};

	useEffect(() => {
		if (!autoRoll) return;
		if (!canRoll) return;
		if (debounceRef.current) window.clearTimeout(debounceRef.current);
		debounceRef.current = window.setTimeout(() => {
			performRoll();
		}, 1000) as unknown as number;
		return () => {
			if (debounceRef.current) window.clearTimeout(debounceRef.current);
		};
	}, [formula, autoRoll]);

	useEffect(() => {
		return () => {
			if (tickRef.current) window.clearInterval(tickRef.current);
			if (debounceRef.current) window.clearTimeout(debounceRef.current);
			if (particleTickRef.current)
				window.clearInterval(particleTickRef.current);
			if (confettiSpawnRef.current)
				window.clearInterval(confettiSpawnRef.current);
			if (rainbowTickRef.current) window.clearInterval(rainbowTickRef.current);
		};
	}, []);

	const handleAddDie = (sides: number) => {
		setFormula((f) => {
			const next = addDieToFormula(f, sides);
			return normalizeSafe(next);
		});
		if (!isOpen) persistOpen(true);
	};

	const normalizeSafe = (v: string) => {
		const trimmed = v.trim();
		if (!trimmed) return "";
		try {
			return normalizeFormula(trimmed);
		} catch {
			return v;
		}
	};

	const onFormulaChange = (v: string) => {
		setFormula(v);
	};

	const onFormulaBlur = () => {
		setFormula((f) => normalizeSafe(f));
	};

	return (
		<div className="absolute bottom-2 left-2 z-50">
			{!isOpen && (
				<button
					onClick={() => persistOpen(true)}
					className="btn btn-square btn-primary btn-lg shadow-2xl hover:scale-110 transition-transform"
					aria-label="Open dice roller"
					title="Dice Roller"
				>
					<span className="icon-[fa-solid--dice-d20] w-7 h-7" />
				</button>
			)}

			{isOpen && (
				<div className="card w-[420px] bg-linear-to-br from-base-100 to-base-200 shadow-2xl border-2 border-base-300">
					<div className="card-body p-5 gap-4">
						{/* Header */}
						<div className="flex items-center justify-between">
							<div className="flex items-center gap-3">
								<span className="icon-[fa-solid--dice-d20] w-6 h-6" />
								<h3 className="font-bold text-xl">Dice Roller</h3>
							</div>
							<button
								className="btn btn-ghost btn-sm btn-circle"
								onClick={() => persistOpen(false)}
								aria-label="Close dice roller"
							>
								<span className="icon-[mdi--close] w-5 h-5" />
							</button>
						</div>

						{/* Colorful Dice Palette */}
						<div className="flex flex-wrap gap-2 justify-center">
							{DICE_CONFIG.map((dice) => (
								<button
									key={dice.sides}
									onClick={() => handleAddDie(dice.sides)}
									className={`btn btn-md btn-square bg-linear-to-br ${dice.color} text-white border-0 hover:scale-110 hover:shadow-lg transition-all`}
									title={`Add 1${dice.name}`}
									aria-label={`Add 1${dice.name}`}
								>
									<span className={`${dice.icon} w-7 h-7`} />
								</button>
							))}
						</div>

						{/* Formula Input & Controls */}
						<div className="flex flex-col gap-2">
							<div className="flex gap-2 items-center">
								<input
									type="text"
									className={`input input-sm  flex-1 font-mono bg-base-200  ${canRoll || !formula.trim() ? "" : "input-error"
										}`}
									placeholder="e.g., 2d20kh1 + 5"
									value={formula}
									onChange={(e) => onFormulaChange(e.target.value)}
									onBlur={onFormulaBlur}
									onKeyDown={(e) => {
										if (e.key === "Enter") {
											e.preventDefault();
											performRoll();
										}
									}}
								/>

								<div className="tooltip" data-tip="Auto-roll after 1s">
									<button
										className={`btn btn-sm btn-square transition-all ${autoRoll ? "btn-accent shadow-lg" : "btn-ghost"
											}`}
										onClick={() => persistAutoRoll(!autoRoll)}
										aria-label="Toggle autoroll"
									>
										<span
											className={`icon-[mdi--autorenew] w-5 h-5 ${autoRoll ? "" : "opacity-40"
												}`}
										/>
									</button>
								</div>

								<button
									className="btn btn-primary btn-sm px-4 shadow-lg hover:shadow-xl transition-all"
									onClick={performRoll}
									disabled={!canRoll || rolling}
								>
									{rolling ? (
										<span className="loading loading-spinner loading-sm" />
									) : (
										<>
											<span className="icon-[fa-solid--dice-d20] w-4 h-4" />
											<span className="font-bold">Roll</span>
										</>
									)}
								</button>
							</div>
							{/* Error message */}
							{error && (
								<div className="text-error text-xs flex items-center gap-1">
									<span className="icon-[mdi--alert-circle] w-4 h-4" />
									<span>{error}</span>
								</div>
							)}
						</div>
						{/* Dice Preview with Particles - Increased height and padding */}
						<div className="relative min-h-40 bg-base-300 rounded-xl p-4 overflow-hidden flex flex-col">
							{/* Particle layer */}
							<div className="absolute inset-0 pointer-events-none">
								{particles.map((p) => (
									<div
										key={p.id}
										className="absolute rounded-full transition-opacity"
										style={{
											left: `${p.x}%`,
											top: `${p.y}%`,
											width: `${p.size}px`,
											height: `${p.size}px`,
											backgroundColor: p.color,
											opacity: p.life,
											transform: `translate(-50%, -50%) rotate(${p.life * 360
												}deg)`,
										}}
									/>
								))}
							</div>

							{/* Dice grid */}
							{previewDice.length === 0 ? (
								<div className="flex items-center justify-center h-32 text-sm opacity-50">
									<div className="text-center">
										<span className="icon-[mdi--dice-multiple-outline] w-8 h-8 mx-auto mb-2" />
										<p>Build your roll above</p>
									</div>
								</div>
							) : (
								<div className="flex flex-wrap gap-3 flex-1 justify-center items-center content-center relative z-10">
									{previewDice.map((d) => {
										const isCrit = d.kept && d.isMax;
										const isFumble = d.kept && d.isMin;
										const isSpecialDie = d.sides === 20 || d.sides === 100;

										return (
											<div
												key={d.id}
												className={`relative transition-all duration-300 ${d.spinning ? "animate-pulse" : ""
													} ${!d.kept ? "opacity-40 grayscale" : ""}`}
												title={`${d.kept ? "Kept" : "Dropped"} - d${d.sides}: ${d.finalValue
													}`}
											>
												<div
													className={`relative ${!d.spinning && isFumble && isSpecialDie
															? "animate-[shake_0.5s_ease-in-out]"
															: !d.spinning && isCrit
																? "animate-bounce"
																: ""
														}`}
												>
													<DieShape
														sides={d.sides}
														value={d.displayValue}
														isCrit={!d.spinning && isCrit}
														isFumble={!d.spinning && isFumble}
														rainbowPhase={
															hasCrit && isSpecialDie ? rainbowPhase : undefined
														}
														className={`w-20 h-20 ${!d.spinning && isCrit && isSpecialDie
																? "drop-shadow-[0_0_20px_rgba(139,92,246,0.8)]"
																: !d.spinning && isCrit
																	? "drop-shadow-[0_0_16px_rgba(34,197,94,1)]"
																	: !d.spinning && isFumble
																		? "drop-shadow-[0_0_16px_rgba(239,68,68,1)]"
																		: "drop-shadow-lg"
															} ${d.spinning
																? "animate-spin [animation-duration:400ms]"
																: ""
															}`}
													/>
													{!d.spinning && isCrit && (
														<div className="absolute -top-2 -right-2 bg-success text-success-content text-[10px] px-2 py-0.5 rounded-full font-bold shadow-lg animate-bounce">
															CRIT!
														</div>
													)}
													{!d.spinning && isFumble && isSpecialDie && (
														<div className="absolute -top-2 -right-2 bg-error text-error-content text-[10px] px-2 py-0.5 rounded-full font-bold shadow-lg">
															FAIL
														</div>
													)}
												</div>
											</div>
										);
									})}
								</div>
							)}
						</div>

						{/* Stats Display - Neutral backgrounds for highest/lowest */}
						<div className="grid grid-cols-3 gap-3">
							<div
								className={`bg-linear-to-br from-primary to-primary/80 rounded-xl p-3 shadow-lg ${result ? "scale-105" : ""
									} transition-transform`}
							>
								<div className="text-xs text-primary-content opacity-80 font-medium">
									TOTAL
								</div>
								<div className="text-3xl font-bold text-primary-content">
									{result?.stats.total ?? "—"}
								</div>
							</div>

							<div className="bg-base-200 rounded-xl p-3 border border-base-300">
								<div className="text-xs opacity-70 font-medium">HIGHEST</div>
								<div className="text-2xl font-bold">
									{result?.stats.highestDie ?? "—"}
								</div>
							</div>

							<div className="bg-base-200 rounded-xl p-3 border border-base-300">
								<div className="text-xs opacity-70 font-medium">LOWEST</div>
								<div className="text-2xl font-bold">
									{result?.stats.lowestDie ?? "—"}
								</div>
							</div>
						</div>
					</div>
				</div>
			)}

			{/* Custom shake animation */}
			<style>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          10%, 30%, 50%, 70%, 90% { transform: translateX(-4px); }
          20%, 40%, 60%, 80% { transform: translateX(4px); }
        }
      `}</style>
		</div>
	);
}
