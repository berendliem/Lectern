import { NextRequest, NextResponse } from "next/server";

/**
 * CSRF guard (Next proxy convention) for the unauthenticated localhost API: state-changing requests
 * must come from this app itself. Cross-site browser requests (including
 * no-preflight "simple" POSTs like text/plain JSON or form submits) are
 * rejected; non-browser clients (curl, the whisper sidecar) send neither
 * header and are unaffected.
 */
export function proxy(req: NextRequest) {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
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

export const config = { matcher: "/api/:path*" };
