# Financial Command Center

Vite + React UI for the S1914 Finance Map App.

## Run

1. Terminal A — engine + API (bridge optional; fixture works offline):

```bash
npm run finance:verify   # writes fixtures + unit checks
npm run finance:engine   # WS :8765 + API :8787
```

2. Game tab: paste `src/examples/browser-console.js`, then `s1914.connectCabinetBridge("ws://127.0.0.1:8765", TOKEN)` (token from `npm run finance:engine` / `npm run cabinet`).

3. Terminal B — UI:

```bash
npm run finance:map
```

Open http://127.0.0.1:5173 — proxies `/api` to `:8787`.

Cabinet (`npm run cabinet`) also starts finance watch + API when `FINANCE_WATCH` is not `0`.

## Features (FCC-1…4)

- Health / data quality / bottleneck strip
- Failures + threats, rankings, Finance Brief
- Map layers: RESOURCE, MORALE, FAILURE, EFFICIENCY, CAPITAL, FORECAST, WAR_ECONOMY, MARKET
- Province decision card (what / wrong / do) + Approve build
- Modes: economy | warEconomy | emergency
- Market + embargo panel, portfolio table, 24h what-if simulator
- War pressure from `war-demand.json`
