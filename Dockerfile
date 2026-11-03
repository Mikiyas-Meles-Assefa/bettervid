# The web app and the pipeline it runs. Pass secrets at run time (META_API_KEY, ELEVENLABS_API_KEY); never bake them in.
# Mount a volume at /srv/projects so videos, the waiting line and the spend ledger survive restarts.
FROM node:24-bookworm-slim
# ffmpeg cuts thumbnails and mixes sound; Python with Pillow and NumPy runs pipeline/tools; the rest is what headless
# Chrome needs to render with Remotion.
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg python3 python3-pil python3-numpy fonts-liberation ca-certificates \
    libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2 libpango-1.0-0 libcairo2 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /srv
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
RUN node --input-type=module -e "import { ensureBrowser } from '@remotion/renderer'; await ensureBrowser();"
COPY . .
ENV HOST=0.0.0.0 PORT=8080 PROJECTS_DIR=/srv/projects BUDGET_USD=5 RENDER_CONCURRENCY=2 PYTHON=python3
RUN mkdir -p /srv/projects
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/options').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "--experimental-strip-types", "app/server.ts"]
