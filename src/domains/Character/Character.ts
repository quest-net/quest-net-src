import { Actor } from "../Actor/Actor";
import { Note } from "../Note/Note";
import { User } from "../User/User";

export interface Character extends Actor {
	Notes: Note[];			  // Player's notes for this character
	playedBy: User | null;         //ID of the user currently playing this character
}