export interface User {
	Id: string;
	// Not sure what this can be used for
	Name: string;

	Role?: "dm" | "player";

	SelectedCharacters: Record<string, string>; //campaignId -> characterId
	ImpersonatedActors?: Record<string, string>; //campaignId -> actorId (DM only, local-only)
	/**
	 * DM only. Character IDs claimed by players in the DM's active room.
	 * The DM is the one peer guaranteed to see every player, so it relays the
	 * claimed set on its own broadcast User. See ActionService.
	 */
	ClaimedCharacters?: string[];
}
