#!/bin/bash

# Production deployment script for PDF Processing System
# Handles deployment, health checks, and rollback procedures

set -e

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
DOCKER_COMPOSE_FILE="$PROJECT_DIR/docker-compose.production.yml"
BACKUP_DIR="$PROJECT_DIR/backups"
LOG_FILE="$PROJECT_DIR/logs/deployment.log"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging function
log() {
    echo -e "${BLUE}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} $1" | tee -a "$LOG_FILE"
}

error() {
    echo -e "${RED}[$(date +'%Y-%m-%d %H:%M:%S')] ERROR:${NC} $1" | tee -a "$LOG_FILE"
}

success() {
    echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')] SUCCESS:${NC} $1" | tee -a "$LOG_FILE"
}

warning() {
    echo -e "${YELLOW}[$(date +'%Y-%m-%d %H:%M:%S')] WARNING:${NC} $1" | tee -a "$LOG_FILE"
}

# Check prerequisites
check_prerequisites() {
    log "Checking prerequisites..."
    
    # Check if Docker is installed and running
    if ! command -v docker &> /dev/null; then
        error "Docker is not installed"
        exit 1
    fi
    
    if ! docker info &> /dev/null; then
        error "Docker is not running"
        exit 1
    fi
    
    # Check if Docker Compose is available
    if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
        error "Docker Compose is not installed"
        exit 1
    fi
    
    # Create necessary directories
    mkdir -p "$BACKUP_DIR"
    mkdir -p "$(dirname "$LOG_FILE")"
    
    success "Prerequisites check passed"
}

# Backup current deployment
backup_current_deployment() {
    log "Creating backup of current deployment..."
    
    local backup_timestamp=$(date +%Y%m%d_%H%M%S)
    local backup_path="$BACKUP_DIR/backup_$backup_timestamp"
    
    mkdir -p "$backup_path"
    
    # Backup database
    if docker-compose -f "$DOCKER_COMPOSE_FILE" ps mysql | grep -q "Up"; then
        log "Backing up MySQL database..."
        docker-compose -f "$DOCKER_COMPOSE_FILE" exec -T mysql mysqldump -u root -prootpassword pdf_processing > "$backup_path/database.sql"
    fi
    
    # Backup Redis data
    if docker-compose -f "$DOCKER_COMPOSE_FILE" ps redis | grep -q "Up"; then
        log "Backing up Redis data..."
        docker-compose -f "$DOCKER_COMPOSE_FILE" exec -T redis redis-cli BGSAVE
        sleep 5
        docker cp $(docker-compose -f "$DOCKER_COMPOSE_FILE" ps -q redis):/data/dump.rdb "$backup_path/redis_dump.rdb" || true
    fi
    
    # Backup logs
    if [ -d "$PROJECT_DIR/logs" ]; then
        log "Backing up logs..."
        cp -r "$PROJECT_DIR/logs" "$backup_path/"
    fi
    
    # Backup configuration files
    log "Backing up configuration files..."
    cp "$DOCKER_COMPOSE_FILE" "$backup_path/"
    cp -r "$PROJECT_DIR/nginx" "$backup_path/" || true
    cp -r "$PROJECT_DIR/monitoring" "$backup_path/" || true
    
    echo "$backup_timestamp" > "$BACKUP_DIR/latest_backup"
    
    success "Backup created at $backup_path"
}

# Health check function
health_check() {
    local max_attempts=30
    local attempt=1
    
    log "Performing health check..."
    
    while [ $attempt -le $max_attempts ]; do
        if curl -f -s http://localhost:8080/health > /dev/null; then
            success "Health check passed"
            return 0
        fi
        
        log "Health check attempt $attempt/$max_attempts failed, waiting 10 seconds..."
        sleep 10
        ((attempt++))
    done
    
    error "Health check failed after $max_attempts attempts"
    return 1
}

# Deploy function
deploy() {
    log "Starting deployment..."
    
    # Pull latest images
    log "Pulling latest Docker images..."
    docker-compose -f "$DOCKER_COMPOSE_FILE" pull
    
    # Build application image
    log "Building application image..."
    docker-compose -f "$DOCKER_COMPOSE_FILE" build pdf-processor
    
    # Stop current services gracefully
    log "Stopping current services..."
    docker-compose -f "$DOCKER_COMPOSE_FILE" down --timeout 30
    
    # Start infrastructure services first
    log "Starting infrastructure services..."
    docker-compose -f "$DOCKER_COMPOSE_FILE" up -d redis mysql elasticsearch
    
    # Wait for infrastructure to be ready
    log "Waiting for infrastructure services to be ready..."
    sleep 30
    
    # Start application services
    log "Starting application services..."
    docker-compose -f "$DOCKER_COMPOSE_FILE" up -d pdf-processor
    
    # Start monitoring services
    log "Starting monitoring services..."
    docker-compose -f "$DOCKER_COMPOSE_FILE" up -d prometheus grafana fluentd kibana
    
    # Start nginx last
    log "Starting nginx..."
    docker-compose -f "$DOCKER_COMPOSE_FILE" up -d nginx
    
    # Wait for services to stabilize
    log "Waiting for services to stabilize..."
    sleep 20
    
    success "Deployment completed"
}

# Rollback function
rollback() {
    local backup_timestamp
    
    if [ -f "$BACKUP_DIR/latest_backup" ]; then
        backup_timestamp=$(cat "$BACKUP_DIR/latest_backup")
    else
        error "No backup found for rollback"
        exit 1
    fi
    
    local backup_path="$BACKUP_DIR/backup_$backup_timestamp"
    
    if [ ! -d "$backup_path" ]; then
        error "Backup directory not found: $backup_path"
        exit 1
    fi
    
    warning "Starting rollback to backup: $backup_timestamp"
    
    # Stop current services
    log "Stopping current services..."
    docker-compose -f "$DOCKER_COMPOSE_FILE" down --timeout 30
    
    # Restore configuration files
    log "Restoring configuration files..."
    cp "$backup_path/docker-compose.production.yml" "$DOCKER_COMPOSE_FILE"
    
    # Start infrastructure services
    log "Starting infrastructure services..."
    docker-compose -f "$DOCKER_COMPOSE_FILE" up -d redis mysql
    
    # Wait for infrastructure
    sleep 30
    
    # Restore database
    if [ -f "$backup_path/database.sql" ]; then
        log "Restoring database..."
        docker-compose -f "$DOCKER_COMPOSE_FILE" exec -T mysql mysql -u root -prootpassword pdf_processing < "$backup_path/database.sql"
    fi
    
    # Restore Redis data
    if [ -f "$backup_path/redis_dump.rdb" ]; then
        log "Restoring Redis data..."
        docker cp "$backup_path/redis_dump.rdb" $(docker-compose -f "$DOCKER_COMPOSE_FILE" ps -q redis):/data/dump.rdb
        docker-compose -f "$DOCKER_COMPOSE_FILE" restart redis
    fi
    
    # Start application services
    log "Starting application services..."
    docker-compose -f "$DOCKER_COMPOSE_FILE" up -d
    
    success "Rollback completed"
}

# Cleanup old backups
cleanup_backups() {
    log "Cleaning up old backups..."
    
    # Keep only the last 5 backups
    local backup_count=$(ls -1 "$BACKUP_DIR" | grep "backup_" | wc -l)
    
    if [ $backup_count -gt 5 ]; then
        local backups_to_delete=$((backup_count - 5))
        ls -1t "$BACKUP_DIR" | grep "backup_" | tail -n $backups_to_delete | while read backup; do
            log "Removing old backup: $backup"
            rm -rf "$BACKUP_DIR/$backup"
        done
    fi
    
    success "Backup cleanup completed"
}

# Show system status
show_status() {
    log "System Status:"
    echo "=============="
    
    docker-compose -f "$DOCKER_COMPOSE_FILE" ps
    
    echo ""
    log "Service URLs:"
    echo "- Application: http://localhost:3000"
    echo "- Health Check: http://localhost:8080/health"
    echo "- Metrics: http://localhost:9090/metrics"
    echo "- Grafana: http://localhost:3001"
    echo "- Kibana: http://localhost:5601"
    echo "- Prometheus: http://localhost:9091"
}

# Main script logic
case "${1:-deploy}" in
    "deploy")
        check_prerequisites
        backup_current_deployment
        deploy
        if health_check; then
            cleanup_backups
            show_status
            success "Deployment successful!"
        else
            error "Deployment failed health check, initiating rollback..."
            rollback
            exit 1
        fi
        ;;
    
    "rollback")
        check_prerequisites
        rollback
        if health_check; then
            success "Rollback successful!"
        else
            error "Rollback failed health check"
            exit 1
        fi
        ;;
    
    "status")
        show_status
        ;;
    
    "health")
        health_check
        ;;
    
    "backup")
        check_prerequisites
        backup_current_deployment
        ;;
    
    "cleanup")
        cleanup_backups
        ;;
    
    "logs")
        docker-compose -f "$DOCKER_COMPOSE_FILE" logs -f "${2:-pdf-processor}"
        ;;
    
    "stop")
        log "Stopping all services..."
        docker-compose -f "$DOCKER_COMPOSE_FILE" down --timeout 30
        success "All services stopped"
        ;;
    
    "restart")
        log "Restarting services..."
        docker-compose -f "$DOCKER_COMPOSE_FILE" restart "${2:-}"
        success "Services restarted"
        ;;
    
    *)
        echo "Usage: $0 {deploy|rollback|status|health|backup|cleanup|logs|stop|restart}"
        echo ""
        echo "Commands:"
        echo "  deploy   - Deploy the application (default)"
        echo "  rollback - Rollback to the last backup"
        echo "  status   - Show system status"
        echo "  health   - Perform health check"
        echo "  backup   - Create a backup"
        echo "  cleanup  - Clean up old backups"
        echo "  logs     - Show logs (optionally specify service)"
        echo "  stop     - Stop all services"
        echo "  restart  - Restart services (optionally specify service)"
        exit 1
        ;;
esac