# Build context esperado: raiz del monorepo (ver infra/docker-compose.yml)
FROM node:22-alpine AS builder
WORKDIR /app
RUN apk add --no-cache openssl
RUN corepack enable && corepack prepare pnpm@11.18.0 --activate

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc tsconfig.base.json ./
COPY scripts scripts
COPY packages/shared/package.json packages/shared/package.json
COPY apps/api/package.json apps/api/package.json

RUN pnpm install --frozen-lockfile --filter @pollos/shared --filter @pollos/api

COPY packages/shared packages/shared
COPY apps/api apps/api

RUN pnpm --filter @pollos/shared build
RUN pnpm --filter @pollos/api prisma:generate
RUN pnpm --filter @pollos/api build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# postgresql-client trae pg_dump, usado por el backup automatico diario (ver
# modules/backup/backupService.ts). BACKUP_DIR deberia apuntar a un volumen persistente.
# openssl lo requiere el motor de Prisma para conectar a la base de datos.
RUN apk add --no-cache postgresql16-client openssl

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/packages/shared ./packages/shared
COPY --from=builder /app/apps/api ./apps/api

RUN mkdir -p /app/backups && chown -R node:node /app
USER node

WORKDIR /app/apps/api
EXPOSE 4000
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]
