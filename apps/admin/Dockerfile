# Build context esperado: raiz del monorepo (ver infra/docker-compose.yml)
FROM node:22-alpine AS builder
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.18.0 --activate

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc tsconfig.base.json ./
COPY scripts scripts
COPY packages/shared/package.json packages/shared/package.json
COPY apps/admin/package.json apps/admin/package.json

RUN pnpm install --frozen-lockfile --filter @pollos/shared --filter @pollos/admin

COPY packages/shared packages/shared
COPY apps/admin apps/admin

RUN pnpm --filter @pollos/shared build
RUN pnpm --filter @pollos/admin build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/packages/shared ./packages/shared
COPY --from=builder /app/apps/admin ./apps/admin

RUN chown -R node:node /app
USER node

WORKDIR /app/apps/admin
EXPOSE 3000
CMD ["npm", "run", "start"]
