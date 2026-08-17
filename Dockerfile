FROM node:22-alpine AS base
RUN apk add --no-cache openssl
RUN npm install -g pnpm@10
WORKDIR /repo

# ── deps: install with frozen lockfile (cached layer) ──────────────────────
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api-gateway/package.json ./apps/api-gateway/package.json
COPY apps/auth-service/package.json ./apps/auth-service/package.json
COPY apps/job-service/package.json ./apps/job-service/package.json
COPY apps/worker/package.json ./apps/worker/package.json
COPY packages/database/package.json ./packages/database/package.json
RUN pnpm install --frozen-lockfile

# ── migrator: runs prisma migrate deploy and exits ─────────────────────────
FROM deps AS migrator
COPY packages/database/prisma ./packages/database/prisma
CMD ["pnpm", "--filter", "@jqs/database", "exec", "prisma", "migrate", "deploy"]

# ── build: generate Prisma client + compile the target service ──────────────
FROM deps AS build
ARG APP_NAME
COPY . .
RUN pnpm --filter @jqs/database generate
RUN pnpm --filter @jqs/database build
RUN pnpm --filter @jqs/${APP_NAME} build
RUN pnpm --filter @jqs/${APP_NAME} deploy --prod --legacy /out

# ── runtime: minimal image with only production artefacts ──────────────────
FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out .
CMD ["node", "dist/main.js"]
