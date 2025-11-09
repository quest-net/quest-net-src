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

export interface Campaign {
	Id: string;
	Name: string;
	RoomCode: string;
	//Global Collections
	CharacterRoster: Character[];
	ItemTemplates: Item[];
	SkillTemplates: Skill[];
	StatusTemplates: Status[];
	EntityTemplates: Entity[];
	Terrains: Terrain[];
	Audios: Audio[];
	Images: Image[];
	//GameState
	GameState: GameState;
	//Campaign Log
	Log: LogEntry[];
	//Campaign-specific settings
	Settings: CampaignSettings;
}
