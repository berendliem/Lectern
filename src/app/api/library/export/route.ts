import { NextRequest } from "next/server";
import { jsonError } from "@/lib/api-utils";
import { ExportBusyError, exportFileName, streamLibraryTar } from "@/lib/library-export";

export async function GET(req: NextRequest) {
  // A page in another tab can hit a GET with an <img>, and each hit is a full
  // VACUUM of the database. The app's own pages send same-origin (or none,
  // from the address bar); anything cross-site is not the student.
  if (req.headers.get("sec-fetch-site") === "cross-site") {
    return jsonError("Export must be started from Lectern itself", 403);
  }
  let body: ReadableStream<Uint8Array>;
  try {
    body = await streamLibraryTar();
  } catch (e) {
    if (e instanceof ExportBusyError) return jsonError(e.message, 409);
    const message = e instanceof Error ? e.message : "Could not snapshot the database";
    return jsonError(`Export failed before it started: ${message}`, 500);
  }
  return new Response(body, {
    headers: {
      "Content-Type": "application/x-tar",
      "Content-Disposition": `attachment; filename="${exportFileName()}"`,
      "Cache-Control": "no-store",
    },
  });
}
