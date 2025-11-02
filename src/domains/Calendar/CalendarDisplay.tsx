// domains/Calendar/CalendarDisplay.tsx

import { useMemo, useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useQuestContext } from "../Context/ContextProvider";
import { CampaignActions } from "../Campaign/CampaignActions";
import { useActionService } from "../../services/Actions/ActionServiceProvider";
import { CalendarActions, resolveNames, ordinal } from "./CalendarActions";
import type { CalendarSettings } from "../CampaignSetting/CampaignSetting";

/**
 * Clean, centered display. Looks the same for DM & players.
 * – The date line is centered and minimal.
 * – DM can click inline tokens (weekday/day/month/year) to edit.
 * – A single lightweight panel floats over the UI (portal) and does not shift layout.
 */
export default function CalendarDisplay() {
  const context = useQuestContext();
  const { actionService } = useActionService();
  const campaign = CampaignActions.getActiveCampaign(context);
  const isDM = context.User.Role === "dm";
  const isInteractive = isDM && !!actionService;

  const cfg: CalendarSettings = CalendarActions.getConfig(context);
  const absolute = campaign.GameState.CalendarDay ?? 0;

  const { parts, monthName, dayName } = useMemo(
    () => resolveNames(absolute, cfg),
    [absolute, cfg]
  );

  const showWeeks = cfg.daysPerWeek > 0;
  const weekLabel = (cfg.weekLabel ?? "").trim() || "week";
  const monthLabel = (cfg.monthLabel ?? "").trim(); // may be empty to suppress months
  const yearLabel = (cfg.yearLabel ?? "").trim() || "Year";

  const monthsUnset = useMemo(() => {
    if (monthLabel) return false;
    if (!cfg.monthNames || cfg.monthNames.length === 0) return true;
    return cfg.monthNames.every((m) => !m || !m.trim());
  }, [cfg.monthNames, monthLabel]);

  // Rest state
  const remainingShortRests = campaign.GameState.RemainingShortRests ?? 0;
  const maxShortRests = campaign.Settings.RestSettings.shortRestsPerDay;

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------
  const clamp = (n: number, min: number, max: number) =>
    Math.max(min, Math.min(max, Math.trunc(n)));

  const setDate = (next: { year?: number; month?: number; day?: number }) => {
    if (!isInteractive || !actionService) return;
    const y = clamp(next.year ?? parts.year, 1, Number.MAX_SAFE_INTEGER);
    const m = clamp(next.month ?? parts.month, 1, cfg.monthsPerYear);
    const d = clamp(next.day ?? parts.day, 1, cfg.daysPerMonth);
    actionService.execute("calendar:setDate", { year: y, month: m, day: d });
  };

  const advance = (delta: { days?: number; weeks?: number; months?: number; years?: number }) => {
    if (!isInteractive || !actionService) return;
    actionService.execute("calendar:advance", delta);
  };

  const jumpToDayOfWeek = (targetIndex: number) => {
    if (!showWeeks || parts.dayOfWeekIndex == null) return;
    if (!isInteractive) return;
    const curr = parts.dayOfWeekIndex;
    const n = cfg.daysPerWeek;
    const forward = (targetIndex - curr + n) % n; // move forward to next chosen weekday
    if (forward !== 0) advance({ days: forward });
  };

  const handleShortRest = () => {
    if (!isInteractive || !actionService) return;
    actionService.execute("calendar:shortRest", {});
  };

  const handleLongRest = () => {
    if (!isInteractive || !actionService) return;
    actionService.execute("calendar:longRest", {});
  };

  // ---------------------------------------------------------------------------
  // UI state
  // ---------------------------------------------------------------------------
  type OpenKey = null | "dow" | "day" | "month" | "year";
  const [open, setOpen] = useState<OpenKey>(null);

  // Anchor element for the floating panel
  const anchorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Token styling (identical visuals; DM gains hover state)
  const tokenClass = (active: boolean) =>
    `inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md transition-colors ` +
    `${isInteractive ? "cursor-pointer hover:bg-primary/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary/40" : "cursor-default"} ` +
    `${active ? "bg-primary/10" : ""}`;

  return (
    <div className="text-center space-y-2 h-full place-content-center" ref={anchorRef}>
      {/* Title line */}
      <div className="text-2xl font-semibold tracking-wide">
        {showWeeks && (
          <button
            type="button"
            className={tokenClass(open === "dow")}
            onClick={() => isInteractive && setOpen(open === "dow" ? null : "dow")}
            disabled={!isInteractive}
            title={isInteractive ? "Set weekday" : undefined}
          >
            {dayName ?? `Day ${parts.day}`}
          </button>
        )}
        {showWeeks ? <span className="opacity-60">, </span> : <span className="opacity-60">The </span>}
        <button
          type="button"
          className={tokenClass(open === "day")}
          onClick={() => isInteractive && setOpen(open === "day" ? null : "day")}
          disabled={!isInteractive}
          title={isInteractive ? "Edit day of month" : undefined}
        >
          {ordinal(parts.day)}
        </button>
        {!monthsUnset && (
          <>
            <span className="opacity-70"> of </span>
            <button
              type="button"
              className={tokenClass(open === "month")}
              onClick={() => isInteractive && setOpen(open === "month" ? null : "month")}
              disabled={!isInteractive}
              title={isInteractive ? "Choose month" : undefined}
            >
              {monthName}
            </button>
          </>
        )}
      </div>

      {/* Underline accent */}
      <div className="h-1 mx-auto w-100 bg-linear-to-r from-transparent via-primary to-transparent" />

      {/* Secondary line (year) */}
      <div className="text-lg mb-0">
        {yearLabel}: {" "}
        <button
          type="button"
          className={tokenClass(open === "year")}
          onClick={() => isInteractive && setOpen(open === "year" ? null : "year")}
          disabled={!isInteractive}
          title={isInteractive ? `Edit ${yearLabel.toLowerCase()}` : undefined}
        >
          {parts.year}
        </button>
      </div>
	  {/* Optional subtle meta */}
      {showWeeks && (
        <div className="text-md">
          {weekLabel} {parts.weekOfMonth}
        </div>
      )}
      {/* Rest Buttons (DM only) */}
      {isInteractive && (
        <div className="flex items-center justify-center gap-3 mt-4">
          <button
            onClick={handleShortRest}
            disabled={remainingShortRests <= 0}
            className="btn btn-sm btn-outline gap-2"
            title={`Short rest (${remainingShortRests}/${maxShortRests} remaining)`}
          >
            <span className="icon-[mdi--sleep] w-5 h-5" />
            Short Rest
            <span className="badge badge-sm">{remainingShortRests}/{maxShortRests}</span>
          </button>
          <button
            onClick={handleLongRest}
            className="btn btn-sm btn-primary gap-2"
            title="Long rest (advances day)"
          >
            <span className="icon-[mdi--weather-night] w-5 h-5" />
            Long Rest
          </button>
        </div>
      )}
		{!isInteractive && (
        <div className="flex items-center justify-center gap-3 mt-4">
          <span className="badge badge-sm">{remainingShortRests}/{maxShortRests} short rests remaining today</span>
        </div>
      )}
      {/* Floating panel (portal) */}
      {open && isInteractive && (
        <FloatingPanel anchorEl={anchorRef.current} onClose={() => setOpen(null)}>
          <div className="flex items-center justify-between mb-2">
            <div className="font-medium flex items-center gap-2">
              <span className="icon-[mdi--tune] w-4 h-4" />
              {open === "dow" && "Set weekday"}
              {open === "day" && "Edit day of month"}
              {open === "month" && "Choose month"}
              {open === "year" && `Edit ${yearLabel.toLowerCase()}`}
            </div>
            <button className="btn btn-ghost btn-xs" onClick={() => setOpen(null)}>
              <span className="icon-[mdi--close] w-4 h-4" />
            </button>
          </div>

          {open === "dow" && showWeeks && (
            <div className="flex flex-wrap justify-center gap-2">
              {cfg.dayNames.map((dn, i) => (
                <button
                  key={i}
                  className={`btn btn-sm ${parts.dayOfWeekIndex === i ? "btn-primary" : "btn-outline"}`}
                  onClick={() => jumpToDayOfWeek(i)}
                >
                  {dn?.trim() ? dn : `Day ${i + 1}`}
                </button>
              ))}
            </div>
          )}

          {open === "day" && (
            <div className="flex items-center justify-center gap-2">
              <button className="btn btn-sm" onClick={() => setDate({ day: clamp(parts.day - 1, 1, cfg.daysPerMonth) })}>−</button>
              <input
                type="number"
                min={1}
                max={cfg.daysPerMonth}
                className="input input-bordered input-sm w-24 text-center"
                value={parts.day}
                onChange={(e) => setDate({ day: clamp(Number(e.target.value) || 1, 1, cfg.daysPerMonth) })}
              />
              <button className="btn btn-sm" onClick={() => setDate({ day: clamp(parts.day + 1, 1, cfg.daysPerMonth) })}>+</button>
            </div>
          )}

          {open === "month" && !monthsUnset && (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {cfg.monthNames.map((m, i) => (
                <button
                  key={i}
                  className={`btn btn-sm ${parts.month === i + 1 ? "btn-primary" : "btn-outline"}`}
                  onClick={() => setDate({ month: i + 1 })}
                >
                  {m?.trim() ? m : `Month ${i + 1}`}
                </button>
              ))}
            </div>
          )}

          {open === "year" && (
            <div className="flex items-center justify-center gap-2">
              <button className="btn btn-sm" onClick={() => setDate({ year: clamp(parts.year - 1, 1, Number.MAX_SAFE_INTEGER) })}>−</button>
              <input
                type="number"
                min={1}
                className="input input-bordered input-sm w-28 text-center"
                value={parts.year}
                onChange={(e) => setDate({ year: clamp(Number(e.target.value) || 1, 1, Number.MAX_SAFE_INTEGER) })}
              />
              <button className="btn btn-sm" onClick={() => setDate({ year: parts.year + 1 })}>+</button>
            </div>
          )}
        </FloatingPanel>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Floating Panel (portal)
// -----------------------------------------------------------------------------

function FloatingPanel({
  anchorEl,
  onClose,
  children,
}: {
  anchorEl: HTMLElement | null;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  useEffect(() => {
    const update = () => {
      const el = anchorEl;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const top = rect.bottom + 8; // 8px gap below the date line
      const left = rect.left + rect.width / 2;
      setPos({ top, left });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, { passive: true });
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update);
    };
  }, [anchorEl]);

  // Close when clicking outside (use a transparent backdrop)
  const Backdrop = (
    <div
      className="fixed inset-0 z-90"
      onClick={onClose}
      aria-hidden
    />
  );

  const Panel = (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      className="fixed z-100 w-[min(28rem,90vw)] rounded-xl border bg-base-100 p-3 shadow-xl ring-1 ring-black/5"
      style={{ top: pos.top, left: pos.left, transform: "translateX(-50%)" }}
      onClick={(e) => e.stopPropagation()}
    >
      {children}
    </div>
  );

  return createPortal(
    <>
      {Backdrop}
      {Panel}
    </>,
    document.body
  );
}