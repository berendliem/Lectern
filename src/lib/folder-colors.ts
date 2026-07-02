// Turbo-style pastel families for color-coding folders. The family name is
// stored in Folder.color; unknown/missing values fall back to lavender.

export const FOLDER_FAMILIES = ["lavender", "blush", "daisy", "moss"] as const;
export type FolderFamily = (typeof FOLDER_FAMILIES)[number];

export const FOLDER_CHIP_CLASSES: Record<FolderFamily, string> = {
  lavender: "bg-lavender-soft text-lavender-ink",
  blush: "bg-blush-soft text-blush-ink",
  daisy: "bg-daisy-soft text-daisy-ink",
  moss: "bg-moss-soft text-moss-ink",
};

export const FOLDER_DOT_CLASSES: Record<FolderFamily, string> = {
  lavender: "bg-lavender",
  blush: "bg-blush",
  daisy: "bg-daisy",
  moss: "bg-moss",
};

export const FOLDER_ICON_CLASSES: Record<FolderFamily, string> = {
  lavender: "text-lavender-ink",
  blush: "text-blush-ink",
  daisy: "text-daisy-ink",
  moss: "text-moss-ink",
};

export function folderFamily(color: string | null | undefined): FolderFamily {
  return (FOLDER_FAMILIES as readonly string[]).includes(color ?? "")
    ? (color as FolderFamily)
    : "lavender";
}

export function pickFolderFamily(existingCount: number): FolderFamily {
  return FOLDER_FAMILIES[existingCount % FOLDER_FAMILIES.length];
}
