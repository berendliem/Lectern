import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/** Hosts the server must never be talked into fetching on the student's behalf. */
const BLOCKED_HOSTNAMES = new Set(["localhost", "127.0.0.1", "0.0.0.0", "[::1]", "::1"]);
const PRIVATE_IPV4 = /^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;

export class MediaUrlError extends Error {}

/**
 * The URL arrives from a text box and is handed to a downloader that runs on
 * the server, so it is a trust boundary even in a single-user app: without a
 * check, pasting `file:///etc/passwd` or an address on the home network asks
 * this machine to go and read it.
 *
 * ponytail: validates the URL the student typed, not where it ends up. A
 * redirect into a private address is still followed by yt-dlp. Resolve the
 * host and re-check per hop if Lectern ever runs anywhere but localhost.
 */
export function assertFetchableMediaUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new MediaUrlError("That doesn't look like a link. Paste the full address, starting with https://");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new MediaUrlError("Only http and https links can be fetched");
  }

  const host = url.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(host) || PRIVATE_IPV4.test(host) || host.endsWith(".local")) {
    throw new MediaUrlError("That address is on this machine or your local network, so it will not be fetched");
  }

  return url;
}

export class YtDlpMissingError extends Error {
  constructor() {
    super(
      "yt-dlp is not installed, so links can't be fetched yet (macOS: brew install yt-dlp, Ubuntu: sudo apt install yt-dlp). Uploading the audio file still works."
    );
  }
}

function isMissingBinary(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "ENOENT";
}

/**
 * Pulls the audio track of whatever is at `url` into `destDir` as m4a, and
 * reports the title the source gave it.
 *
 * The URL is passed as an argv element, never through a shell, so a link
 * containing shell metacharacters stays a link and cannot become a command.
 * `--no-playlist` matters: a lecture link that happens to carry a list
 * parameter would otherwise fetch the entire course.
 */
export async function downloadAudio(url: URL, destDir: string): Promise<{ filePath: string; title: string }> {
  const filePath = path.join(destDir, "source.m4a");

  try {
    const { stdout } = await run("yt-dlp", ["--no-playlist", "--skip-download", "--print", "%(title)s", url.href], {
      timeout: 60_000,
    });
    const title = stdout.trim().split("\n")[0] ?? "";

    await run(
      "yt-dlp",
      [
        "--no-playlist",
        "--extract-audio",
        "--audio-format",
        "m4a",
        "--output",
        path.join(destDir, "source.%(ext)s"),
        url.href,
      ],
      // Long lectures are the point of this feature, so the download gets room.
      { timeout: 30 * 60_000, maxBuffer: 1024 * 1024 * 10 }
    );

    return { filePath, title };
  } catch (e) {
    if (isMissingBinary(e)) throw new YtDlpMissingError();
    throw e;
  }
}
