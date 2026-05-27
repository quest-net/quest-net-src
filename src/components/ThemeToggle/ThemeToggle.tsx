import { AppSettingActions } from "../../domains/AppSetting/AppSettingActions";
import {
	triggerContextUpdate,
	useQuestContext,
} from "../../domains/Context/ContextProvider";

interface ThemeToggleProps {
	size?: "sm" | "md";
}

export function ThemeToggle({ size = "md" }: ThemeToggleProps) {
	const context = useQuestContext();
	const theme = AppSettingActions.getTheme(context);
	const isDark = theme === "dark";
	const nextTheme = isDark ? "light" : "dark";
	const sizeClass = size === "sm" ? "h-10 w-20" : "h-12 w-24";
	const knobClass = size === "sm" ? "h-8 w-8" : "h-10 w-10";
	const translateClass = size === "sm" ? "translate-x-10" : "translate-x-12";

	const handleToggle = () => {
		AppSettingActions.setTheme({ theme: nextTheme }, context);
		triggerContextUpdate();
	};

	return (
		<button
			type="button"
			onClick={handleToggle}
			className={`relative inline-flex ${sizeClass} shrink-0 items-center rounded-full border-2 border-base-300 bg-base-100 p-1 shadow-md transition-colors hover:border-primary`}
			aria-label={`Switch to ${nextTheme} mode`}
			title={`Switch to ${nextTheme} mode`}
		>
			<span className="absolute left-3 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center text-warning">
				<span className="icon-[line-md--sunny-outline-loop] h-5 w-5" />
			</span>
			<span className="absolute right-3 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center text-primary">
				<span className="icon-[line-md--moon-rising-alt-loop] h-5 w-5" />
			</span>
			<span
				className={`${knobClass} relative z-1 flex items-center justify-center rounded-full bg-neutral text-neutral-content shadow-lg transition-transform ${
					isDark ? translateClass : "translate-x-0"
				}`}
			>
				<span
					className={`${
						isDark
							? "icon-[line-md--moon-filled-alt-loop]"
							: "icon-[line-md--sunny-filled-loop]"
					} h-5 w-5`}
				/>
			</span>
		</button>
	);
}
