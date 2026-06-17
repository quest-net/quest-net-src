import { Link, useNavigate } from "react-router-dom";
import { ThemeToggle } from "../../components/ThemeToggle/ThemeToggle";

export function WikiHeader() {
	const navigate = useNavigate();

	return (
		<header className="sticky top-0 z-30 border-b border-base-300 bg-base-100/95 backdrop-blur">
			<div className="mx-auto flex max-w-[96rem] items-center gap-3 px-4 py-3">
				<button
					type="button"
					onClick={() => navigate("/")}
					className="btn btn-neutral btn-sm gap-2"
				>
					<span className="icon-[mdi--arrow-left] h-4 w-4" />
					Home
				</button>
				<Link to="/wiki/" className="btn btn-ghost btn-sm gap-2 text-lg">
					<span className="icon-[mdi--book-open-page-variant] h-5 w-5 text-primary" />
					Wiki
				</Link>
				<div className="ml-auto">
					<ThemeToggle size="sm" />
				</div>
			</div>
		</header>
	);
}
