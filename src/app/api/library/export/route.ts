import { jsonError } from "@/lib/api-utils";
import { exportFileName, streamLibraryTar } from "@/lib/library-export";

export async function GET() {
  let body: ReadableStream<Uint8Array>;
  try {
    body = await streamLibraryTar();
  } catch (e) {
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
