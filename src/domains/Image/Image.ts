export interface Image {
	Id: string;
	Name: string;
	FileSize: number; // In bytes, for UI display
	MimeType: string; // 'image/webp' or 'image/gif' (legacy uploads may also be 'image/jpeg')
	Width: number; // For aspect ratio calculations
	Height: number; // For aspect ratio calculations
	// True when the source image carried alpha transparency. Renderers that
	// support cutout actor tokens (3DMap) draw cutout images frameless and
	// fitted-to-contain rather than clipped/framed inside a square. Auto-set
	// at upload time via an alpha pixel scan; the DM can override in the
	// image edit form.
	Cutout?: boolean;
	Tags?: string[];
	UploadedBy?: string;
}
