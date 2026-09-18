import { NextRequest, NextResponse } from "next/server";
import { isLocalRequest } from "@/lib/local-request";

/**
 * Guards (Next proxy convention) for the unauthenticated localhost app.
 *
 * First, every request must come from this machine: the app binds to
 * 127.0.0.1, but a forwarded hostname or a page on another site could still
 * reach it, and the onQ routes act with the user's own onQ session.
 *
 * Then, CSRF: state-changing requests must come from this app itself.
 * Cross-site browser requests (including no-preflight "simple" POSTs like
 * text/plain JSON or form submits) are rejected; non-browser clients (curl,
 * the whisper sidecar) send neither header and are unaffected.
 */
export function proxy(req: NextRequest) {
  const isApi = req.nextUrl.pathname === "/api" || req.nextUrl.pathname.startsWith("/api/");

  // Pages get the Host check only. Following a link to Lectern from another
  // site is a legitimate cross-site navigation; a foreign Host is DNS
  // rebinding, and the pages render the same course content the API serves.
  if (!isLocalRequest(req.headers.get("host"), isApi ? req.headers.get("sec-fetch-site") : null)) {
    return NextResponse.json({ error: "Lectern only answers requests from this machine." }, { status: 403 });
  }

  if (!isApi || req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
    return NextResponse.next();
  }

  const fetchSite = req.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    return NextResponse.json({ error: "Cross-site requests are not allowed" }, { status: 403 });
  }

  const origin = req.headers.get("origin");
  if (origin) {
    let originHost: string;
    try {
      originHost = new URL(origin).host;
    } catch {
      return NextResponse.json({ error: "Invalid Origin header" }, { status: 403 });
    }
    if (originHost !== req.nextUrl.host) {
      return NextResponse.json({ error: "Cross-origin requests are not allowed" }, { status: 403 });
    }
  }

  return NextResponse.next();
}

// Everything except Next's own static output, which carries no course content
// and is fetched on every page load.
export const config = { matcher: "/((?!_next/static|_next/image|favicon.ico).*)" };
