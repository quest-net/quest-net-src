import { useEffect, useRef, useState } from "react";
import {
	triggerContextUpdate,
	useQuestContext,
} from "../Context/ContextProvider";
import { AppSettingActions } from "./AppSettingActions";

export function AppSettingsDisplay() {
	const context = useQuestContext();
	const [isOpen, setIsOpen] = useState(false);
	const [theme, setTheme] = useState<"light" | "dark">(
		AppSettingActions.getTheme(context)
	);
	const [sfxVolumePercent, setSfxVolumePercent] = useState(
		Math.round(AppSettingActions.getSfxVolume() * 100)
	);
	const [preserveFlyingHeightOnTileMove, setPreserveFlyingHeightOnTileMove] =
		useState(AppSettingActions.getPreserveFlyingHeightOnTileMove(context));
	const [performanceMode, setPerformanceMode] = useState(
		AppSettingActions.getPerformanceMode(context)
	);
	const [performanceModeChanged, setPerformanceModeChanged] = useState(false);
	const windowRef = useRef<HTMLDivElement>(null);
	const buttonRef = useRef<HTMLButtonElement>(null);

	useEffect(() => {
		setTheme(AppSettingActions.getTheme(context));
		setPreserveFlyingHeightOnTileMove(
			AppSettingActions.getPreserveFlyingHeightOnTileMove(context)
		);
		setPerformanceMode(AppSettingActions.getPerformanceMode(context));
	}, [context]);

	useEffect(() => {
		if (!isOpen) return;

		setSfxVolumePercent(Math.round(AppSettingActions.getSfxVolume() * 100));

		const handleClickOutside = (event: MouseEvent) => {
			if (
				windowRef.current &&
				buttonRef.current &&
				!windowRef.current.contains(event.target as Node) &&
				!buttonRef.current.contains(event.target as Node)
			) {
				setIsOpen(false);
			}
		};

		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				setIsOpen(false);
			}
		};

		document.addEventListener("mousedown", handleClickOutside);
		document.addEventListener("keydown", handleKeyDown);
		return () => {
			document.removeEventListener("mousedown", handleClickOutside);
			document.removeEventListener("keydown", handleKeyDown);
		};
	}, [isOpen]);

	const handleThemeChange = (nextTheme: "light" | "dark") => {
		setTheme(nextTheme);
		AppSettingActions.setTheme({ theme: nextTheme }, context);
		triggerContextUpdate();
	};

	const handleSfxVolumeChange = (nextVolumePercent: number) => {
		const clampedVolumePercent = Math.max(
			0,
			Math.min(100, Math.round(nextVolumePercent))
		);
		setSfxVolumePercent(clampedVolumePercent);
		AppSettingActions.setSfxVolume({
			volume: clampedVolumePercent / 100,
		});
	};

	const handlePreserveFlyingHeightChange = (preserve: boolean) => {
		setPreserveFlyingHeightOnTileMove(preserve);
		AppSettingActions.setPreserveFlyingHeightOnTileMove(
			{ preserve },
			context
		);
		triggerContextUpdate();
	};

	const handlePerformanceModeChange = (enabled: boolean) => {
		setPerformanceMode(enabled);
		setPerformanceModeChanged(true);
		AppSettingActions.setPerformanceMode({ enabled }, context);
		triggerContextUpdate();
	};

	return (
		<div className="relative">
			<button
				ref={buttonRef}
				type="button"
				className={`btn btn-sm gap-2 ${isOpen ? "btn-primary" : "btn-neutral"}`}
				onClick={() => setIsOpen(!isOpen)}
				title="App settings"
				aria-label="App settings"
			>
				<span className="icon-[mdi--cog] w-5 h-5" />
			</button>

			{isOpen && (
				<div
					ref={windowRef}
					className="absolute top-full left-0 mt-2 w-80 bg-base-100 border-2 border-base-300 rounded-lg shadow-xl z-50"
				>
					<div className="p-4 space-y-4">
						<div className="flex items-center justify-between">
							<h3 className="font-bold text-lg">App Settings</h3>
							<button
								type="button"
								className="btn btn-ghost btn-xs btn-circle"
								onClick={() => setIsOpen(false)}
								title="Close"
								aria-label="Close app settings"
							>
								<span className="icon-[mdi--close] w-4 h-4" />
							</button>
						</div>

						<div className="space-y-2">
							<label className="font-medium">Theme</label>
							<div className="join w-full">
								<button
									type="button"
									className={`btn btn-sm join-item flex-1 ${
										theme === "light" ? "btn-active btn-primary" : ""
									}`}
									onClick={() => handleThemeChange("light")}
								>
									<span className="icon-[mdi--white-balance-sunny] w-4 h-4" />
									Light
								</button>
								<button
									type="button"
									className={`btn btn-sm join-item flex-1 ${
										theme === "dark" ? "btn-active btn-primary" : ""
									}`}
									onClick={() => handleThemeChange("dark")}
								>
									<span className="icon-[mdi--weather-night] w-4 h-4" />
									Dark
								</button>
							</div>
						</div>

						<div className="space-y-2">
							<div className="flex items-center justify-between gap-3">
								<label className="font-medium">Sound Effects</label>
								<span className="text-sm opacity-70">{sfxVolumePercent}%</span>
							</div>
							<input
								type="range"
								min={0}
								max={100}
								value={sfxVolumePercent}
								onChange={(event) =>
									handleSfxVolumeChange(Number(event.target.value) || 0)
								}
								className="range range-secondary range-sm"
								aria-label="Sound effects volume"
							/>
						</div>

						<div className="flex items-center justify-between gap-4">
							<div className="flex items-center gap-2">
								<span className="icon-[mdi--feather] w-5 h-5 opacity-70" />
								<span className="font-medium">Keep Flying Height</span>
							</div>
							<input
								type="checkbox"
								className="toggle toggle-primary toggle-sm"
								checked={preserveFlyingHeightOnTileMove}
								onChange={(event) =>
									handlePreserveFlyingHeightChange(event.target.checked)
								}
								aria-label="Keep flying height"
							/>
						</div>

						<div className="space-y-1">
							<div className="flex items-center justify-between gap-4">
								<div className="flex items-center gap-2">
									<span className="icon-[mdi--speedometer] w-5 h-5 opacity-70" />
									<span className="font-medium">Performance Mode</span>
								</div>
								<input
									type="checkbox"
									className="toggle toggle-primary toggle-sm"
									checked={performanceMode}
									onChange={(event) =>
										handlePerformanceModeChange(event.target.checked)
									}
									aria-label="Performance mode"
								/>
							</div>
							{performanceModeChanged && (
								<p className="text-xs text-warning">
									your mode has changed. please refresh to apply
								</p>
							)}
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
