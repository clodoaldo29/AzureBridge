# ========================================
# STAGE 1: Build
# ========================================
FROM node:20-alpine AS builder

# Install dependencies for native modules
RUN apk add --no-cache python3 make g++ openssl1.1-compat

WORKDIR /app

# Copy package files and prisma schema
COPY package*.json ./
COPY prisma ./prisma/

# Install ALL dependencies (including devDependencies needed for TypeScript build)
RUN npm install && \
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
FROM node:20-alpine

# Add non-root user
RUN apk add --no-cache openssl1.1-compat && \
  addgroup -g 1001 -S nodejs && \
  adduser -S nodejs -u 1001

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
HEALTHCHECK --interval=30s --timeout=3s --start-period=60s \
  CMD wget --quiet --tries=1 --spider http://localhost:3001/ || exit 1

# Environment
ENV NODE_ENV=production

# Start the application
CMD ["node", "dist/server.js"]
