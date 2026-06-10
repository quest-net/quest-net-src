// domains/Note/NoteDisplay.tsx

import { useState, useEffect } from "react";
import { useQuestContext } from "../Context/ContextProvider";
import { useActionService } from "../../services/Actions/ActionServiceProvider";
import { CampaignActions } from "../Campaign/CampaignActions";
import { Note } from "./Note";
import { EmptyState } from "../../components/ui/EmptyState";

export function NoteDisplay() {
	const context = useQuestContext();
	const { actionService } = useActionService();
	const campaign = CampaignActions.getActiveCampaign(context);

	const [searchQuery, setSearchQuery] = useState("");
	const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
	const [editTitle, setEditTitle] = useState("");
	const [editContent, setEditContent] = useState("");
	const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
	const [isCreatingNew, setIsCreatingNew] = useState(false);

	// Get the player's selected character
	const selectedCharacterId =
		context.User.SelectedCharacters[campaign.RoomCode];
	const character = selectedCharacterId
		? campaign.GameState.Characters.find((c) => c.Id === selectedCharacterId)
		: null;

	// Reset pending delete after 3 seconds
	useEffect(() => {
		if (pendingDeleteId) {
			const timer = setTimeout(() => {
				setPendingDeleteId(null);
			}, 3000);
			return () => clearTimeout(timer);
		}
	}, [pendingDeleteId]);

	if (!character) {
		return <EmptyState>No character selected</EmptyState>;
	}

	const notes = character.Notes || [];

	// Filter notes by search query
	const filteredNotes = searchQuery
		? notes.filter(
				(note) =>
					note.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
					note.content?.toLowerCase().includes(searchQuery.toLowerCase())
		  )
		: notes;

	const handleCreateNew = () => {
		setIsCreatingNew(true);
		setEditTitle("");
		setEditContent("");
		setEditingNoteId(null);
		setSearchQuery("");
	};

	const handleSaveNew = () => {
		if (!actionService) return;

		actionService.execute("note:create", {
			characterId: character.Id,
			note: {
				title: editTitle || "Untitled Note",
				content: editContent,
			},
		});

		setIsCreatingNew(false);
		setEditTitle("");
		setEditContent("");
	};

	const handleCancelNew = () => {
		setIsCreatingNew(false);
		setEditTitle("");
		setEditContent("");
	};

	const handleOpenNote = (note: Note) => {
		setEditingNoteId(note.Id);
		setEditTitle(note.title);
		setEditContent(note.content || "");
		setIsCreatingNew(false);
		setSearchQuery("");
	};

	const handleSaveEdit = () => {
		if (!actionService || !editingNoteId) return;

		actionService.execute("note:edit", {
			characterId: character.Id,
			noteId: editingNoteId,
			updates: {
				title: editTitle,
				content: editContent,
			},
		});

		setEditingNoteId(null);
	};

	const handleCancelEdit = () => {
		setEditingNoteId(null);
		setEditTitle("");
		setEditContent("");
	};

	const handleDeleteClick = (noteId: string) => {
		if (pendingDeleteId === noteId) {
			// Second click - actually delete
			if (!actionService) return;

			actionService.execute("note:delete", {
				characterId: character.Id,
				noteId,
			});

			setPendingDeleteId(null);
			setEditingNoteId(null);
		} else {
			// First click - set pending
			setPendingDeleteId(noteId);
		}
	};
	const formatDate = (timestamp: number) => {
		const d = new Date(timestamp);  // ← Convert from number to Date for display
		return d.toLocaleDateString() + " " + d.toLocaleTimeString([], { 
			hour: '2-digit', 
			minute: '2-digit' 
		});
	};
	const isEditing = isCreatingNew || editingNoteId !== null;
	const isPendingDelete = pendingDeleteId === editingNoteId;

	// Full-screen editor view
	if (isEditing) {
		return (
			<div className="h-full flex flex-col">
				{/* Editor Header */}
				<div className="flex justify-between items-center mb-4">
					<h2 className="text-2xl font-bold">
						{isCreatingNew ? "New Entry" : "Edit Entry"}
					</h2>
					<div className="flex gap-2">
						<button
							onClick={isCreatingNew ? handleSaveNew : handleSaveEdit}
							className="btn btn-sm btn-success gap-1"
						>
							<span className="icon-[mdi--content-save] w-4 h-4" />
							Save
						</button>
						<button
							onClick={isCreatingNew ? handleCancelNew : handleCancelEdit}
							className="btn btn-sm btn-ghost gap-1"
						>
							<span className="icon-[mdi--close] w-4 h-4" />
							Cancel
						</button>
						{editingNoteId && (
							<button
								onClick={() => handleDeleteClick(editingNoteId)}
								className={`btn btn-sm gap-1 ${
									isPendingDelete ? "btn-error" : "btn-ghost"
								}`}
							>
								<span className="icon-[mdi--delete] w-4 h-4" />
								{isPendingDelete ? "Confirm" : "Delete"}
							</button>
						)}
					</div>
				</div>

				{/* Title Input */}
				<input
					type="text"
					value={editTitle}
					onChange={(e) => setEditTitle(e.target.value)}
					className="input input-bordered w-full mb-3"
					placeholder="Note title..."
					autoFocus
				/>

				{/* Content Textarea - Takes all remaining space */}
				<textarea
					value={editContent}
					onChange={(e) => setEditContent(e.target.value)}
					className="textarea textarea-bordered w-full flex-1 resize-none"
					placeholder="Write your notes here..."
				/>

				{/* Footer */}
				<div className="mt-4 pt-3 border-t text-center">
					<p className="text-xs italic opacity-40">
						What is remembered lives
					</p>
				</div>
			</div>
		);
	}

	// List view
	return (
		<div className="h-full flex flex-col">
			{/* Header */}
			<div className="mb-4 space-y-3">
				<div className="flex justify-between items-center">
					<h2 className="text-2xl font-bold">{character.Name}'s Notes</h2>
					<button
						onClick={handleCreateNew}
						className="btn btn-sm btn-primary gap-1"
						disabled={!actionService}
					>
						<span className="icon-[mdi--plus] w-4 h-4" />
						New Entry
					</button>
				</div>

				{/* Search Bar */}
				<div className="relative">
					<input
						type="text"
						placeholder="Search notes..."
						value={searchQuery}
						onChange={(e) => setSearchQuery(e.target.value)}
						className="input input-sm input-bordered w-full pr-8"
					/>
					{searchQuery ? (
						<button
							onClick={() => setSearchQuery("")}
							className="absolute right-2 top-1/2 -translate-y-1/2 btn btn-ghost btn-xs btn-circle"
							aria-label="Clear search"
						>
							<span className="icon-[mdi--close] w-4 h-4"></span>
						</button>
					) : (
						<span className="absolute right-2 top-1/2 -translate-y-1/2 icon-[mdi--magnify] w-4 h-4 opacity-40 pointer-events-none"></span>
					)}
				</div>

				{searchQuery && (
					<p className="text-xs opacity-60">
						Found {filteredNotes.length} note{filteredNotes.length !== 1 ? "s" : ""}
					</p>
				)}
			</div>

			{/* Notes List */}
			<div className="flex-1 overflow-y-auto space-y-2">
				{filteredNotes.length === 0 ? (
					<div className="text-center py-12">
						<div className="text-6xl mb-4">📝</div>
						<p className="text-lg opacity-60 mb-2">
							{searchQuery ? "No notes found" : "No notes yet"}
						</p>
						{!searchQuery && (
							<p className="text-sm opacity-50">
								Click "New Entry" to begin
							</p>
						)}
					</div>
				) : (
					filteredNotes
						.slice()
						.reverse()
						.map((note) => (
							<div
								key={note.Id}
								className="card bg-base-200 border border-base-300 hover:border-base-content/20 transition-colors cursor-pointer"
								onClick={() => handleOpenNote(note)}
							>
								<div className="card-body p-3">
									<div className="flex justify-between items-start gap-2">
										<h3 className="font-semibold text-base flex-1">
											{note.title}
										</h3>
										<span className="text-xs opacity-50 shrink-0">
											{formatDate(note.lastUpdated)}
										</span>
									</div>
									{note.content && (
										<p className="text-sm opacity-70 line-clamp-2 mt-1">
											{note.content}
										</p>
									)}
								</div>
							</div>
						))
				)}
			</div>

			{/* Footer */}
			<div className="mt-4 pt-3 border-t text-center">
				<p className="text-xs italic opacity-40">
					Quest-Net
				</p>
			</div>
		</div>
	);
}