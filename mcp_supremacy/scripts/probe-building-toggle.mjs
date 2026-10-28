/**
 * Probe Ultimate client for building activate/deactivate APIs.
 * Run inside container: docker exec -w /app mcp_supremacy_mcp node /app/scripts/probe-building-toggle.mjs
 * Or call via MCP page.evaluate after ensure_ready.
 */
import { chromium } from "playwright";

const profile = process.env.S1914_MCP_PROFILE || "/data/profile";
// Attach to existing CDP if available is hard; use evaluate via temporary connect is not possible
// while profile locked. Instead print instructions — this script is meant to be eval'd via MCP.

console.log(
  JSON.stringify({
    hint: "Use MCP inject probe instead — profile may be locked",
    profile,
  }),
);
