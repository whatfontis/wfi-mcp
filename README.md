# @whatfontis/mcp

> Identify any font from inside Claude, Cursor, Claude Code, or any other MCP-compatible AI client.

This is the official [Model Context Protocol](https://modelcontextprotocol.io) server for [WhatFontIs](https://www.whatfontis.com). It plugs the WhatFontIs font-identification API into your AI workflow — just attach an image (or paste a URL) and ask "what font is this?".

```
─── you, in Claude ───
What font is this?
[attached image: hand-drawn letters reading "Lettering"]

─── Claude calls the tool, gets back ───
Found 28 font matches (ordered by similarity):

 1. Matura MT Std  🔵 COMMERCIAL  — Myfonts.com
    Details: https://www.whatfontis.com/Matura-MT-Std.font
    Preview: https://d1ly52g9wjvbd2.cloudfront.net/.../Matura-MT-Stda.png

 2. ...
```

## Install

### 1. Get an API key

Sign up at <https://www.whatfontis.com>, then visit your dropdown menu → **MCP & Credits** → **API Keys & Credits** and click **Generate primary key**.

Every account gets **200 free identifications per day**. Beyond that you can top up at $1 = 1,000 credits (credits never expire).

Full docs and pricing: <https://www.whatfontis.com/mcp.html>

### 2. Wire it up to your MCP client

#### Claude Desktop

Open Settings → Developer → Edit Config (or open `claude_desktop_config.json` directly) and paste:

```json
{
  "mcpServers": {
    "whatfontis": {
      "command": "npx",
      "args": ["-y", "@whatfontis/mcp"],
      "env": {
        "WFI_API_KEY": "wfi_mcp_YOUR_KEY_HERE"
      }
    }
  }
}
```

Save, restart Claude Desktop, and ask "what font is this?" with an image attached.

#### Claude Code

```bash
claude mcp add whatfontis npx @whatfontis/mcp \
  -e WFI_API_KEY=wfi_mcp_YOUR_KEY_HERE
```

#### Cursor

Open `~/.cursor/mcp.json` (or Settings → MCP → Add new server) and paste the same JSON block as the Claude Desktop one above.

#### Cline / Continue / others

Any MCP client that supports stdio servers works. Add a server with command `npx -y @whatfontis/mcp` and env var `WFI_API_KEY`.

## The tool

### `identify_font`

Identify a font from an image and return a ranked list of matches.

| Parameter | Type | Notes |
| --- | --- | --- |
| `image_url` | string (URL) | Publicly fetchable PNG / JPG / WebP. **Either this or `image_base64` required.** |
| `image_base64` | string | Image as base64 (raw or `data:image/...;base64,...` data-URI). |
| `text` | string (≤ 80 chars) | Optional. The text written in the image. Improves match accuracy. |

Returns up to ~30 candidate fonts, each with:
- `title` — font name
- `url` — WhatFontIs details page (download / license info)
- `image`, `image1`, `image2` — preview renders (uppercase, lowercase, digits)
- `type` — `"Free"` or `"Commercial"`
- `site` — source catalog (Myfonts.com, Adobe, FFonts.net, Creative Fabrica, …)

## Environment variables

| Var | Default | Notes |
| --- | --- | --- |
| `WFI_API_KEY` | _(required)_ | Generate at <https://www.whatfontis.com/credits.html> |
| `WFI_BASE_URL` | `https://www.whatfontis.com` | Override for self-hosted clones or staging. |

## Local development

```bash
git clone https://github.com/whatfontis/wfi-mcp.git
cd wfi-mcp
npm install
npm run build

# Run with the official endpoint:
WFI_API_KEY=wfi_mcp_xxx node dist/index.js

# Or wire your local checkout into Claude Desktop:
#   "command": "node",
#   "args": ["/absolute/path/to/wfi-mcp/dist/index.js"],
#   "env": { "WFI_API_KEY": "..." }
```

## Pricing

| Tier | Cost | Notes |
| --- | --- | --- |
| Free | $0 | 200 identifications / day, reset 00:00 UTC |
| Pay-as-you-go | $1 = 1,000 credits | Used only after free quota is exhausted. Credits never expire. |
| Enterprise | Custom | 100k+ requests / month, SLA, custom licensing — [contact us](https://www.whatfontis.com/contact-api.html) |

## License

MIT — see [LICENSE](./LICENSE).

WhatFontIs is © WHATFONTIS COM SRL.
