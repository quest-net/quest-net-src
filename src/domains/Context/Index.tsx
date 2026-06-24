import { useState, useEffect } from "react";
import { useQuestContext } from "./ContextProvider";
import { contextStore } from "./contextStore";
import { useNavigate } from "react-router-dom";
import { UserUtils } from "../User/UserUtils";
import ASCIIText from "../../components/effects/ASCIIText";
import Waves from "../../components/effects/Waves";
import { useThemeColors } from "../../utils/ThemeUtils";
import TextType from "../../components/effects/TextType";
import { AppSettingUtils } from "../AppSetting/AppSettingUtils";
import { APP_VERSION } from "../../version";
import { useIsMobile } from "../../hooks/useIsMobile";
import { CloudBackupBanner } from "../../components/CloudBackupBanner";
export function Home() {
	const context = useQuestContext();
	const navigate = useNavigate();
	const [name, setName] = useState(context.User.Name || "Traveler");

	// keep local state in sync if context changes elsewhere
	useEffect(() => {
		setName(context.User.Name || "Traveler");
	}, [context.User.Name]);

	const colors = useThemeColors("neutral", "primary");
	const theme = AppSettingUtils.getTheme(context);
	const asciiTextColor = theme == "dark" ? "#fdf9f3" : colors.primary.hex;
	// On narrow screens the single-line "QUEST-NET" overflows; stack it and shrink slightly.
	const isNarrow = useIsMobile();

	const commitName = (value: string) => {
		const trimmed = value.trim();
		if (!trimmed) return;
		setName(trimmed);
		UserUtils.setName({ name: trimmed }, contextStore);
	};

	return (
		<div className="relative h-screen w-screen overflow-hidden bg-base-200">
			{/* Waves Background */}
			<div className="absolute inset-0">
				<Waves
					lineColor={colors.neutral.hex}
					backgroundColor="transparent"
					waveSpeedX={0.02}
					waveSpeedY={0.05}
				/>
			</div>
			<CloudBackupBanner />
			<div className="fixed top-3 right-3 z-50">
				<div className="flex flex-wrap justify-end gap-2">
					<button
						onClick={() => navigate("/wiki/")}
						className="btn btn-md btn-primary gap-2 shadow-md"
					>
						<span className="icon-[mdi--book-open-page-variant] w-4 h-4" />
						Wiki
					</button>
					<button
						onClick={() => navigate("/settings")}
						className="btn btn-md btn-neutral gap-2 shadow-md"
					>
						<span className="icon-[mdi--cog] w-4 h-4" />
						Settings
					</button>
				</div>
			</div>
			{/* Vertically Centered Content */}
			<div className="relative flex h-full flex-col items-center justify-center">
				{/* Welcome Message */}
				<div className="z-1 mb-40 mt-8 flex flex-row items-center gap-3">
					<h2 className="text-3xl font-bold">Welcome,</h2>

					<TextType
						as="span"
						className="text-3xl font-bold text-primary"
						text={name}
						loop={false}
						showCursor
						hideCursorWhileTyping={false}
						variableSpeed={{ min: 35, max: 65 }}
						initialDelay={250}
						// new editing behavior
						editableAfter
						editOnClick
						editAutoFocus={false}
						commitOnBlur
						editClassName="text-3xl font-bold px-1"
						cursorClassName="text-primary"
						onEditCommit={commitName}
						onEditCancel={() => { }}
						ariaLabelEditable="Edit your username"
						maxLength={24}
					/>
				</div>

				{/* ASCII Text Layer */}
				<div className="absolute inset-0">
					<ASCIIText
						text={isNarrow ? "QUEST\nNET" : "QUEST-NET"}
						enableWaves={false}
						asciiFontSize={isNarrow ? 10 : 12}
						planeBaseHeight={isNarrow ? 6 : 4}
						textColor={asciiTextColor}
					/>
				</div>

				{/* Campaign Button */}
				<button
					onClick={() => navigate("/campaigns")}
					className="z-1 mt-40 btn btn-primary btn-xl gap-2 shadow-lg transition-transform hover:scale-105"
				>
					<span className="icon-[game-icons--dice-twenty-faces-one] h-6 w-6" />
					Depart!
				</button>

				{/* Tiny hint */}
				<p className="z-1 mt-4 text-sm bg-base-100 rounded p-1">
					Tip: click your name to edit it. Press <kbd>Enter</kbd> to save or{" "}
					<kbd>Esc</kbd> to cancel.
				</p>
			</div>
			{/* Bottom-right version badge */}
			<div className="fixed bottom-3 right-3 z-50">
				<div
					className="badge badge-neutral gap-2 shadow-lg"
					role="status"
					aria-label={`App version ${APP_VERSION}`}
					title={`App version ${APP_VERSION}`}
				>
					<span className="icon-[material-symbols--line-end-diamond-outline-rounded] h-5 w-5" />
					{APP_VERSION}
				</div>
			</div>
		</div>
	);
}
