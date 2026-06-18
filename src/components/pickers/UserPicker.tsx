// components/pickers/UserPicker.tsx

import { ReactNode, useState } from "react";
import { usePeerTracking } from "../../hooks/usePeerTracking";

/**
 * Sentinel id representing "no owner" — i.e. an image that lives in the shared
 * DM library rather than belonging to a specific player. Callers map this back
 * to `undefined` before persisting to `Image.UploadedBy`.
 */
export const UNASSIGNED_OWNER_ID = "__unassigned__";

/**
 * Minimal shape needed to render a user in the picker.
 */
export interface PickableUser {
	Id: string;
	Name: string;
	/** Sublabel shown under the name, e.g. "Connected" or "12 images". */
	Description?: string;
}

interface UserMenuProps {
	users: PickableUser[];
	onSelect: (userId: string) => void;
	/** Highlights the currently-selected user with a check. */
	currentId?: string;
	title?: string;
	emptyText?: string;
}

/**
 * Floating list of users, styled as a DaisyUI dropdown menu. Rendered inside a
 * `dropdown-content` either by `UserPicker` (which supplies its own trigger) or
 * by a caller that owns the trigger (e.g. IndexView's selection toolbar).
 */
export function UserMenu({
	users,
	onSelect,
	currentId,
	title,
	emptyText = "No users available",
}: UserMenuProps) {
	const [query, setQuery] = useState("");

	const filtered = query.trim()
		? users.filter(
				(u) =>
					u.Name.toLowerCase().includes(query.toLowerCase()) ||
					u.Id.toLowerCase().includes(query.toLowerCase())
		  )
		: users;

	return (
		<div className="card bg-base-100 shadow-lg border border-base-300 w-64">
			{title && (
				<div className="px-3 pt-2 text-xs font-semibold opacity-70">{title}</div>
			)}
			{users.length > 6 && (
				<div className="px-2 pt-2">
					<input
						type="text"
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						placeholder="Search users..."
						className="input input-bordered input-sm w-full"
					/>
				</div>
			)}
			<ul className="menu w-full p-2 flex-nowrap max-h-64 overflow-y-auto">
				{filtered.length === 0 ? (
					<li className="menu-disabled">
						<span className="text-sm opacity-70">{emptyText}</span>
					</li>
				) : (
					filtered.map((user) => (
						<li key={user.Id} className="w-full">
							<a
								onClick={() => onSelect(user.Id)}
								className={`w-full ${
									currentId === user.Id ? "menu-active" : ""
								}`}
							>
								<span className="icon-[mdi--account] w-4 h-4 shrink-0" />
								<div className="flex flex-col min-w-0 flex-1">
									<span className="truncate">{user.Name}</span>
									{user.Description && (
										<span className="text-xs opacity-70 truncate">
											{user.Description}
										</span>
									)}
								</div>
								{currentId === user.Id && (
									<span className="icon-[mdi--check] w-4 h-4 ml-auto shrink-0" />
								)}
							</a>
						</li>
					))
				)}
			</ul>
		</div>
	);
}

interface UserPickerProps {
	users: PickableUser[];
	onSelect: (userId: string) => void;
	currentId?: string;
	/** Trigger button content. Defaults to "Change Owner". */
	buttonLabel?: ReactNode;
	buttonClassName?: string;
	/** Dropdown alignment relative to the trigger. */
	align?: "start" | "end";
	title?: string;
	disabled?: boolean;
}

/**
 * Self-contained user picker: a trigger button that opens a floating UserMenu.
 * Used in forms (e.g. the image edit owner field). For the bulk/selection case,
 * callers render their own trigger and drop a `UserMenu` into the menu slot.
 */
export function UserPicker({
	users,
	onSelect,
	currentId,
	buttonLabel = "Change Owner",
	buttonClassName = "btn btn-sm",
	align = "end",
	title,
	disabled,
}: UserPickerProps) {
	if (disabled) {
		return (
			<button type="button" className={buttonClassName} disabled>
				{buttonLabel}
			</button>
		);
	}

	const handleSelect = (userId: string) => {
		onSelect(userId);
		// Collapse the dropdown by blurring the focused element (DaisyUI pattern).
		(document.activeElement as HTMLElement | null)?.blur();
	};

	return (
		<div className={`dropdown ${align === "end" ? "dropdown-end" : ""}`}>
			<label tabIndex={0} className={buttonClassName}>
				{buttonLabel}
			</label>
			<div tabIndex={0} className="dropdown-content z-50 mt-1">
				<UserMenu
					users={users}
					onSelect={handleSelect}
					currentId={currentId}
					title={title}
				/>
			</div>
		</div>
	);
}

/**
 * Connected users (self + remote peers) as picker candidates, deduped by Id.
 * This is the natural target set when reassigning ownership: the returning
 * player is connected on their new machine, so the DM can pick them directly
 * without ever needing to know their old (stale) user id.
 *
 * Pass `excludeSelf` to drop the local user — useful for "pick someone else"
 * pickers (e.g. ownership reassignment, where the DM's own entry would be
 * redundant with the shared "DM Library" option).
 */
export function useConnectedUsers(options?: {
	excludeSelf?: boolean;
}): PickableUser[] {
	const { peers, selfPeer } = usePeerTracking();

	const list: PickableUser[] = [];
	const seen = new Set<string>();

	const add = (id: string | undefined, name: string | undefined, sub: string) => {
		if (!id || seen.has(id)) return;
		seen.add(id);
		list.push({ Id: id, Name: name || "Unnamed user", Description: sub });
	};

	if (!options?.excludeSelf) {
		add(
			selfPeer.user?.Id,
			selfPeer.user?.Name,
			selfPeer.user?.Role === "dm" ? "You (DM)" : "You"
		);
	}
	peers.forEach((p) =>
		add(p.user?.Id, p.user?.Name, p.user?.Role === "dm" ? "DM" : "Connected")
	);

	return list;
}
