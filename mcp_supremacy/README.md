# mcp-supremacy

[![License: MIT](https://img.shields.io/github/license/Pixel-Agents/supremacy1914-mcp)](../LICENSE)
[![Node.js ≥20](https://img.shields.io/badge/node-%3E%3D20-brightgreen?logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![Playwright](https://img.shields.io/badge/browser-Playwright-45ba4b?logo=playwright&logoColor=white)](https://playwright.dev)
[![MCP](https://img.shields.io/badge/protocol-MCP-111111)](https://modelcontextprotocol.io)
[![Docker](https://img.shields.io/badge/Docker-ready-2496ED?logo=docker&logoColor=white)](docs/DEPLOY.md)
[![Cursor](https://img.shields.io/badge/Cursor-stdio-000000)](#quick-start-local--cursor)
[![ChatGPT](https://img.shields.io/badge/ChatGPT-HTTP-10A37F?logo=openai&logoColor=white)](#http-api-chatgpt--remote)
[![Writes default OFF](https://img.shields.io/badge/writes-default%20OFF-success)](#safety)
[![Self-play](https://img.shields.io/badge/use-own%20account%20%2F%20self--play-informational)](#why-this-exists)
[![Unofficial](https://img.shields.io/badge/status-unofficial-important)](#disclaimer)

**Self-hosted MCP for your Supremacy 1914 session** — so an AI aide can sit with you like staff in a war cabinet: see the map, brief the “president,” and only move when you allow it.

Part of [Pixel-Agents/supremacy1914-mcp](https://github.com/Pixel-Agents/supremacy1914-mcp).

## Why this exists

We play the game ourselves. This package is a **vision prototype**: make each map feel interactive — not just clicking UI alone, but talking with a living staff that understands *your* provinces, armies, and economy.

It is **not** a hosted win-bot or multi-account service. One Playwright profile = one player account you control.

## What you get

| Capability | Examples |
|---|---|
| Session | `ensure_ready`, `login`, `list_games`, `health` |
| War / map | `get_war_picture`, `get_own_armies`, `get_relations` |
| Economy | `get_resources`, `get_finance_picture`, `get_provinces`, market tools |
| Actions | `move_army`, build / produce, heroes, diplomacy (needs writes + `confirm`) |
| Ops | `get_operations` (Hero Pass objectives & leveling notes) |

Full reference: [docs/TOOLS.md](docs/TOOLS.md) · recipes: [docs/WORKFLOWS.md](docs/WORKFLOWS.md) · agent rules: [AGENTS.md](AGENTS.md) · vision & cabinet: [../README.md](../README.md)

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
      "cwd": "/absolute/path/to/supremacy1914-mcp/mcp_supremacy",
      "env": {
        "S1914_MCP_WRITES": "0"
      }
    }
  }
}
```

From the repo root: `npm run mcp:supremacy`.

## First calls (interactive aide)

```text
1. ensure_ready { "gameId": <your joined map id> }   # or list_games first
2. get_war_picture / get_own_armies / get_resources   # briefing
3. You decide — writes only when S1914_MCP_WRITES=1 and confirm: true
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

Set `S1914_MCP_TOKEN`. Example:

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
- HTTP defaults to `127.0.0.1` — strong token if you ever expose it
- ~2–3 GB RAM for one Ultimate client in Docker
- Self-play / own account; you remain responsible for actions
- Read the [game ToS](https://www.supremacy1914.com/index.php?id=274) — unauthorized scripts can risk your account

## Env

See [`.env.example`](.env.example) and [`.env.production.example`](.env.production.example).

## Disclaimer

Unofficial community experiment. Not affiliated with Bytro Labs, Stillfront Supremacy GmbH, Twin Harbour Interactive, or Supremacy 1914. Built as a vision of interactive cabinet-style play while we play the game ourselves.
