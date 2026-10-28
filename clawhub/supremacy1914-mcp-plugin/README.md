# supremacy1914-mcp (ClawHub plugin)

Agent Plugins bundle for [OpenClaw](https://docs.openclaw.ai/) / ClawHub.

## What this is

A **self-play** vision: treat each Supremacy 1914 map like you have a living war cabinet — you are the president; the MCP aide briefs and acts only when you allow writes.

Source: https://github.com/DeGanLabs/supremacy1914-mcp  
Unofficial. Not affiliated with Bytro / Stillfront.

## How users make it work

### A. Run the game MCP (required)

The plugin’s `mcp.json` points at **your local** HTTP MCP:

`http://127.0.0.1:8789/mcp`

```bash
git clone https://github.com/DeGanLabs/supremacy1914-mcp.git
cd supremacy1914-mcp/mcp_supremacy
cp .env.production.example .env.production
# S1914_MCP_TOKEN=…   # still set a token for the API
# For local loopback OpenClaw → MCP without Bearer headers in mcp.json:
# S1914_MCP_ALLOW_ANON=1
# S1914_MCP_REQUIRE_TOKEN=0
npm run docker:up
curl -s http://127.0.0.1:8789/health
```

Keep writes off until you trust the agent: `S1914_MCP_WRITES=0`.

### B. Install this plugin

```bash
openclaw plugins install clawhub:supremacy1914-mcp
# or from a local folder:
openclaw plugins install ./clawhub/supremacy1914-mcp-plugin
```

Also installs the embedded skill under `skills/supremacy1914-cabinet/`.

### C. First session

```text
ensure_ready { gameId }
→ get_war_picture / get_resources / get_own_armies
→ brief like a cabinet; confirm before writes
```

## Auth note

Agent Plugins `mcp.json` cannot carry secret Bearer headers. For local self-host, enable loopback anon (`S1914_MCP_ALLOW_ANON=1`) **or** configure OpenClaw MCP with your Bearer token via gateway config instead of this file.

Never expose `:8789` publicly without a strong token and tunnel controls.
