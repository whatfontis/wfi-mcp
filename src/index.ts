#!/usr/bin/env node
/**
 * @whatfontis/mcp — MCP server for WhatFontIs font identification.
 *
 * Exposes one tool, `identify_font`, to any MCP-compatible AI client
 * (Claude Desktop, Claude Code, Cursor, Continue, Cline). The tool
 * accepts an image URL or a base64 image, calls the WhatFontIs public
 * API, and returns a ranked list of font matches.
 *
 * Configuration (env vars):
 *   WFI_API_KEY      (required) — key generated at /credits.html
 *   WFI_BASE_URL     (optional) — defaults to https://www.whatfontis.com
 *                                 set to a self-hosted clone if needed
 *
 * Transport: stdio (the MCP standard for locally-launched servers).
 *
 * Distribution: published to npm as @whatfontis/mcp; users run
 *   npx -y @whatfontis/mcp
 * from their MCP client config.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { identifyFont, WfiApiError, type FontMatch } from "./client.js";

const PKG_VERSION = "0.1.0";

// ── Config ────────────────────────────────────────────────────────────────
const API_KEY = (process.env.WFI_API_KEY ?? "").trim();
const BASE_URL = (process.env.WFI_BASE_URL ?? "https://www.whatfontis.com").trim();

// We do NOT exit on missing key at boot — instead we let the server
// start, advertise its tool, and return a clear error on first call.
// Reason: some MCP clients spawn the server on a "test connection" step
// before any UI prompts; failing at boot would show a confusing crash
// instead of a friendly "set your API key" message.

// ── Tool schema ───────────────────────────────────────────────────────────
const identifyInputSchema = {
  image_url: z
    .string()
    .url()
    .optional()
    .describe(
      "Publicly fetchable image URL (PNG / JPG / WebP). Either this OR image_base64 is required.",
    ),
  image_base64: z
    .string()
    .optional()
    .describe(
      "Image as base64 (raw, or data:URI). Either this OR image_url is required. " +
        "Use this when the image lives on the user's machine and you can't host it.",
    ),
  text: z
    .string()
    .max(80)
    .optional()
    .describe(
      "Optional hint about the text written in the image (e.g. \"Hello\"). " +
        "Helps the matcher pick correct letters when the image is ambiguous.",
    ),
};

// ── Bootstrap ─────────────────────────────────────────────────────────────
async function main() {
  const server = new McpServer({
    name: "whatfontis",
    version: PKG_VERSION,
  });

  server.tool(
    "identify_font",
    "Identify a font from an image and return a ranked list of matches. " +
      "Pass either image_url (publicly fetchable) or image_base64 (raw or data:URI). " +
      "Optional `text` hint improves accuracy. Returns up to ~30 candidate fonts with name, " +
      "preview images (uppercase + lowercase + digits), source catalog, and a link to the " +
      "WhatFontIs details page with download / license info.",
    identifyInputSchema,
    async (args) => {
      if (!API_KEY) {
        return toolError(
          "WFI_API_KEY is not set. Generate one at https://www.whatfontis.com/credits.html " +
            'and add it to your MCP client config (e.g. {"env": {"WFI_API_KEY": "wfi_mcp_..."}}).',
        );
      }

      try {
        const results: FontMatch[] = await identifyFont({
          apiKey: API_KEY,
          baseUrl: BASE_URL,
          imageUrl: args.image_url,
          imageBase64: args.image_base64,
        });

        if (results.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: "No fonts matched this image. Try a clearer / higher-contrast crop, or pass a `text` hint with what's written.",
              },
            ],
          };
        }

        return {
          content: [
            {
              type: "text" as const,
              text:
                `Found ${results.length} font matches (ordered by similarity):\n\n` +
                renderResults(results),
            },
          ],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return toolError(msg);
      }
    },
  );

  // Stdio is the standard transport for npx-launched MCP servers.
  // The client (Claude Desktop etc.) launches us, pipes JSON-RPC over
  // stdin/stdout, and reads diagnostics from stderr (which is why we
  // never write log output to stdout).
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Friendly boot log on stderr (visible in MCP client diagnostics).
  process.stderr.write(
    `[whatfontis-mcp v${PKG_VERSION}] ready · base=${BASE_URL} · key=${
      API_KEY ? "present" : "MISSING"
    }\n`,
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────

function renderResults(results: FontMatch[]): string {
  // Markdown-ish table that Claude renders nicely inline. We embed the
  // detail-page URL + the lowercase preview image (image1) because that's
  // usually the most recognisable rendering for the user.
  const top = results.slice(0, 30);
  return top
    .map((r, i) => {
      const num = String(i + 1).padStart(2, " ");
      const tag = r.type === "Free" ? "🟢 FREE" : "🔵 " + r.type.toUpperCase();
      return [
        `${num}. **${r.title}**  ${tag}  — ${r.site}`,
        `    Details: ${r.url}`,
        `    Preview: ${r.image1 || r.image}`,
      ].join("\n");
    })
    .join("\n\n");
}

function toolError(message: string) {
  // MCP convention: return an error string in the content + set isError.
  // Claude surfaces this as a tool error in the chat.
  return {
    isError: true,
    content: [{ type: "text" as const, text: `WhatFontIs error: ${message}` }],
  };
}

// ── Entry ─────────────────────────────────────────────────────────────────
main().catch((err) => {
  // Last-ditch fatal handler — anything that gets here means we couldn't
  // even bring up the MCP transport. Write to stderr so the host shows it.
  process.stderr.write(
    `[whatfontis-mcp] FATAL: ${err instanceof Error ? err.stack || err.message : String(err)}\n`,
  );
  process.exit(1);
});
