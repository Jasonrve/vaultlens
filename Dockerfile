# -- Build stage --------------------------------------------
FROM node:22-alpine AS builder

WORKDIR /build

# Copy entire application source
COPY app/ ./

# Install dependencies (node:22-alpine ships with a working npm — do NOT upgrade globally)
RUN npm ci

# Build application
RUN npm run build

# -- Production stage --------------------------------------
FROM node:22-alpine

RUN addgroup -g 1001 -S vaultlens && \
    adduser -S vaultlens -u 1001 -G vaultlens

WORKDIR /app

# Copy package files from builder for production
COPY --from=builder /build/package.json /build/package-lock.json ./

# Install production dependencies only
RUN npm ci --omit=dev && npm cache clean --force

# Copy built application
COPY --from=builder /build/dist ./dist

RUN mkdir -p /app/data/logos /backups && \
    chown -R vaultlens:vaultlens /app /backups

USER vaultlens

ENV NODE_ENV=production
ENV PORT=3001
ENV VAULTLENS_BACKUP_PATH=/backups

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3001/api/health || exit 1

CMD ["node", "dist/server/server.js"]
