# Deploy mcp-supremacy (self-host)

Run the Supremacy 1914 MCP on your machine with Docker. Agents talk to a local HTTP port; optional Cloudflare Tunnel adds public HTTPS.

```text
Cursor / ChatGPT / custom agents
        │
   (optional) Cloudflare Tunnel → https://mcp.example.com
        │
   127.0.0.1:8789 → container :8787  (Node MCP + Xvfb + Chromium)
```

## Safety

- Always scope Compose: `docker compose -p mcp_supremacy ...`
- Never run unscoped `docker compose down`, or host-wide prune, on a shared machine
- Bind HTTP to **loopback only**; put a strong `S1914_MCP_TOKEN` in front of any public URL
- Do not commit `.env.production`, `credentials.json`, or a filled `config.yml`

## Secrets

```bash
cd mcp_supremacy
cp .env.production.example .env.production
# set S1914_MCP_TOKEN (openssl rand -hex 32)
# set S1914_USERNAME + S1914_PASSWORD (in-game player name, not email)
# set S1914_PUBLIC_BASE_URL to your public URL if you tunnel
```

## Start / stop (local only)

```bash
docker compose -p mcp_supremacy --env-file .env.production up -d --build
docker compose -p mcp_supremacy --env-file .env.production stop
```

Check:

```bash
curl -s http://127.0.0.1:8789/health
```

## Optional: Cloudflare Tunnel

1. Create a tunnel and DNS route for a hostname you control (`mcp.example.com`).
2. Copy [deploy/cloudflared/config.yml.example](../deploy/cloudflared/config.yml.example) → `config.yml` and fill tunnel UUID + hostname.
3. Place `credentials.json` next to it (gitignored).
4. Start with the tunnel profile:

```bash
docker compose -p mcp_supremacy --env-file .env.production --profile tunnel up -d --build
```

5. Set `S1914_PUBLIC_BASE_URL=https://mcp.example.com` in `.env.production` and recreate the `mcp` service.

Tunnel hostnames must be **proxied DNS** on the same Cloudflare account as the tunnel credentials.

## Resources

Default Compose limits: ~3 GB RAM / 2 CPUs for Chromium + Ultimate client, plus a small tunnel sidecar. Lower `mem_limit` only after you confirm the game client stays stable.
