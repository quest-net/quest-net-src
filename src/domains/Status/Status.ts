export interface Status {
	Id: string;
	Name: string;
	Description: string;
	Image?: string;
	IsBuff: boolean; // True = positive, False = negative
	Duration: number;
}
