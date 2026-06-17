// domains/Note/NoteActions.ts

import { Context } from "../Context/Context";
import { CampaignUtils } from "../Campaign/CampaignUtils";
import { Note } from "./Note";

/**
 * Note action handlers
 * Notes are stored per character in Character.Notes
 */
export const NoteActions = {
	/**
	 * Creates a new note for a character
	 */
	create(
		params: { characterId: string; note: Partial<Note> },
		context: Context
	): void {
		const campaign = CampaignUtils.getActiveCampaign(context);

		// Find character in GameState (spawned characters)
		const character = campaign.GameState.Characters.find(
			(c) => c.Id === params.characterId
		);

		if (!character) {
			console.warn(`Character not found: ${params.characterId}`);
			return;
		}

		const newNote: Note = {
			Id: crypto.randomUUID(),
			title: params.note.title || "Untitled Note",
			content: params.note.content || "",
			lastUpdated: Date.now(),
		};

		character.Notes.push(newNote);
	},

	/**
	 * Edits an existing note
	 */
	edit(
		params: { characterId: string; noteId: string; updates: Partial<Note> },
		context: Context
	): void {
		const campaign = CampaignUtils.getActiveCampaign(context);

		const character = campaign.GameState.Characters.find(
			(c) => c.Id === params.characterId
		);

		if (!character) {
			console.warn(`Character not found: ${params.characterId}`);
			return;
		}

		const note = character.Notes.find((n) => n.Id === params.noteId);

		if (!note) {
			console.warn(`Note not found: ${params.noteId}`);
			return;
		}

		// Update note fields
		if (params.updates.title !== undefined) {
			note.title = params.updates.title;
		}
		if (params.updates.content !== undefined) {
			note.content = params.updates.content;
		}

		// Always update timestamp
		note.lastUpdated = Date.now();
	},

	/**
	 * Deletes a note
	 */
	delete(
		params: { characterId: string; noteId: string },
		context: Context
	): void {
		const campaign = CampaignUtils.getActiveCampaign(context);

		const character = campaign.GameState.Characters.find(
			(c) => c.Id === params.characterId
		);

		if (!character) {
			console.warn(`Character not found: ${params.characterId}`);
			return;
		}

		const noteIndex = character.Notes.findIndex((n) => n.Id === params.noteId);

		if (noteIndex === -1) {
			console.warn(`Note not found: ${params.noteId}`);
			return;
		}

		character.Notes.splice(noteIndex, 1);
	},
};