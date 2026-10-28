# Supremacy 1914 — War Cabinet & MCP

[![GitHub stars](https://img.shields.io/github/stars/DeGanLabs/supremacy1914-mcp?style=flat&logo=github)](https://github.com/DeGanLabs/supremacy1914-mcp/stargazers)
[![GitHub forks](https://img.shields.io/github/forks/DeGanLabs/supremacy1914-mcp?style=flat&logo=github)](https://github.com/DeGanLabs/supremacy1914-mcp/network/members)
[![GitHub issues](https://img.shields.io/github/issues/DeGanLabs/supremacy1914-mcp)](https://github.com/DeGanLabs/supremacy1914-mcp/issues)
[![License: MIT](https://img.shields.io/github/license/DeGanLabs/supremacy1914-mcp)](LICENSE)
[![GitHub last commit](https://img.shields.io/github/last-commit/DeGanLabs/supremacy1914-mcp)](https://github.com/DeGanLabs/supremacy1914-mcp/commits/main)

[![Node.js ≥20](https://img.shields.io/badge/node-%3E%3D20-brightgreen?logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![MCP](https://img.shields.io/badge/MCP-Model%20Context%20Protocol-111111)](https://modelcontextprotocol.io)
[![Playwright](https://img.shields.io/badge/browser-Playwright-45ba4b?logo=playwright&logoColor=white)](https://playwright.dev)
[![Docker](https://img.shields.io/badge/Docker-ready-2496ED?logo=docker&logoColor=white)](mcp_supremacy/docs/DEPLOY.md)
[![Cursor](https://img.shields.io/badge/Cursor-MCP-000000)](mcp_supremacy/README.md)
[![ChatGPT](https://img.shields.io/badge/ChatGPT-HTTP%20tools-10A37F?logo=openai&logoColor=white)](mcp_supremacy/README.md)
[![Org](https://img.shields.io/badge/org-DeGanLabs-0A0A0A?logo=github)](https://github.com/DeGanLabs)

[![Unofficial](https://img.shields.io/badge/status-unofficial-important)](#disclaimer)
[![Self-play](https://img.shields.io/badge/use-self--play%20%2F%20own%20account-informational)](#the-vision)
[![Writes default OFF](https://img.shields.io/badge/writes-default%20OFF-success)](#safety--fair-play)
[![Not affiliated](https://img.shields.io/badge/Bytro%20%2F%20Stillfront-not%20affiliated-lightgrey)](#disclaimer)

---

## The vision

We already **play Supremacy 1914 ourselves** — real maps, real decisions, fog of war.

This repo is the sketch of something we kept wishing the game *felt* like:

> **A living war cabinet.**  
> For every map, you are the president (or monarch). Ministers brief you. Finance argues with War. Foreign reads the room. You approve the order — or send them back to think again.  
> Not a silent spreadsheet. Something **interactive** — a staff that talks with you about *your* country.

So we built experiments toward that dream:

| Piece | Feeling |
|---|---|
| **MCP (`mcp_supremacy`)** | An AI aide that can *see* your live Ultimate client (armies, provinces, economy) and help you think |
| **Cabinet (`src/cabinet`)** | Telegram ministers with seats, debate, and an approve gate — like a war room chat |
| **Library (`src/`)** | Building blocks so the “cabinet” can read state and (only if you allow) carry out what you confirmed |

This is a **player vision / prototype**, not an official Bytro or Stillfront feature. We are not offering a hosted “win the game for you” service.

---

## ClawHub (OpenClaw)

Install the skill / plugin from ClawHub, then self-host the game MCP locally:

```bash
# Skill (cabinet playbook)
openclaw skills install supremacy1914-cabinet
# or: clawhub install supremacy1914-cabinet

# Plugin bundle (skill + MCP pointer to local HTTP)
openclaw plugins install clawhub:@deganlabs/supremacy1914-mcp
```

- Skill: https://clawhub.ai/gan12003/skills/supremacy1914-cabinet  
- Plugin: https://clawhub.ai/deganlabs/plugins/supremacy1914-mcp  

Then run `mcp_supremacy` on `127.0.0.1:8789` (see below). For loopback without Bearer headers in the bundle, set `S1914_MCP_ALLOW_ANON=1` in `.env.production` (local only).

---

## Start here: self-hosted MCP

Run tools against **your** browser session. Cursor, ChatGPT, or any MCP client can sit in as that interactive aide.

| Doc | Why |
|---|---|
| **[mcp_supremacy/README.md](mcp_supremacy/README.md)** | Install, Cursor, HTTP / ChatGPT, Docker |
| **[mcp_supremacy/AGENTS.md](mcp_supremacy/AGENTS.md)** | How the “aide” should behave |
| **[mcp_supremacy/docs/TOOLS.md](mcp_supremacy/docs/TOOLS.md)** | Tool list |
| **[mcp_supremacy/docs/WORKFLOWS.md](mcp_supremacy/docs/WORKFLOWS.md)** | Recipes |
| **[mcp_supremacy/docs/DEPLOY.md](mcp_supremacy/docs/DEPLOY.md)** | Self-host Docker + optional tunnel |

```bash
cd mcp_supremacy
npm install && npx playwright install chromium
cp .env.example .env
npm start                  # stdio MCP (Cursor)
# npm run start:http       # HTTP for ChatGPT / remote
# npm run docker:up        # 127.0.0.1:8789
```

```text
ensure_ready { gameId }
  → briefing: war picture / resources / armies
  → you decide
  → optional writes only with S1914_MCP_WRITES=1 and confirm: true
```

No game IDs or passwords hardcoded — your env, your maps (`list_games`).

---

## Also in this repo

| Path | Role in the vision |
|---|---|
| `src/cabinet/` | Approve-gated Telegram “ministers” (president + cabinet feel) |
| `src/` | State readers + signed action builders |
| `src/examples/` | Browser console bridge helpers |

```bash
npm run typecheck
npm run mcp:supremacy
npm run cabinet          # needs .env — see .env.example
```

---

## Layout

```
mcp_supremacy/     # interactive MCP aide (start here)
src/
  cabinet/         # Telegram war cabinet experiment
  types/ actions/ state/ services/
  examples/
```

---

## Safety & fair play

- Defaults: **writes off**, HTTP on **loopback**, mutating tools need `confirm: true`
- Intended for **self-play on your own account** — you stay responsible for what gets clicked
- Never commit `.env`, browser `data/`, or tunnel credentials
- One Ultimate client ≈ **2–3 GB RAM** in Docker
- Respect [Supremacy 1914 Terms of Service](https://www.supremacy1914.com/index.php?id=274) and fair play. Unauthorized scripts may violate ToS and risk your game account.

---

## Disclaimer

**Unofficial.** Not affiliated with Bytro Labs, Stillfront Supremacy GmbH, Twin Harbour Interactive, or Supremacy 1914.  
Game names and trademarks belong to their owners. This project is a personal / DeGanLabs experiment toward a more interactive “cabinet & president” fantasy while we play the game ourselves.

---

## Contributing

Issues and PRs welcome at [DeGanLabs/supremacy1914-mcp](https://github.com/DeGanLabs/supremacy1914-mcp). Keep secrets out of the tree. MCP tool changes → update `mcp_supremacy/docs/TOOLS.md`.

---

## License

[MIT](LICENSE) © DeGanLabs
