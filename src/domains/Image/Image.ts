export interface Image {
	Id: string;
	Name: string;
	FileSize: number; // In bytes, for UI display
	MimeType: string; // 'image/jpeg' or 'image/gif'
	Width: number; // For aspect ratio calculations
	Height: number; // For aspect ratio calculations
	Tags?: string[];
	UploadedBy?: string;
}
