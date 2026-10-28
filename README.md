# Supremacy 1914 automation & MCP

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js ≥20](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6)](https://www.typescriptlang.org/)
[![MCP](https://img.shields.io/badge/MCP-Supremacy%201914-111111)](mcp_supremacy/README.md)
[![Docker](https://img.shields.io/badge/Docker-ready-2496ED)](mcp_supremacy/docs/DEPLOY.md)
[![Org](https://img.shields.io/badge/org-DeGanLabs-0A0A0A)](https://github.com/DeGanLabs)

**Unofficial tools for [Supremacy 1914](https://www.supremacy1914.com/) players** — run an MCP server against *your* Ultimate client so Cursor, ChatGPT, or custom agents can read the map, economy, and armies, then act only when you allow writes.

> Search / SEO: Supremacy 1914 MCP · S1914 bot · Supremacy 1914 AI advisor · Bytro Ultimate automation · ChatGPT plugin for Supremacy · Cursor MCP game tools

Not affiliated with Bytro Labs. Use on your own account; respect the game ToS and fair play.

---

## Start here: player MCP (`mcp_supremacy`)

Self-hosted **Model Context Protocol** server: Playwright + Chromium + live `#ifm` / `hup` helpers.

| Doc | Why |
|---|---|
| **[mcp_supremacy/README.md](mcp_supremacy/README.md)** | Install, Cursor config, HTTP / ChatGPT, Docker |
| **[mcp_supremacy/AGENTS.md](mcp_supremacy/AGENTS.md)** | Rules agents must follow |
| **[mcp_supremacy/docs/TOOLS.md](mcp_supremacy/docs/TOOLS.md)** | Full tool list |
| **[mcp_supremacy/docs/WORKFLOWS.md](mcp_supremacy/docs/WORKFLOWS.md)** | Move, build, gather, attack recipes |
| **[mcp_supremacy/docs/DEPLOY.md](mcp_supremacy/docs/DEPLOY.md)** | Production Docker + optional tunnel |

```bash
cd mcp_supremacy
npm install && npx playwright install chromium
cp .env.example .env
npm start                  # stdio MCP for Cursor
# npm run start:http       # HTTP for ChatGPT / remote
# npm run docker:up        # container on 127.0.0.1:8789
```

**Typical agent flow**

```text
ensure_ready { gameId }  →  get_war_picture / get_resources / get_own_armies
                         →  move_army { …, confirm: true }   # needs S1914_MCP_WRITES=1
```

No game IDs, passwords, or auth hashes are hardcoded — configure via env and `list_games`.

---

## Also in this repo

| Path | Purpose |
|---|---|
| `src/` | Modular TypeScript library — state readers + signed action builders |
| `src/cabinet/` | Optional Telegram “war cabinet” (approve-gated advisors) |
| `src/examples/` | Browser console bridge helpers |

Root scripts: `npm run typecheck` · `npm run mcp:supremacy` · `npm run cabinet` (cabinet needs its own `.env` — see `.env.example`).

---

## Layout

```
mcp_supremacy/     # player-facing MCP (start here)
src/
  types/ actions/ state/ services/   # automation library
  cabinet/ sensor/                   # optional Telegram cabinet
  examples/                          # DevTools helpers
```

---

## Safety & privacy

- Defaults: **writes off**, HTTP on **loopback**, mutating tools need `confirm: true`
- Never commit `.env`, `.env.production`, browser `data/`, or Cloudflare credentials
- Do not paste real `userAuth` / passwords into issues or chats
- One live Ultimate client ≈ **2–3 GB RAM** in Docker — plan host capacity accordingly

---

## Contributing

Issues and PRs welcome under [DeGanLabs](https://github.com/DeGanLabs). Keep secrets out of the tree; prefer env + examples. For MCP tool changes, update `mcp_supremacy/docs/TOOLS.md`.

---

## License

[MIT](LICENSE) © DeGanLabs
