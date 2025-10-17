import { Context } from "../Context/Context";
import { User } from "./User";

// Word lists for generating random names
const adjectives = [
  'Silly', 'Clumsy', 'Spicy', 'Mister', 'Dark', 'Dank',
  'Salty', 'Epic', 'Giga', 'Based', 'Cringe', 'Sussy'
];

const nouns = [
  'Copter', 'Man', 'Sister', 'Knight', 'Wizard', 'Pants',
  'Slayer', 'Bean', 'Brother', 'Gamer', 'Fella', 'Chad'
];

function generateRandomName(): string {
  const adjective = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  return `${adjective} ${noun}`;
}

export const UserActions = {
  /**
   * Sets the user's name in the provided context object.
   */
  setName(params: { name: string }, context: Context): void {
    const newName = params.name.trim();
    if (newName) {
      context.User.Name = newName;
      console.log(`[User] User name updated to: ${newName}`);
    }
  },

  createNewUser(): User {
    return {
        Id: crypto.randomUUID(),
        Name: generateRandomName(),
        Role: undefined
      }
  }
};