import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The MCP SDK spawns child processes (stdio transports); keep it external
  // so Next's bundler doesn't try to trace/bundle it.
  serverExternalPackages: ["@modelcontextprotocol/sdk", "@huggingface/transformers"],
};

export default nextConfig;
