# ========================================
# STAGE 1: Build
# ========================================
FROM node:20-bookworm-slim AS builder

# Install dependencies for native modules
RUN apt-get update && apt-get install -y --no-install-recommends \
  python3 make g++ openssl ca-certificates && \
  rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files and prisma schema
COPY package*.json ./
COPY prisma ./prisma/

# Install ALL dependencies (including devDependencies needed for TypeScript build)
RUN npm ci && \
  npm cache clean --force

# Copy source code
COPY . .

# Generate Prisma Client and build
RUN npx prisma generate
RUN npm run build

# Install production dependencies only for final image
RUN npm prune --production

# ========================================
# STAGE 2: Production
# ========================================
FROM node:20-bookworm-slim

# Add non-root user
RUN apt-get update && apt-get install -y --no-install-recommends \
  openssl curl ca-certificates && \
  rm -rf /var/lib/apt/lists/* && \
  groupadd -g 1001 nodejs && \
  useradd -u 1001 -g nodejs -m -s /usr/sbin/nologin nodejs

WORKDIR /app

# Copy built application
COPY --from=builder --chown=nodejs:nodejs /app/dist ./dist
COPY --from=builder --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nodejs:nodejs /app/package*.json ./
COPY --from=builder --chown=nodejs:nodejs /app/prisma ./prisma

# Switch to non-root user
USER nodejs

# Expose port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=90s \
  CMD curl -fsS http://localhost:3001/api/health >/dev/null || exit 1

# Environment
ENV NODE_ENV=production

# Start the application
CMD ["node", "dist/server.js"]
