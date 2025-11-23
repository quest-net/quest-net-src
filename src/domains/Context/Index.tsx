import { useState, useEffect } from "react";
import { useQuestContext, triggerContextUpdate } from "./ContextProvider";
import { useNavigate } from "react-router-dom";
import { UserActions } from "../User/UserActions";
import ASCIIText from "../../components/ASCIIText/ASCIIText";
import Waves from "../../components/Waves/Waves";
import { useThemeColors } from "../../utils/ThemeUtils";
import TextType from "../../components/TextType/TextType";
import { AppSettingActions } from "../AppSetting/AppSettingActions";
const APP_VERSION = "v1.0.4";
export function Home() {
	const context = useQuestContext();
	const navigate = useNavigate();
	const [name, setName] = useState(context.User.Name || "Traveler");

	// keep local state in sync if context changes elsewhere
	useEffect(() => {
		setName(context.User.Name || "Traveler");
	}, [context.User.Name]);

	const colors = useThemeColors("neutral", "primary");
	const theme = AppSettingActions.getTheme(context);
	const asciiTextColor = theme == "dark" ? "#fdf9f3" : colors.primary.hex;

	const commitName = (value: string) => {
		const trimmed = value.trim();
		if (!trimmed) return;
		setName(trimmed);
		UserActions.setName({ name: trimmed }, context);
		triggerContextUpdate();
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
			<div className="fixed top-3 right-3 z-50">
				<button
				onClick={() => navigate("/settings")}
				className="btn btn-md btn- gap-2 shadow-md"
				>
				<span className="icon-[mdi--cog] w-4 h-4" />
				Settings
				</button>
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
						onEditCancel={() => {}}
						ariaLabelEditable="Edit your username"
						maxLength={24}
					/>
				</div>

				{/* ASCII Text Layer */}
				<div className="absolute inset-0">
					<ASCIIText
						text="QUEST-NET"
						enableWaves={false}
						asciiFontSize={12}
						planeBaseHeight={4}
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
