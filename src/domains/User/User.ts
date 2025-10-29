export interface User {
	Id: string;
	// Not sure what this can be used for
	Name: string;

	Role?: "dm" | "player";

	SelectedCharacters: Record<string, string>; //campaignId -> characterId
}
