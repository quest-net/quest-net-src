import { useMemo } from "react";

interface Dot {
	cx: number;
	cy: number;
	r: number;
}

const WIDTH = 1040;
const HEIGHT = 420;
const STEP = 12;

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

function getDotRadius(x: number, y: number): number {
	const focalPoints = [
		{ x: WIDTH * 0.64, y: HEIGHT * 0.26, sx: 210, sy: 105, strength: 1.15 },
		{ x: WIDTH * 0.32, y: HEIGHT * 0.72, sx: 155, sy: 90, strength: 0.72 },
		{ x: WIDTH * 0.88, y: HEIGHT * 0.62, sx: 130, sy: 115, strength: 0.58 },
	];
	const focalValue = focalPoints.reduce((total, point) => {
		const dx = (x - point.x) / point.sx;
		const dy = (y - point.y) / point.sy;
		return total + Math.exp(-(dx * dx + dy * dy)) * point.strength;
	}, 0);
	const contour = Math.sin(x * 0.018 + y * 0.011) * 0.14;
	const normalized = clamp(focalValue + contour, 0, 1);

	return 0.65 + normalized * 7.2;
}

function buildDots(): Dot[] {
	const dots: Dot[] = [];

	for (let y = STEP / 2; y < HEIGHT; y += STEP) {
		for (let x = STEP / 2; x < WIDTH; x += STEP) {
			const r = getDotRadius(x, y);

			dots.push({
				cx: x,
				cy: y,
				r,
			});
		}
	}

	return dots;
}

export function WikiHalftone() {
	const dots = useMemo(buildDots, []);

	return (
		<svg
			aria-hidden="true"
			className="pointer-events-none absolute inset-0 h-full w-full text-neutral-content opacity-20 mix-blend-normal"
			preserveAspectRatio="xMidYMid slice"
			viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
		>
			{dots.map((dot) => (
				<circle
					key={`${dot.cx}-${dot.cy}`}
					cx={dot.cx}
					cy={dot.cy}
					r={dot.r}
					fill="currentColor"
				/>
			))}
		</svg>
	);
}
