# Production: Playwright base (Chromium + deps) + Xvfb for Ultimate client
# Must match package.json playwright version (browsers baked into this image)
FROM mcr.microsoft.com/playwright:v1.64.1-jammy

WORKDIR /app

ENV NODE_ENV=production \
    S1914_MCP_HTTP_HOST=0.0.0.0 \
    S1914_MCP_HTTP_PORT=8787 \
    S1914_MCP_HEADLESS=0 \
    S1914_MCP_PROFILE=/data/profile \
    DISPLAY=:99 \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
  && npm install tsx@4.19.3 --no-save

COPY src ./src
COPY scripts ./scripts
COPY AGENTS.md README.md ./
COPY docs ./docs

RUN mkdir -p /data/profile /data/shots \
  && printf '%s\n' \
    '#!/usr/bin/env bash' \
    'set -euo pipefail' \
    'rm -f /tmp/.X99-lock /tmp/.X11-unix/X99 || true' \
    'Xvfb :99 -screen 0 1920x1080x24 -ac >/tmp/xvfb.log 2>&1 &' \
    'sleep 1' \
    'if [ -x /app/node_modules/.bin/tsx ]; then' \
    '  exec /app/node_modules/.bin/tsx src/http.ts' \
    'fi' \
    'exec npx --yes tsx@4.19.3 src/http.ts' \
    > /app/docker-entrypoint.sh \
  && chmod +x /app/docker-entrypoint.sh

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:8787/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/app/docker-entrypoint.sh"]
