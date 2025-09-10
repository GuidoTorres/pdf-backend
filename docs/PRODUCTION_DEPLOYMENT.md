# Production Deployment Guide

This guide covers the deployment and monitoring of the PDF Processing System in production environments.

## Overview

The production system includes:

- **Scalable PDF Processing**: Multiple workers with auto-scaling
- **Health Monitoring**: Automated health checks and restart capabilities
- **Structured Logging**: Comprehensive logging for debugging and monitoring
- **System Metrics**: CPU, memory, disk, and application metrics collection
- **Container Orchestration**: Docker Compose with monitoring stack
- **Load Balancing**: Nginx reverse proxy with rate limiting

## Quick Start

### Prerequisites

- Docker and Docker Compose
- At least 4GB RAM and 2 CPU cores
- 10GB free disk space

### Deploy

```bash
# Clone and navigate to project
cd backend

# Deploy the complete system
npm run deploy

# Check system status
npm run deploy:status

# Monitor system health
npm run monitor
```

## Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│     Nginx       │    │  PDF Processor  │    │     Redis       │
│  Load Balancer  │────│   Application   │────│     Queue       │
│                 │    │                 │    │                 │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         │              ┌─────────────────┐              │
         │              │     MySQL       │              │
         └──────────────│    Database     │──────────────┘
                        │                 │
                        └─────────────────┘
                                 │
                        ┌─────────────────┐
                        │   Monitoring    │
                        │  Prometheus     │
                        │   Grafana       │
                        │   Kibana        │
                        └─────────────────┘
```

## Services

### Core Services

1. **PDF Processor** (`pdf-processor`)

   - Main application with cluster management
   - Auto-scaling workers (5-15 instances)
   - Health checks and metrics collection
   - Ports: 3000 (API), 8080 (Health), 9090 (Metrics)

2. **Redis** (`redis`)

   - Queue management and caching
   - Port: 6379

3. **MySQL** (`mysql`)

   - Primary database
   - Port: 3306

4. **Nginx** (`nginx`)
   - Reverse proxy and load balancer
   - SSL termination (when configured)
   - Rate limiting
   - Ports: 80, 443

### Monitoring Services

5. **Prometheus** (`prometheus`)

   - Metrics collection and alerting
   - Port: 9091

6. **Grafana** (`grafana`)

   - Metrics visualization
   - Port: 3001
   - Default login: admin/admin

7. **Elasticsearch** (`elasticsearch`)

   - Log storage and indexing
   - Port: 9200

8. **Kibana** (`kibana`)

   - Log visualization and analysis
   - Port: 5601

9. **Fluentd** (`fluentd`)
   - Log aggregation and forwarding
   - Port: 24224

## Deployment Commands

### Basic Deployment

```bash
# Deploy complete system
./scripts/deploy.sh deploy

# Check deployment status
./scripts/deploy.sh status

# View logs
./scripts/deploy.sh logs

# Restart specific service
./scripts/deploy.sh restart pdf-processor
```

### Rollback

```bash
# Rollback to previous version
./scripts/deploy.sh rollback

# Or using npm script
npm run deploy:rollback
```

### Backup and Restore

```bash
# Create backup
./scripts/deploy.sh backup

# Cleanup old backups
./scripts/deploy.sh cleanup
```

## Monitoring

### Health Checks

The system provides multiple health check endpoints:

- **Application Health**: `http://localhost:8080/health`
- **Detailed Status**: `http://localhost:8080/status`
- **Metrics**: `http://localhost:9090/metrics`

### Monitoring Commands

```bash
# Show current system status
npm run monitor

# Start continuous monitoring
npm run monitor:continuous

# Check application health only
npm run monitor:health

# View recent alerts
./scripts/monitor.sh alerts
```

### Monitoring Dashboard URLs

- **Grafana**: http://localhost:3001 (admin/admin)
- **Prometheus**: http://localhost:9091
- **Kibana**: http://localhost:5601
- **Application Metrics**: http://localhost:9090

## Configuration

### Environment Variables

Key production environment variables in `.env.production`:

```bash
# Cluster Configuration
MIN_WORKERS=5
MAX_WORKERS=15

# Resource Limits
MAX_MEMORY_MB=2048
MAX_CPU_PERCENT=80

# Logging
LOG_LEVEL=info
LOG_DIR=/app/logs

# Database
DATABASE_URL=mysql://user:password@mysql:3306/pdf_processing
REDIS_URL=redis://redis:6379
```

### Scaling Configuration

Adjust worker scaling in the production startup script:

```javascript
// In scripts/production-start.js
const PRODUCTION_CONFIG = {
  minWorkers: parseInt(process.env.MIN_WORKERS) || 5,
  maxWorkers: parseInt(process.env.MAX_WORKERS) || 15,
  // ... other config
};
```

## Logging

### Log Files

Logs are stored in the `logs/` directory:

- `application.log` - General application logs
- `error.log` - Error logs only
- `access.log` - HTTP request logs
- `performance.log` - Performance metrics
- `security.log` - Security events
- `monitoring.log` - System monitoring logs
- `alerts.log` - System alerts

### Log Rotation

Logs are automatically rotated when they exceed 10MB, keeping the last 10 files.

### Viewing Logs

```bash
# View application logs
docker-compose -f docker-compose.production.yml logs -f pdf-processor

# View all logs
npm run logs:production

# View specific log file
tail -f logs/application.log
```

## Performance Tuning

### Resource Allocation

Adjust Docker resource limits in `docker-compose.production.yml`:

```yaml
deploy:
  resources:
    limits:
      memory: 2G
      cpus: "2.0"
    reservations:
      memory: 1G
      cpus: "1.0"
```

### Worker Scaling

The system automatically scales workers based on:

- Queue length
- CPU usage
- Memory usage
- Response times

Manual scaling:

```bash
# Scale to specific number of workers
curl -X POST http://localhost:8080/scale -d '{"workers": 10}'
```

## Security

### Network Security

- All services run in isolated Docker network
- Nginx handles SSL termination
- Rate limiting on API endpoints
- Internal service communication only

### Application Security

- JWT token authentication
- Input validation and sanitization
- File upload restrictions
- SQL injection protection

### Monitoring Security

- Metrics endpoints restricted to internal networks
- Health check endpoints publicly accessible
- Admin interfaces password protected

## Troubleshooting

### Common Issues

1. **High Memory Usage**

   ```bash
   # Check memory usage
   ./scripts/monitor.sh resources

   # Scale down workers if needed
   curl -X POST http://localhost:8080/scale -d '{"workers": 3}'
   ```

2. **Application Not Responding**

   ```bash
   # Check health
   curl http://localhost:8080/health

   # Restart application
   ./scripts/deploy.sh restart pdf-processor
   ```

3. **Database Connection Issues**

   ```bash
   # Check database status
   docker-compose -f docker-compose.production.yml ps mysql

   # View database logs
   docker-compose -f docker-compose.production.yml logs mysql
   ```

4. **Queue Backup**

   ```bash
   # Check queue status
   curl http://localhost:9090/metrics | grep queue

   # Clear failed jobs
   docker-compose -f docker-compose.production.yml exec redis redis-cli FLUSHDB
   ```

### Log Analysis

```bash
# Search for errors in the last hour
grep "$(date -v-1H '+%Y-%m-%d %H')" logs/error.log

# Count errors by type
grep -o '"error":"[^"]*"' logs/application.log | sort | uniq -c

# Monitor real-time errors
tail -f logs/error.log | grep ERROR
```

### Performance Analysis

```bash
# Check response times
grep "responseTime" logs/performance.log | tail -20

# Monitor memory usage
./scripts/monitor.sh resources

# Check worker performance
curl http://localhost:9090/metrics | grep worker
```

## Maintenance

### Regular Maintenance Tasks

1. **Log Cleanup** (Weekly)

   ```bash
   # Clean logs older than 30 days
   find logs/ -name "*.log*" -mtime +30 -delete
   ```

2. **Backup** (Daily)

   ```bash
   # Automated backup
   ./scripts/deploy.sh backup
   ```

3. **Health Check** (Continuous)

   ```bash
   # Automated monitoring
   ./scripts/monitor.sh monitor 300  # Every 5 minutes
   ```

4. **Update Dependencies** (Monthly)
   ```bash
   # Update Docker images
   docker-compose -f docker-compose.production.yml pull
   ./scripts/deploy.sh deploy
   ```

### Scaling Guidelines

- **CPU > 80%**: Scale up workers
- **Memory > 85%**: Scale down or optimize
- **Queue length > 50**: Scale up workers
- **Response time > 5s**: Investigate performance issues

## Support

For production support:

1. Check system status: `npm run monitor`
2. Review logs: `tail -f logs/error.log`
3. Check metrics: http://localhost:9090/metrics
4. Review alerts: `./scripts/monitor.sh alerts`

## Updates

To update the production system:

1. Test changes in development
2. Create backup: `./scripts/deploy.sh backup`
3. Deploy update: `./scripts/deploy.sh deploy`
4. Verify health: `npm run monitor:health`
5. Rollback if needed: `./scripts/deploy.sh rollback`
