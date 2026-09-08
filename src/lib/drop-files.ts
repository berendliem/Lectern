"use client";

// Turns a browser drop into a flat list of files: folders are walked, zips are
// expanded in the browser (fflate, already used by office-extract.ts). Nothing
// is uploaded here — extraction still happens client-side, so the files
// themselves never leave the machine.

import { unzip } from "fflate";

export type DroppedFile = {
  /** Path relative to what was dropped, kept so folder names stay visible. */
  path: string;
  file: File;
};

// A dropped course folder can hold hundreds of files, and every one of them is
// extracted in this tab. The cap keeps a stray drop of a whole Downloads
// directory from locking the page up; the UI says how many were ignored.
export const MAX_DROPPED_FILES = 200;

// A zip advertises each entry's uncompressed size before anything is
// inflated, which is the only point where a decompression bomb can still be
// refused cheaply: a few hundred KB of zeros expands to gigabytes, and fflate
// would inflate all of it into this tab before the file cap below ever ran.
//
// ponytail: the size is the archive's own claim, so a crafted zip can
// understate it and still inflate the real bytes. That is a deliberate
// ceiling for a local, single-user tool where the archives come from the
// user's own course pages; tallying inflated bytes as they arrive is the
// upgrade if this ever accepts a file from someone else.
export const MAX_ZIP_ENTRY_BYTES = 64 * 1024 * 1024;
export const MAX_ZIP_TOTAL_BYTES = 256 * 1024 * 1024;

function readAll(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  // readEntries returns at most 100 per call and signals the end with an empty
  // batch, so a single call would silently truncate a large lecture folder.
  return new Promise((resolve, reject) => {
    const all: FileSystemEntry[] = [];
    const next = () =>
      reader.readEntries((batch) => {
        if (batch.length === 0) resolve(all);
        else {
          all.push(...batch);
          next();
        }
      }, reject);
    next();
  });
}

async function walkEntry(entry: FileSystemEntry, prefix: string): Promise<DroppedFile[]> {
  const path = prefix ? `${prefix}/${entry.name}` : entry.name;

  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) =>
      (entry as FileSystemFileEntry).file(resolve, reject)
    );
    return [{ path, file }];
  }

  const entries = await readAll((entry as FileSystemDirectoryEntry).createReader());
  const nested = await Promise.all(entries.map((child) => walkEntry(child, path)));
  return nested.flat();
}

/**
 * Every file in a drop, folders included.
 *
 * Must be called synchronously from the drop handler: `dataTransfer.items` is
 * emptied once the event finishes, so the entries are snapshotted before the
 * first await.
 */
export async function collectDropFiles(dt: DataTransfer): Promise<DroppedFile[]> {
  const entries = Array.from(dt.items)
    .map((item) => (item.kind === "file" ? (item.webkitGetAsEntry?.() ?? null) : null))
    .filter((e): e is FileSystemEntry => e !== null);
  const plain = Array.from(dt.files);

  if (entries.length === 0) return plain.map((file) => ({ path: file.name, file }));

  const walked = await Promise.all(entries.map((entry) => walkEntry(entry, "")));
  return walked.flat();
}

export type ZipLimits = {
  /** Largest single uncompressed entry that will be inflated. */
  entryBytes: number;
  /** Budget across one archive; exceeding it rejects the whole zip. */
  totalBytes: number;
  /** Entries taken from one archive. */
  entries: number;
};

const DEFAULT_ZIP_LIMITS: ZipLimits = {
  entryBytes: MAX_ZIP_ENTRY_BYTES,
  totalBytes: MAX_ZIP_TOTAL_BYTES,
  entries: MAX_DROPPED_FILES,
};

type ZipBudget = { total: number; overflowed: boolean; kept: number; skippedByLimit: number };

function unzipAsync(
  bytes: Uint8Array,
  budget: ZipBudget,
  limits: ZipLimits
): Promise<Record<string, Uint8Array>> {
  // The async form hands the work off the main thread; unzipSync would freeze
  // the tab for the length of a lecture-sized archive. `filter` runs before an
  // entry is inflated, so anything it rejects costs nothing.
  return new Promise((resolve, reject) => {
    unzip(
      bytes,
      {
        filter: (entry) => {
          if (entry.originalSize > limits.entryBytes) {
            budget.skippedByLimit += 1;
            return false;
          }
          if (budget.kept >= limits.entries) {
            budget.skippedByLimit += 1;
            return false;
          }
          if (budget.total + entry.originalSize > limits.totalBytes) {
            budget.overflowed = true;
            return false;
          }
          budget.total += entry.originalSize;
          budget.kept += 1;
          return true;
        },
      },
      (err, files) => (err ? reject(err) : resolve(files))
    );
  });
}

/**
 * Replaces each dropped `.zip` with the files inside it. Entries keep their
 * path within the archive, so a `Week 3/` folder in the zip reads the same as
 * a dropped `Week 3/` folder. Zips nested inside a zip are left alone —
 * `routeDropFile` reports them as skipped rather than recursing.
 *
 * `ignored` counts entries left behind by the per-entry and count limits, and
 * `refused` names the archives skipped whole, so the caller can say what
 * happened rather than silently importing a truncated drop.
 */
export async function expandZips(
  dropped: DroppedFile[],
  limits: ZipLimits = DEFAULT_ZIP_LIMITS
): Promise<{ files: DroppedFile[]; ignored: number; refused: string[] }> {
  const out: DroppedFile[] = [];
  const refused: string[] = [];
  let ignored = 0;

  for (const item of dropped) {
    if (!/\.zip$/i.test(item.path)) {
      out.push(item);
      continue;
    }

    const budget: ZipBudget = { total: 0, overflowed: false, kept: 0, skippedByLimit: 0 };
    let entries: Record<string, Uint8Array>;
    try {
      entries = await unzipAsync(new Uint8Array(await item.file.arrayBuffer()), budget, limits);
    } catch {
      refused.push(`${item.file.name} isn't a readable zip archive`);
      continue;
    }
    if (budget.overflowed) {
      // Refusing the archive used to throw, which discarded the rest of the
      // drop with it — a folder dropped alongside one oversized zip had to be
      // dropped again. The archive is refused by name and the rest survives.
      refused.push(
        `${item.file.name} unpacks to more than ${Math.round(limits.totalBytes / (1024 * 1024))}MB — unzip it yourself and drop the files you need`
      );
      continue;
    }

    ignored += budget.skippedByLimit;

    for (const [name, bytes] of Object.entries(entries)) {
      // fflate lists directories as zero-byte entries ending in "/".
      if (name.endsWith("/")) continue;
      // fflate returns a plain object, so an entry literally named __proto__
      // never lands as an own property; naming it here keeps the skip
      // deliberate rather than a silent disappearance.
      if (name === "__proto__") {
        ignored += 1;
        continue;
      }
      const base = name.split("/").pop() || name;
      out.push({
        path: name,
        // Copy into a plain ArrayBuffer view: a Uint8Array over fflate's
        // pooled buffer is not a valid File part on every browser.
        file: new File([new Uint8Array(bytes)], base),
      });
    }
  }

  return { files: out, ignored, refused };
}
