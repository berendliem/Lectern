import { execFile } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

export class MediaUrlError extends Error {}

/** Name-based hosts that always mean "somewhere on this machine or this LAN". */
const BLOCKED_HOSTNAMES = new Set(["localhost"]);
const BLOCKED_SUFFIXES = [".local", ".localhost", ".internal", ".home.arpa"];

/**
 * Address ranges that are not the public internet: loopback, the RFC1918
 * networks, carrier-grade NAT, and — the one that matters most — 169.254.0.0/16,
 * where cloud instances keep their credentials endpoint.
 */
function isPrivateIPv4(bytes: number[]): boolean {
  const [a, b] = bytes;
  if (a === 0 || a === 10 || a === 127) return true; // "this network", private, loopback
  if (a === 169 && b === 254) return true; // link-local, incl. the metadata endpoint
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
  if (a === 192 && b === 168) return true; // RFC1918
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
  if (a === 255 && bytes.every((n) => n === 255)) return true; // broadcast
  return false;
}

function ipv4ToBytes(host: string): number[] | null {
  if (!net.isIPv4(host)) return null;
  return host.split(".").map(Number);
}

/**
 * IPv6 text to its sixteen bytes. The WHATWG URL parser hands back a
 * canonical, compressed, lowercase form, so this only has to understand `::`
 * compression and the dotted-quad tail — but it handles both, because the cost
 * of being wrong here is the check itself being bypassed.
 */
function ipv6ToBytes(host: string): number[] | null {
  if (!net.isIPv6(host)) return null;

  let text = host;
  const bytes: number[] = [];

  // A trailing `a.b.c.d` becomes the last four bytes.
  const tail = text.match(/:((?:\d{1,3}\.){3}\d{1,3})$/);
  let trailing: number[] = [];
  if (tail) {
    const quad = ipv4ToBytes(tail[1]);
    if (!quad) return null;
    trailing = quad;
    text = text.slice(0, text.length - tail[1].length);
  }

  const [head, rest] = text.split("::");
  const toGroups = (part: string) =>
    part
      .split(":")
      .filter((g) => g.length > 0)
      .map((g) => parseInt(g, 16));

  const left = toGroups(head ?? "");
  const right = rest === undefined ? [] : toGroups(rest);

  const push = (groups: number[]) => {
    for (const g of groups) bytes.push((g >> 8) & 0xff, g & 0xff);
  };

  push(left);
  if (rest !== undefined) {
    const filled = left.length * 2 + right.length * 2 + trailing.length;
    for (let i = filled; i < 16; i += 1) bytes.push(0);
  }
  push(right);
  bytes.push(...trailing);

  return bytes.length === 16 ? bytes : null;
}

function isPrivateIPv6(bytes: number[]): boolean {
  const zeros = (from: number, to: number) => bytes.slice(from, to).every((b) => b === 0);

  // ::1 loopback and :: unspecified.
  if (zeros(0, 15) && bytes[15] <= 1) return true;
  // ::ffff:a.b.c.d — an IPv4 address wearing an IPv6 costume. The socket layer
  // treats it as the IPv4 address, so it has to be judged as one.
  if (zeros(0, 10) && bytes[10] === 0xff && bytes[11] === 0xff) return isPrivateIPv4(bytes.slice(12));
  // 64:ff9b::/96, the well-known NAT64 prefix, likewise wraps an IPv4 address.
  if (bytes[0] === 0x00 && bytes[1] === 0x64 && bytes[2] === 0xff && bytes[3] === 0x9b && zeros(4, 12)) {
    return isPrivateIPv4(bytes.slice(12));
  }
  // ::a.b.c.d, the deprecated IPv4-compatible form.
  if (zeros(0, 12)) return true;
  if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) return true; // fe80::/10 link-local
  if ((bytes[0] & 0xfe) === 0xfc) return true; // fc00::/7 unique-local
  if (bytes[0] === 0x01 && zeros(1, 8)) return true; // 100::/64 discard-only
  return false;
}

/**
 * The URL arrives from a text box and is handed to a downloader that runs on
 * the server, so it is a trust boundary even in a single-user app: without a
 * check, pasting `file:///etc/passwd` or an address on the home network asks
 * this machine to go and read it.
 *
 * The address is judged as an address, not as text: `http://[::ffff:169.254.169.254]/`
 * normalizes to the hostname `[::ffff:a9fe:a9fe]`, which no amount of string
 * matching on "169.254." would ever catch, and which the socket layer treats
 * as the link-local metadata endpoint.
 *
 * ponytail: this is lexical — it judges the URL the student typed, not where
 * it ends up. yt-dlp follows redirects without asking again, and a hostname
 * that resolves to a public address here can resolve to a private one when
 * yt-dlp looks it up a moment later. Closing either needs a resolve-and-pin
 * fetcher; worth it only if Lectern ever runs anywhere but localhost.
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
  // The parser keeps IPv6 literals in their brackets; the address inside is
  // what has to be judged.
  const bare = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;

  const bytes = ipv4ToBytes(bare) ?? ipv6ToBytes(bare);
  const blocked = bytes
    ? bytes.length === 4
      ? isPrivateIPv4(bytes)
      : isPrivateIPv6(bytes)
    : BLOCKED_HOSTNAMES.has(host) || BLOCKED_SUFFIXES.some((s) => host.endsWith(s));

  if (blocked) {
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
