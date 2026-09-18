import { NextRequest, NextResponse } from "next/server";
import { isLocalRequest } from "@/lib/local-request";

/**
 * Guards (Next proxy convention) for the unauthenticated localhost API.
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
  if (!isLocalRequest(req.headers.get("host"), req.headers.get("sec-fetch-site"))) {
    return NextResponse.json({ error: "Lectern only answers requests from this machine." }, { status: 403 });
  }

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
