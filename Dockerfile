# The web app and pipeline. Pass secrets at run time (META_API_KEY, ELEVENLABS_API_KEY); never bake them in.
# Mount a volume at /srv/projects so videos and the spend ledger survive restarts.
FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg python3 python3-pil fonts-liberation ca-certificates \
    libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2 libpango-1.0-0 libcairo2 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /srv
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
RUN node --input-type=module -e "import { ensureBrowser } from '@remotion/renderer'; await ensureBrowser();"
COPY . .
ENV HOST=0.0.0.0 PORT=8080 PROJECTS_DIR=/srv/projects BUDGET_USD=5 RENDER_CONCURRENCY=2
EXPOSE 8080
CMD ["node", "--experimental-strip-types", "app/server.ts"]
