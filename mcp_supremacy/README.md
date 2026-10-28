# mcp-supremacy

**Supremacy 1914 MCP** — control *your* account with Cursor, ChatGPT, or any MCP client.

Playwright runs the live Ultimate client, injects helpers, and exposes read/write tools (armies, provinces, economy, diplomacy, heroes, operations). One player session per server. Writes are off until you enable them.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](../LICENSE)
[![Node.js ≥20](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org)
[![Playwright](https://img.shields.io/badge/browser-Playwright-45ba4b)](https://playwright.dev)
[![MCP](https://img.shields.io/badge/protocol-MCP-111111)](https://modelcontextprotocol.io)
[![Docker](https://img.shields.io/badge/run-Docker-2496ED)](docs/DEPLOY.md)

> Keywords: Supremacy 1914 bot, Supremacy 1914 automation, S1914 MCP, Bytro Ultimate client tools, AI war advisor for Supremacy.

## What you get

| Capability | Examples |
|---|---|
| Session | `ensure_ready`, `login`, `list_games`, `health` |
| War / map | `get_war_picture`, `get_own_armies`, `get_relations` |
| Economy | `get_resources`, `get_finance_picture`, `get_provinces`, market tools |
| Actions | `move_army`, build / produce, heroes, diplomacy (needs writes + `confirm`) |
| Ops | `get_operations` (Hero Pass objectives & leveling notes) |

Full reference: [docs/TOOLS.md](docs/TOOLS.md) · recipes: [docs/WORKFLOWS.md](docs/WORKFLOWS.md) · agent rules: [AGENTS.md](AGENTS.md)

## Quick start (local / Cursor)

```bash
cd mcp_supremacy
npm install
npx playwright install chromium
cp .env.example .env
# optional: S1914_USERNAME + S1914_PASSWORD (in-game name, not email)
npm start
```

Cursor MCP config:

```json
{
  "mcpServers": {
    "supremacy1914": {
      "command": "npx",
      "args": ["tsx", "src/index.ts"],
      "cwd": "/absolute/path/to/s1914-automation/mcp_supremacy",
      "env": {
        "S1914_MCP_WRITES": "0"
      }
    }
  }
}
```

From the repo root: `npm run mcp:supremacy`.

## First agent calls

```text
1. ensure_ready { "gameId": <your joined map id> }   # or list_games first
2. get_war_picture / get_own_armies / get_resources
3. Writes only when S1914_MCP_WRITES=1 and confirm: true
```

Never invent map coordinates — use capitals / army `pos` from tools.

## HTTP API (ChatGPT / remote)

```bash
npm run start:http
# or Docker — see docs/DEPLOY.md
```

| Endpoint | Auth | Purpose |
|---|---|---|
| `GET /health` | no | liveness |
| `GET /mcp/tools` | Bearer | list tools |
| `POST /mcp/call` | Bearer | `{ "name", "arguments" }` |
| `POST /mcp` | Bearer | JSON-RPC `tools/list` / `tools/call` |
| `GET /openapi.json` | Bearer | OpenAPI for Custom GPT Actions |

Set `S1914_MCP_TOKEN` (min 16 chars). Example:

```bash
export TOKEN=…   # from .env
export GAME_ID=… # your map id
curl -s -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"ensure_ready\",\"arguments\":{\"gameId\":$GAME_ID}}" \
  http://127.0.0.1:8787/mcp/call
```

### ChatGPT

1. Deploy HTTP (local or Docker + tunnel).
2. Custom GPT → Actions → import `https://YOUR_HOST/openapi.json`.
3. Auth: Bearer = `S1914_MCP_TOKEN`.
4. First call: `ensure_ready` with your `gameId`.

## Docker

```bash
cp .env.production.example .env.production
# fill S1914_MCP_TOKEN, login, optional S1914_PUBLIC_BASE_URL
npm run docker:up
curl -s http://127.0.0.1:8789/health
```

Public HTTPS: copy `deploy/cloudflared/config.yml.example` → `config.yml`, add credentials, then `npm run docker:up:tunnel`. Details: [docs/DEPLOY.md](docs/DEPLOY.md).

## Safety

- Default **writes off** (`S1914_MCP_WRITES=0`)
- Mutating tools require `"confirm": true`
- HTTP defaults to `127.0.0.1` — do not expose without a strong token
- One Chromium profile ≈ a full Ultimate client (plan ~2–3 GB RAM in Docker)
- Respect [Supremacy 1914](https://www.supremacy1914.com/) terms of service and fair play

## Env

See [`.env.example`](.env.example) and [`.env.production.example`](.env.production.example).

## Disclaimer

Unofficial community tooling. Not affiliated with Bytro Labs or Supremacy 1914. Use on your own account at your own risk.
