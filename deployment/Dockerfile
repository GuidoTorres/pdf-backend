# Production Dockerfile for PDF Processing System
# Multi-stage build for optimized production image

# Build stage
FROM node:18-alpine AS builder

WORKDIR /app

# Install system dependencies for Python and native modules
RUN apk add --no-cache \
    python3 \
    py3-pip \
    make \
    g++ \
    cairo-dev \
    jpeg-dev \
    pango-dev \
    musl-dev \
    ttf-freefont

# Copy package files
COPY package*.json ./
COPY requirements.txt ./

# Install Node.js dependencies
RUN npm ci --only=production

# Install Python dependencies
RUN pip3 install --no-cache-dir -r requirements.txt --target=./python_libs

# Production stage
FROM node:18-alpine AS production

# Install runtime dependencies
RUN apk add --no-cache \
    python3 \
    py3-pip \
    cairo \
    jpeg \
    pango \
    musl \
    ttf-freefont \
    dumb-init

# Create app user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

WORKDIR /app

# Copy built dependencies
COPY --from=builder --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nodejs:nodejs /app/python_libs ./python_libs

# Copy application code
COPY --chown=nodejs:nodejs . .

# Create logs directory
RUN mkdir -p logs && chown nodejs:nodejs logs

# Set environment variables
ENV NODE_ENV=production
ENV LOG_LEVEL=info
ENV LOG_DIR=/app/logs
ENV PYTHONPATH=/app/python_libs

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD node -e "fetch('http://localhost:' + (process.env.HEALTH_CHECK_PORT || 8080) + '/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

# Switch to non-root user
USER nodejs

# Expose ports
EXPOSE 3000 8080 9090

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Start the production system
CMD ["node", "scripts/production-start.js"]