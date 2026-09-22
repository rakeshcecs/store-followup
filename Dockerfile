# Production images. Build one target at a time:
#   docker build --target web     -t followup-web .
#   docker build --target worker  -t followup-worker .
#   docker build --target migrate -t followup-migrate .   (run once per release, before web/worker)
# DATABASE_URL is passed at runtime (docker run -e DATABASE_URL=...), never baked in.

FROM node:22-slim AS base
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

# All dependencies (postinstall runs `prisma generate`, which needs the schema).
FROM base AS deps
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci

FROM deps AS build
COPY . .
RUN npm run build

# Applies pending migrations: docker run --rm -e DATABASE_URL=... followup-migrate
FROM build AS migrate
CMD ["npx", "prisma", "migrate", "deploy"]

# Background worker: needs production node_modules (tsx, node-cron, Prisma client) and the source.
FROM base AS worker
ENV NODE_ENV=production
COPY package.json package-lock.json ./
# --ignore-scripts: the generated Prisma client comes from the build stage (src/generated).
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /app/src ./src
COPY --from=build /app/worker ./worker
COPY --from=build /app/tsconfig.json ./
USER node
CMD ["node_modules/.bin/tsx", "worker/index.ts"]

# Web app: Next.js standalone server only.
FROM base AS web
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
