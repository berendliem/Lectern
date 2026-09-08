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
};

export default nextConfig;
