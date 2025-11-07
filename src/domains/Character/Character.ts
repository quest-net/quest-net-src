import { Actor } from "../Actor/Actor";
import { Note } from "../Note/Note";

export interface Character extends Actor {
	Notes: Note[]; // Player's notes for this character
	CritMessage?: string;
}
