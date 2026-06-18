// domains/Log/CritSplash.tsx
//
// Over-the-top, Persona-5-style critical cut-in. Watches the activity log for
// fresh natural crits (same detection LogAlerts uses) and, for each one the
// current viewer can see, plays a full-screen GSAP sequence:
//
//   - the rolling actor's portrait crashes in from the left while scaling up
//   - their crit message ("train") crashes in, screen-shakes, drifts in the
//     center, then scrolls off to the left
//   - the actor-name chip rides a parallax lane
//   - a token-colored backdrop with a scrolling ✦ starfield washes the screen
//
// The backdrop wash derives from the actor's token color; the text ink is
// forced light (white fill, black outline) per the approved design.
//
// Tuning lives in CONFIG below (dialed in via the standalone playground). The
// overlay is pointer-events:none, so it never blocks the game underneath.

import { useEffect, useRef, useState } from "react";
import { gsap } from "gsap";
import { useQuestContext } from "../Context/ContextProvider";
import { useActionService } from "../../services/Actions/ActionServiceProvider";
import { CampaignUtils } from "../Campaign/CampaignUtils";
import { LogUtils } from "./LogUtils";
import { LogEntry } from "./Log";
import { isCritRoll, getCritRollValue } from "../../utils/DiceUtils";
import { AppSettingUtils } from "../AppSetting/AppSettingUtils";
import { loadImageBlob } from "../Image/ImageLoading";
import { Campaign } from "../Campaign/Campaign";
import "./CritSplash.css";

// Only surface crits from the last few seconds (mirrors LogAlerts) so opening a
// campaign doesn't replay historical crits.
const MAX_ALERT_AGE = 10000;

// --- tuned constants (from the playground) ---------------------------------
const CONFIG = {
	skew: -15, // backdrop diagonal
	portrait: { dur: 0.55, ease: "expo.out", from: -160, rot: -10, grow: 1.18 },
	// message "train": crash in, hold/drift in center, exit left
	msg: { entryDur: 0.25, holdDur: 2.6, crashTo: 0.45, drift: 100, shake: 28 },
	nameDrift: 2.2, // name-lane drift relative to the message
	// giant roll-value stamp that slams in on the impact beat
	stamp: { scaleIn: 2.6, rotIn: -12, rotRest: -6, inDur: 0.28 },
	stars: { speed: 3, dir: 160, opacity: 0.6 },
	exit: 0.4,
};

// Approved design forces light ink (white fill, black outline + ✦) over the
// token-colored backdrop — regardless of the token's own luminance.
const INK = "#ffffff";
const INK_STROKE = "#000000";

// scattered ✦ tile so tiling doesn't read as a grid
const STAR_TILE = 280;
const STAR_SPOTS: [number, number, number, number][] = [
	[44, 58, 26, 0.95], [156, 30, 15, 0.6], [212, 120, 30, 1.0],
	[92, 168, 18, 0.7], [250, 224, 21, 0.85], [28, 232, 13, 0.5], [180, 198, 12, 0.55],
];

interface CritEvent {
	id: string;
	message: string;
	name: string;
	imageId?: string;
	color: string;
	rollValue: number; // the natural die that triggered the crit (20 or 100)
}

function starUri(color: string): string {
	const glyphs = STAR_SPOTS.map(
		([x, y, fs, op]) =>
			`<text x='${x}' y='${y}' font-size='${fs}' text-anchor='middle' dominant-baseline='central' fill='${color}' fill-opacity='${op}'>✦</text>`
	).join("");
	const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${STAR_TILE}' height='${STAR_TILE}'>${glyphs}</svg>`;
	return 'url("data:image/svg+xml;utf8,' + encodeURIComponent(svg) + '")';
}

// Resolve the rolling actor from any live or template pool, for name/image/color.
function resolveActor(campaign: Campaign, actorId: string) {
	const pools = [
		campaign.GameState.Characters,
		campaign.GameState.Entities,
		campaign.CharacterRoster,
		campaign.EntityTemplates,
	];
	for (const pool of pools) {
		const found = pool.find((a) => a.Id === actorId);
		if (found) return found;
	}
	return null;
}

function toCritEvent(entry: LogEntry, campaign: Campaign): CritEvent {
	const actor = entry.ActorId ? resolveActor(campaign, entry.ActorId) : null;
	const message = ((actor as any)?.CritMessage as string | undefined) || "CRITICAL!";
	return {
		id: entry.Id,
		message,
		name: actor?.Name || "",
		imageId: actor?.Image,
		color: actor?.Color || "#38468a",
		rollValue: getCritRollValue(entry) ?? 20,
	};
}

/**
 * Runs the full GSAP sequence on the pre-rendered overlay. Returns a handle so
 * the caller can kill it on unmount/cancel. Text content + the portrait <img>
 * must already be set on the DOM before calling.
 */
function playTimeline(
	container: HTMLDivElement,
	event: CritEvent,
	hasPortrait: boolean,
	reduced: boolean,
	onDone: () => void
) {
	const q = gsap.utils.selector(container);
	const message = q(".crit-message")[0] as HTMLElement;
	const name = q(".crit-name")[0] as HTMLElement;
	const portraitWrap = q(".crit-portrait-wrap")[0] as HTMLElement;
	const band = q(".crit-band")[0] as HTMLElement;
	const flash = q(".crit-flash")[0] as HTMLElement;
	const scrim = q(".crit-scrim")[0] as HTMLElement;
	const halftone = q(".crit-halftone")[0] as HTMLElement;
	const vignette = q(".crit-vignette")[0] as HTMLElement;
	const starsFar = q(".crit-stars.far")[0] as HTMLElement;
	const starsNear = q(".crit-stars.near")[0] as HTMLElement;
	const stamp = q(".crit-stamp-num")[0] as HTMLElement;

	// theme: token color washes the backdrop; ink is forced light (approved design)
	container.style.setProperty("--crit-accent", event.color);
	container.style.setProperty("--crit-ink", INK);
	container.style.setProperty("--crit-stroke", INK_STROKE);
	container.style.setProperty("--crit-skew", CONFIG.skew + "deg");
	const uri = starUri(INK);
	starsFar.style.backgroundImage = uri;
	starsNear.style.backgroundImage = uri;

	name.style.display = event.name ? "inline-block" : "none";
	portraitWrap.style.display = hasPortrait ? "flex" : "none";

	container.style.visibility = "visible";
	gsap.set(container, { x: 0, y: 0, rotation: 0 });

	// measure for centering / crossing (layout is live)
	const stageW = container.clientWidth || window.innerWidth;
	const pad = 90;
	message.style.maxWidth = Math.round(stageW * 0.72) + "px";
	const mW = message.offsetWidth, nW = name.offsetWidth;
	const mStartX = stageW + pad, mEndX = -(mW + pad);
	const nStartX = stageW + pad, nEndX = -(nW + pad);
	const mRestX = mStartX + (mEndX - mStartX) * CONFIG.msg.crashTo;
	const nRestX = nStartX + (nEndX - nStartX) * CONFIG.msg.crashTo;

	const starTweens: ReturnType<typeof gsap.to>[] = [];
	const cleanup = () => starTweens.forEach((t) => t.kill());
	const finish = () => {
		container.style.visibility = "hidden";
		cleanup();
		onDone();
	};

	// ---- reduced motion: quiet static card, gentle fade ----
	if (reduced) {
		gsap.set([starsFar, starsNear], { opacity: 0 });
		gsap.set(band, { xPercent: 0, opacity: 0.9 });
		gsap.set(scrim, { opacity: 1 });
		gsap.set(message, { x: mRestX });
		gsap.set(name, { x: nRestX });
		gsap.set(portraitWrap, { xPercent: 0, rotation: 0, opacity: 1, scale: 1 });
		gsap.set(stamp, { opacity: 1, scale: 1, rotation: CONFIG.stamp.rotRest });
		const tl = gsap.timeline({ onComplete: finish });
		tl.fromTo(container, { opacity: 0 }, { opacity: 1, duration: 0.3 });
		tl.to(container, { opacity: 0, duration: 0.4 }, "+=2.2");
		return { kill: () => { tl.kill(); cleanup(); } };
	}

	// ---- full sequence ----
	gsap.set(message, { x: mStartX });
	gsap.set(name, { x: nStartX });
	gsap.set(starsFar, { backgroundPosition: `${Math.random() * STAR_TILE}px ${Math.random() * STAR_TILE}px` });
	gsap.set(starsNear, { backgroundPosition: `${Math.random() * 400}px ${Math.random() * 400}px` });

	// infinite parallax star scroll (different angles -> breaks the lattice)
	const dist = 4000 * CONFIG.stars.speed, sdur = 60 / CONFIG.stars.speed;
	const mkStar = (el: HTMLElement, mult: number, dirDeg: number) => {
		const rad = (dirDeg * Math.PI) / 180;
		return gsap.to(el, {
			backgroundPositionX: `+=${Math.cos(rad) * dist * mult}`,
			backgroundPositionY: `+=${Math.sin(rad) * dist * mult}`,
			duration: sdur, ease: "none", repeat: -1,
		});
	};
	starTweens.push(mkStar(starsFar, 0.55, CONFIG.stars.dir + 16), mkStar(starsNear, 1, CONFIG.stars.dir));

	const t0 = 0.1;
	const { entryDur, holdDur, drift, shake } = CONFIG.msg;
	const exitDur = CONFIG.exit;
	const exitStart = t0 + entryDur + holdDur;
	const land = t0 + entryDur; // the impact beat (crash lands)

	// giant roll-value stamp starts hidden + oversized; slams in on impact
	gsap.set(stamp, { opacity: 0, scale: CONFIG.stamp.scaleIn, rotation: CONFIG.stamp.rotIn });

	const tl = gsap.timeline({ onComplete: finish });
	const rand = (a: number) => (Math.random() * 2 - 1) * a;

	// beat 0: scrim + backdrop wipe + flash
	tl.fromTo(scrim, { opacity: 0 }, { opacity: 1, duration: 0.12 }, 0);
	tl.fromTo(band, { xPercent: -25, opacity: 0 }, { xPercent: 0, opacity: 0.9, duration: 0.4, ease: "power3.out" }, 0);
	tl.fromTo(starsFar, { opacity: 0 }, { opacity: CONFIG.stars.opacity * 0.5, duration: 0.5 }, 0.05);
	tl.fromTo(starsNear, { opacity: 0 }, { opacity: CONFIG.stars.opacity, duration: 0.5 }, 0.05);
	tl.fromTo(flash, { opacity: 0.85 }, { opacity: 0, duration: 0.3, ease: "power2.out" }, 0.05);
	gsap.set(halftone, { opacity: 0.4 });
	gsap.set(vignette, { opacity: 1 });

	// portrait: slide in AND grow as one unified motion, then exit on cue
	if (hasPortrait) {
		tl.fromTo(portraitWrap,
			{ xPercent: CONFIG.portrait.from, rotation: CONFIG.portrait.rot, opacity: 0 },
			{ xPercent: 0, rotation: 0, opacity: 1, duration: CONFIG.portrait.dur, ease: CONFIG.portrait.ease }, t0);
		tl.fromTo(portraitWrap, { scale: 1 }, { scale: CONFIG.portrait.grow, duration: exitStart - t0, ease: "power1.out" }, t0);
		tl.to(portraitWrap, { xPercent: CONFIG.portrait.from, opacity: 0, duration: exitDur, ease: "power3.in" }, exitStart);
	}

	// message TRAIN: crash -> slow centered drift -> exit (all in sync)
	tl.to(message, { x: mRestX, duration: entryDur, ease: "expo.out" }, t0);
	tl.to(message, { x: mRestX - drift, duration: holdDur, ease: "none" }, t0 + entryDur);
	tl.to(message, { x: mEndX, duration: exitDur, ease: "power3.in" }, exitStart);

	// name lane: same phases, drift scaled for a touch of parallax
	const nDrift = drift * CONFIG.nameDrift;
	tl.to(name, { x: nRestX, duration: entryDur, ease: "expo.out" }, t0);
	tl.to(name, { x: nRestX - nDrift, duration: holdDur, ease: "none" }, t0 + entryDur);
	tl.to(name, { x: nEndX, duration: exitDur, ease: "power3.in" }, exitStart);

	// giant roll-value stamp slams in on impact, then exits with everything
	tl.to(stamp, { opacity: 1, scale: 1, rotation: CONFIG.stamp.rotRest, duration: CONFIG.stamp.inDur, ease: "back.out(2)" }, land);
	tl.to(stamp, { opacity: 0, scale: 1.3, duration: exitDur, ease: "power2.in" }, exitStart);

	// impact shake (all axes) the instant the train crashes in
	if (shake > 0) {
		const shakeTl = gsap.timeline();
		for (let i = 0; i < 7; i++) {
			const falloff = 1 - i / 7;
			shakeTl.to(container, { x: rand(shake * falloff), y: rand(shake * falloff), rotation: rand(shake * falloff * 0.12), duration: 0.04, ease: "none" });
		}
		shakeTl.to(container, { x: 0, y: 0, rotation: 0, duration: 0.06, ease: "power2.out" });
		tl.add(shakeTl, land);
	}

	// backdrop fade: same cue as every exit
	tl.to([band, starsFar, starsNear, scrim, halftone, vignette], { opacity: 0, duration: exitDur, ease: "power2.in" }, exitStart);

	return { kill: () => { tl.kill(); cleanup(); } };
}

export function CritSplash() {
	const context = useQuestContext();
	const { actionService } = useActionService();
	const campaign = CampaignUtils.getActiveCampaign(context);
	const userRole = context.User.Role;
	const isDM = userRole === "dm";
	const splashEnabled = AppSettingUtils.getCritSplashEnabled(context);

	const containerRef = useRef<HTMLDivElement>(null);
	const processedRef = useRef<Set<string>>(new Set());
	const [queue, setQueue] = useState<CritEvent[]>([]);
	const [current, setCurrent] = useState<CritEvent | null>(null);

	// watch the log for fresh, visible crits -> enqueue
	useEffect(() => {
		const now = Date.now();
		const chronological = LogUtils.getChronologicalLog(campaign);
		const fresh = chronological.filter(
			(e) =>
				isCritRoll(e) &&
				e.ActorId &&
				now - e.Timestamp < MAX_ALERT_AGE &&
				!processedRef.current.has(e.Id) &&
				LogUtils.canUserSeeEntry(e, userRole)
		);
		if (fresh.length === 0) return;
		// Always mark as processed so toggling the splash on later doesn't replay
		// these crits; when disabled, LogAlerts surfaces them as toasts instead.
		fresh.forEach((e) => processedRef.current.add(e.Id));
		if (!splashEnabled) return;
		setQueue((q) => [...q, ...fresh.map((e) => toCritEvent(e, campaign))]);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [campaign.Log, campaign.LogHead, campaign.Log.length, userRole, splashEnabled]);

	// dequeue when idle
	useEffect(() => {
		if (current || queue.length === 0) return;
		setCurrent(queue[0]);
		setQueue((q) => q.slice(1));
	}, [current, queue]);

	// play the current crit
	useEffect(() => {
		if (!current || !containerRef.current) return;
		const container = containerRef.current;
		const reduced =
			typeof window !== "undefined" &&
			window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

		let cancelled = false;
		let objectUrl: string | null = null;
		let handle: { kill: () => void } | null = null;

		const run = async () => {
			let url: string | null = null;
			if (current.imageId) {
				try {
					const blob = await loadImageBlob(current.imageId, {
						isDM,
						imageService: (actionService as any)?.imageService,
					});
					if (blob && !cancelled) {
						objectUrl = URL.createObjectURL(blob);
						url = objectUrl;
					}
				} catch {
					/* fall through to no-portrait */
				}
			}
			// Crop the bottom of very tall portraits (taller than 3:4) so they
			// don't render as a thin sliver.
			let cropTall = false;
			if (url) {
				try {
					const probe = new Image();
					probe.src = url;
					await probe.decode();
					cropTall = probe.naturalWidth > 0 && probe.naturalHeight / probe.naturalWidth > 4 / 3;
				} catch {
					/* keep default contain fit */
				}
			}
			if (cancelled) return;

			// set the portrait <img> imperatively so it's in the DOM before play
			const img = container.querySelector(".crit-portrait") as HTMLImageElement | null;
			if (img) {
				img.src = url || "";
				img.classList.toggle("crop-tall", cropTall);
			}

			handle = playTimeline(container, current, !!url, !!reduced, () => {
				if (!cancelled) setCurrent(null);
			});
		};
		run();

		return () => {
			cancelled = true;
			handle?.kill();
			container.style.visibility = "hidden";
			if (objectUrl) URL.revokeObjectURL(objectUrl);
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [current]);

	return (
		<div ref={containerRef} className="crit-splash" aria-hidden="true">
			<div className="crit-scrim" />
			<div className="crit-band" />
			<div className="crit-stars far" />
			<div className="crit-stars near" />
			<div className="crit-halftone" />
			<div className="crit-vignette" />
			<div className="crit-flash" />

			{/* giant roll value — behind the portrait + text */}
			<div className="crit-stamp">
				<span className="crit-stamp-num">{current?.rollValue}</span>
			</div>

			<div className="crit-portrait-wrap">
				<img className="crit-portrait" alt="" />
			</div>

			<div className="crit-msg-layer">
				<div className="crit-track msg">
					<span className="crit-message">{current?.message}</span>
				</div>
				<div className="crit-track name">
					<span className="crit-name">{current?.name}</span>
				</div>
			</div>
		</div>
	);
}
