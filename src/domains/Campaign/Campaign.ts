import { Character } from "../Character/Character";
import { Item } from "../Item/Item";
import { Skill } from "../Skill/Skill";
import { Image } from "../Image/Image";
import { LogEntry } from "../Log/LogEntry";
import { Audio } from "../Audio/Audio";
import { Status } from "../Status/Status";
import { GameState } from "../GameState/GameState";
import { Entity } from "../Entity/Entity";
import { CampaignSettings } from "../CampaignSetting/CampaignSetting";
import { Terrain } from "../Terrain/Terrain";
import { Scenario } from "../Scenario/Scenario";

/**
 * Lightweight campaign metadata stored in Context.
 * The full Campaign object lives in IndexedDB.
 * For DM-owned campaigns: Id is the secret GUID.
 * For player-cached campaigns: Id === RoomCode (StateSync sanitizes before broadcast).
 */
export interface CampaignInfo {
	Id: string;
	Name: string;
	RoomCode: string;
	CreatedAt: number;
}

export interface Campaign {
	Id: string;
	Name: string;
	RoomCode: string;
	CreatedAt: number;
	//Global Collections
	CharacterRoster: Character[];
	ItemTemplates: Item[];
	SkillTemplates: Skill[];
	StatusTemplates: Status[];
	EntityTemplates: Entity[];
	Terrains: Terrain[];
	Audios: Audio[];
	Images: Image[];
	Scenarios: Scenario[];
	//GameState
	GameState: GameState;
	//Campaign Log
	Log: LogEntry[];
	LogHead: number;
	//Campaign-specific settings
	Settings: CampaignSettings;
}

