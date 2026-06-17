import { Context } from "../Context/Context";
import { User } from "./User";

// Word lists for generating random names
const adjectives = [
	"Silly",
	"Clumsy",
	"Spicy",
	"Mister",
	"Dark",
	"Dank",
	"Salty",
	"Epic",
	"Giga",
	"Based",
	"Cringe",
	"Sussy",
];

const nouns = [
	"Copter",
	"Man",
	"Sister",
	"Knight",
	"Wizard",
	"Pants",
	"Slayer",
	"Bean",
	"Brother",
	"Gamer",
	"Fella",
	"Chad",
];

function generateRandomName(): string {
	const adjective = adjectives[Math.floor(Math.random() * adjectives.length)];
	const noun = nouns[Math.floor(Math.random() * nouns.length)];
	return `${adjective} ${noun}`;
}

export const UserUtils = {
	/**
	 * Sets the user's name in the provided context object.
	 */
	setName(params: { name: string }, context: Context): void {
		const newName = params.name.trim();
		if (newName) {
			context.User.Name = newName;
		}
	},

	createNewUser(): User {
		return {
			Id: crypto.randomUUID(),
			Name: generateRandomName(),
			Role: undefined,
			SelectedCharacters: {},
		};
	},

	selectCharacter(
		params: { campaignId: string; characterId: string | null },
		context: Context
	): void {
		if (context.User.Role === "dm") {
			delete context.User.SelectedCharacters[params.campaignId];
			return;
		}

		if (params.characterId) {
			context.User.SelectedCharacters[params.campaignId] = params.characterId;
		} else {
			// null characterId means unselect
			delete context.User.SelectedCharacters[params.campaignId];
		}
	},

	clearSelectedCharacter(params: { campaignId: string }, context: Context): void {
		delete context.User.SelectedCharacters[params.campaignId];
	},

	/**
	 * DM-only, local-only. Sets which actor the DM is impersonating.
	 * This is not a networked action — players don't need to know.
	 */
	impersonate(
		params: { campaignId: string; actorId: string | null },
		context: Context
	): void {
		if (!context.User.ImpersonatedActors) {
			context.User.ImpersonatedActors = {};
		}
		if (params.actorId) {
			context.User.ImpersonatedActors[params.campaignId] = params.actorId;
		} else {
			delete context.User.ImpersonatedActors[params.campaignId];
		}
	},
};
