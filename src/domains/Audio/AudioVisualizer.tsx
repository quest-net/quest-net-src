// domains/Audio/AudioVisualizer.tsx
import { useEffect, useRef, useState } from "react";

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const m = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduced(m.matches);
    onChange();
    m.addEventListener?.("change", onChange);
    return () => m.removeEventListener?.("change", onChange);
  }, []);
  return reduced;
}

type AudioVisualizerProps = {
  /** 0..1 */
  level: number;
  /** number of bars */
  bars?: number;
  /** height in px */
  height?: number;
  className?: string;
};

export function AudioVisualizer({
  level,
  bars = 24,
  height = 64,
  className = "",
}: AudioVisualizerProps) {
  const reduced = usePrefersReducedMotion();
  const [heights, setHeights] = useState<number[]>(
    () => Array.from({ length: bars }, () => 0)
  );
  const raf = useRef<number | null>(null);

  const lvl = Math.max(0, Math.min(1, level));

  useEffect(() => {
    if (reduced) {
      // Static layout that still reflects volume
      setHeights(
        Array.from({ length: bars }, (_, i) => {
          const bias = i % 5 === 0 ? 0.6 : i % 3 === 0 ? 0.8 : 0.7;
          return Math.max(0.06, (0.1 + 0.9 * lvl) * bias);
        })
      );
      return;
    }

    let last = performance.now();
    const speeds = Array.from(
      { length: bars },
      (_, i) => 100 + ((i * 43) % 160) // ms between target updates
    );
    const hold: number[] = Array.from({ length: bars }, () => 0);
    const current: number[] = Array.from({ length: bars }, () => 0);
    const target: number[] = Array.from({ length: bars }, () => Math.random());
    const easing = 0.10;

    const step = (t: number) => {
      const dt = t - last;
      last = t;

      for (let i = 0; i < bars; i++) {
        hold[i] -= dt;
        if (hold[i] <= 0) {
          // New random target with some bar-specific bias
          const bias = i % 4 === 0 ? 0.9 : i % 3 === 0 ? 0.6 : 0.75;
          const random = Math.pow(Math.random(), 1.25); // spend more time near low values
          const maxForLevel = 0.15 + 0.85 * lvl; // lower ceiling at low volume
          target[i] = Math.min(1, random * maxForLevel * bias);
          hold[i] = speeds[i] + (Math.random() * 140 - 70); // jitter timing
        }
        // Ease current toward target (sample-and-hold vibe)
        current[i] += (target[i] - current[i]) * easing;

        // Tiny baseline so it's never totally flat (still scales with low volume)
        const floor = 0.04 + 0.08 * lvl;
        current[i] = Math.max(floor, current[i]);
      }

      setHeights([...current]);
      raf.current = requestAnimationFrame(step);
    };

    raf.current = requestAnimationFrame(step);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [bars, lvl, reduced]);

  return (
    <div
      className={className}
      style={{
        height: `${height}px`,
        width: "100%",
        display: "grid",
        gridTemplateColumns: `repeat(${bars}, minmax(0, 1fr))`,
        alignItems: "end",
        gap: "4px",
      }}
      aria-hidden
    >
      {heights.map((h, i) => (
        <div
          key={i}
          className="rounded-sm bg-linear-to-t from-primary/30 via-primary/80 to-primary"
          style={{ height: `${Math.round(h * 100)}%` }}
        />
      ))}
    </div>
  );
}
