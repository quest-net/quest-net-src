export interface Campaign {
    Id: string;
    Name: string;
    RoomCode: string;
    Characters: Character[];
    Items: Item[];
    Skills: Skill[];
    Statuses: Status[];
    Audios: Audio[];
    Images: Image[];
    Entities: Entity[];
}