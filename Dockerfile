# -----------------------------------------------------------------------------
# Stage 1: Build client and server artifacts
# -----------------------------------------------------------------------------
FROM node:24-alpine AS builder

WORKDIR /app

# Enable pnpm via corepack
RUN corepack enable && corepack prepare pnpm@12.8.1 --activate

# Copy manifest and lockfile
COPY package.json pnpm-lock.yaml ./
COPY prisma ./prisma/
COPY prisma.config.ts ./

# Install all dependencies (including devDependencies needed for build)
RUN pnpm install --frozen-lockfile --prod=false

# Copy source code and configs
COPY tsconfig.json tsconfig.base.json tsconfig.client.json tsconfig.server.json ./
COPY vite.config.ts ./
COPY index.html ./
COPY src ./src/

# Generate prisma client and build client + server
RUN pnpm build

# -----------------------------------------------------------------------------
# Stage 2: Production runtime
# -----------------------------------------------------------------------------
FROM node:24-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Enable pnpm
RUN corepack enable && corepack prepare pnpm@12.8.1 --activate

# Create non-root user bunty
RUN addgroup -g 10001 -S bunty && \
    adduser -u 10001 -S bunty -G bunty

# Copy dependency specifications and prisma schema
COPY package.json pnpm-lock.yaml ./
COPY prisma ./prisma/
COPY prisma.config.ts ./

# Install production dependencies only
RUN pnpm install --frozen-lockfile --prod

# Copy compiled artifacts and generated prisma client from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src/server/generated ./src/server/generated

# Set ownership to non-root user
RUN chown -R bunty:bunty /app

USER bunty

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://localhost:' + (process.env.PORT || 3000) + '/api/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

CMD ["node", "dist/node/src/server/index.js"]
