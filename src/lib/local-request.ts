// Lectern has no login and its onQ routes act with the user's own onQ
// session, so the API answers only the machine it runs on. The Host check
// catches a request that reached us through another interface or a forwarded
// hostname; Sec-Fetch-Site catches a browser page on another site talking to
// localhost, which the Host check alone would let through.
const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1"]);

export function isLocalRequest(host: string | null, secFetchSite: string | null): boolean {
  if (secFetchSite === "cross-site") return false;
  if (!host) return false;
  const bracketed = host.match(/^\[([^\]]+)\](?::\d+)?$/);
  const hostname = bracketed ? bracketed[1] : host.replace(/:\d+$/, "");
  return LOOPBACK.has(hostname.toLowerCase());
}
