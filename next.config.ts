import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The MCP SDK spawns child processes (stdio transports); keep it external
  // so Next's bundler doesn't try to trace/bundle it.
  serverExternalPackages: ["@modelcontextprotocol/sdk", "@huggingface/transformers"],
  experimental: {
    // Next truncates request bodies past 10 MB by default, which silently
    // corrupts the multipart upload of anything longer than ~15 minutes of
    // audio. Lecture recordings and video uploads are routinely bigger.
    proxyClientMaxBodySize: "512mb",
  },
  // Model-written markdown renders on almost every page, and an image in it is
  // a request the browser makes on its own: a prompt-injected reading could
  // put course content in an image URL and send it anywhere. Every image
  // Lectern shows itself is same-origin, a data URL or a blob.
  async headers() {
    return [
      { source: "/:path*", headers: [{ key: "Content-Security-Policy", value: "img-src 'self' data: blob:" }] },
    ];
  },
};

export default nextConfig;
