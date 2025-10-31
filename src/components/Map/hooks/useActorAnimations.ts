// hooks/useActorAnimations.ts
// Manages smooth movement animations for actors on the map

import { useState, useCallback, useEffect, useRef } from "react";
import type { Position } from "../../../domains/Actor/Actor";
import type { Character } from "../../../domains/Character/Character";
import type { Entity } from "../../../domains/Entity/Entity";

interface ActorAnimation {
  actorId: string;
  from: Position;
  to: Position;
  startTime: number;
  duration: number;
}

interface AnimatedPosition extends Position {
  isAnimating: boolean;
}

type StartOptions = { duration?: number; local?: boolean };

const DEFAULT_DURATION = 500;

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

type UseActorAnimationsOpts = {
  /** If provided, the hook will auto-animate when these positions change (remote updates). */
  autoSource?: {
    characters?: Character[] | null;
    entities?: Entity[] | null;
  };
};

/**
 * useActorAnimations
 * - startAnimation(): start a tween; pass { local: true } to suppress the next auto-animate
 * - getActorPosition(): returns interpolated (x,y,h) + isAnimating
 * - auto-animates remote moves if `opts.autoSource` is provided
 */
export function useActorAnimations(opts?: UseActorAnimationsOpts) {
  const [animations, setAnimations] = useState<Map<string, ActorAnimation>>(new Map());
  const animationsRef = useRef(animations);
  const rafRef = useRef<number>(0);

  // Snapshot of last-seen positions for auto-animate diffing
  const prevPositionsRef = useRef<Map<string, Position> | null>(null);
  // When we initiate an animation locally, skip the very next auto-animate for that actor id
  const suppressNextAutoRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    animationsRef.current = animations;
  }, [animations]);

  const startAnimation = useCallback(
    (
      actorId: string,
      from: Position,
      to: Position,
      options?: StartOptions
    ) => {
      const duration = options?.duration ?? DEFAULT_DURATION;

      if (options?.local) {
        suppressNextAutoRef.current.add(actorId);
      }

      setAnimations((prev) => {
        const next = new Map(prev);
        next.set(actorId, {
          actorId,
          from,
          to,
          startTime: typeof performance !== "undefined" ? performance.now() : Date.now(),
          duration,
        });
        return next;
      });
    },
    []
  );

  // Animation loop
  useEffect(() => {
    if (animations.size === 0) {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
      return;
    }

    const loop = () => {
      const now = (typeof performance !== "undefined" ? performance.now() : Date.now());
      const current = animationsRef.current;
      let hasChanges = false;

      const next = new Map(current);
      for (const [actorId, anim] of current) {
        const elapsed = now - anim.startTime;
        if (elapsed >= anim.duration) {
          next.delete(actorId);
          hasChanges = true;
        }
      }

      setAnimations(hasChanges ? next : new Map(next));

      if (next.size > 0) {
        rafRef.current = requestAnimationFrame(loop);
      }
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [animations.size]);

  const getActorPosition = useCallback(
    (actorId: string, actualPosition: Position): AnimatedPosition => {
      const anim = animations.get(actorId);
      if (!anim) return { ...actualPosition, isAnimating: false };

      const now = (typeof performance !== "undefined" ? performance.now() : Date.now());
      const elapsed = now - anim.startTime;
      const progress = Math.min(1, anim.duration ? elapsed / anim.duration : 1);
      const t = easeInOutCubic(progress);

      return {
        x: anim.from.x + (anim.to.x - anim.from.x) * t,
        y: anim.from.y + (anim.to.y - anim.from.y) * t,
        h: anim.from.h + (anim.to.h - anim.from.h) * t,
        isAnimating: true,
      };
    },
    [animations]
  );

  // -------------------- Auto-animate REMOTE updates --------------------
  useEffect(() => {
    const src = opts?.autoSource;
    if (!src) return;

    const chars = src.characters ?? [];
    const ents = src.entities ?? [];

    // Build current snapshot
    const next = new Map<string, Position>();
    for (const c of chars) {
      const p = c?.Position ?? { x: 0, y: 0, h: 0 };
      next.set(c.Id, { x: p.x, y: p.y, h: p.h ?? 0 });
    }
    for (const e of ents) {
      const p = (e as any)?.Position ?? { x: 0, y: 0, h: 0 };
      next.set(e.Id, { x: p.x, y: p.y, h: p.h ?? 0 });
    }

    // First run: seed & exit
    if (!prevPositionsRef.current) {
      prevPositionsRef.current = next;
      return;
    }

    const prev = prevPositionsRef.current;

    // Diff and animate
    for (const [id, toPos] of next) {
      const fromPos = prev.get(id);
      if (!fromPos) continue;

      const moved = (fromPos.x !== toPos.x) || (fromPos.y !== toPos.y) || (fromPos.h !== toPos.h);
      if (!moved) continue;

      // Skip one cycle if we already started this animation locally
      if (suppressNextAutoRef.current.delete(id)) {
        continue;
      }

      startAnimation(id, fromPos, toPos);
    }

    prevPositionsRef.current = next;
  }, [opts?.autoSource?.characters, opts?.autoSource?.entities, startAnimation]);

  return {
    startAnimation,
    getActorPosition,
    hasActiveAnimations: animations.size > 0,
  };
}
