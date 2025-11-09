export interface Status {
	Id: string;
	Name: string;
	Description?: string;
	Image?: string;
	Tags?: string[];
	
	// Duration in turns (undefined = permanent status)
	Duration?: number;
}