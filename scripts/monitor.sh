#!/bin/bash

# System monitoring script for PDF Processing System
# Monitors system resources, application health, and generates alerts

set -e

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
LOG_FILE="$PROJECT_DIR/logs/monitoring.log"
ALERT_LOG="$PROJECT_DIR/logs/alerts.log"
METRICS_FILE="$PROJECT_DIR/logs/metrics.json"

# Thresholds
CPU_THRESHOLD=80
MEMORY_THRESHOLD=85
DISK_THRESHOLD=85
LOAD_THRESHOLD=4.0
RESPONSE_TIME_THRESHOLD=5000

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Logging functions
log() {
    echo -e "${BLUE}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} $1" | tee -a "$LOG_FILE"
}

alert() {
    echo -e "${RED}[$(date +'%Y-%m-%d %H:%M:%S')] ALERT:${NC} $1" | tee -a "$ALERT_LOG"
}

warning() {
    echo -e "${YELLOW}[$(date +'%Y-%m-%d %H:%M:%S')] WARNING:${NC} $1" | tee -a "$LOG_FILE"
}

success() {
    echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')] OK:${NC} $1" | tee -a "$LOG_FILE"
}

# Get system metrics
get_system_metrics() {
    local metrics="{\"timestamp\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\""
    
    # CPU usage
    local cpu_usage=$(top -l 1 | grep "CPU usage" | awk '{print $3}' | sed 's/%//')
    metrics="$metrics,\"cpu_usage\":$cpu_usage"
    
    # Memory usage
    local memory_info=$(vm_stat)
    local pages_free=$(echo "$memory_info" | grep "Pages free" | awk '{print $3}' | sed 's/\.//')
    local pages_active=$(echo "$memory_info" | grep "Pages active" | awk '{print $3}' | sed 's/\.//')
    local pages_inactive=$(echo "$memory_info" | grep "Pages inactive" | awk '{print $3}' | sed 's/\.//')
    local pages_speculative=$(echo "$memory_info" | grep "Pages speculative" | awk '{print $3}' | sed 's/\.//')
    local pages_wired=$(echo "$memory_info" | grep "Pages wired down" | awk '{print $4}' | sed 's/\.//')
    
    local page_size=4096
    local total_pages=$((pages_free + pages_active + pages_inactive + pages_speculative + pages_wired))
    local used_pages=$((pages_active + pages_inactive + pages_speculative + pages_wired))
    local memory_usage=$((used_pages * 100 / total_pages))
    
    metrics="$metrics,\"memory_usage\":$memory_usage"
    
    # Load average
    local load_avg=$(uptime | awk -F'load averages:' '{print $2}' | awk '{print $1}')
    metrics="$metrics,\"load_average\":$load_avg"
    
    # Disk usage
    local disk_usage=$(df -h / | awk 'NR==2 {print $5}' | sed 's/%//')
    metrics="$metrics,\"disk_usage\":$disk_usage"
    
    # Process count
    local process_count=$(ps aux | wc -l)
    metrics="$metrics,\"process_count\":$process_count"
    
    metrics="$metrics}"
    echo "$metrics"
}

# Check application health
check_application_health() {
    local health_status="healthy"
    local issues=()
    
    # Check if main application is responding
    if ! curl -f -s http://localhost:8080/health > /dev/null 2>&1; then
        health_status="unhealthy"
        issues+=("application_not_responding")
        alert "Application health check failed"
    else
        success "Application health check passed"
    fi
    
    # Check response time
    local response_time=$(curl -o /dev/null -s -w '%{time_total}' http://localhost:8080/health 2>/dev/null || echo "0")
    local response_time_ms=$(echo "$response_time * 1000" | bc -l | cut -d. -f1)
    
    if [ "$response_time_ms" -gt "$RESPONSE_TIME_THRESHOLD" ]; then
        health_status="degraded"
        issues+=("slow_response_time")
        warning "Slow response time: ${response_time_ms}ms"
    fi
    
    # Check Docker containers
    if command -v docker &> /dev/null; then
        local container_status=$(docker-compose -f "$PROJECT_DIR/docker-compose.production.yml" ps --services --filter "status=running" 2>/dev/null | wc -l || echo "0")
        local expected_containers=8  # Adjust based on your setup
        
        if [ "$container_status" -lt "$expected_containers" ]; then
            health_status="degraded"
            issues+=("containers_down")
            warning "Some containers are not running: $container_status/$expected_containers"
        fi
    fi
    
    echo "{\"status\":\"$health_status\",\"issues\":[$(printf '"%s",' "${issues[@]}" | sed 's/,$//')]}"
}

# Check system resources
check_system_resources() {
    local metrics=$(get_system_metrics)
    local cpu_usage=$(echo "$metrics" | jq -r '.cpu_usage')
    local memory_usage=$(echo "$metrics" | jq -r '.memory_usage')
    local disk_usage=$(echo "$metrics" | jq -r '.disk_usage')
    local load_average=$(echo "$metrics" | jq -r '.load_average')
    
    local alerts=()
    
    # Check CPU usage
    if (( $(echo "$cpu_usage > $CPU_THRESHOLD" | bc -l) )); then
        alerts+=("high_cpu_usage")
        alert "High CPU usage: ${cpu_usage}%"
    fi
    
    # Check memory usage
    if [ "$memory_usage" -gt "$MEMORY_THRESHOLD" ]; then
        alerts+=("high_memory_usage")
        alert "High memory usage: ${memory_usage}%"
    fi
    
    # Check disk usage
    if [ "$disk_usage" -gt "$DISK_THRESHOLD" ]; then
        alerts+=("high_disk_usage")
        alert "High disk usage: ${disk_usage}%"
    fi
    
    # Check load average
    if (( $(echo "$load_average > $LOAD_THRESHOLD" | bc -l) )); then
        alerts+=("high_load_average")
        alert "High load average: $load_average"
    fi
    
    if [ ${#alerts[@]} -eq 0 ]; then
        success "System resources within normal limits"
    fi
    
    echo "{\"cpu\":$cpu_usage,\"memory\":$memory_usage,\"disk\":$disk_usage,\"load\":$load_average,\"alerts\":[$(printf '"%s",' "${alerts[@]}" | sed 's/,$//')]}"
}

# Check log files for errors
check_logs() {
    local error_count=0
    local log_files=("$PROJECT_DIR/logs/application.log" "$PROJECT_DIR/logs/error.log")
    
    for log_file in "${log_files[@]}"; do
        if [ -f "$log_file" ]; then
            # Count errors in the last 5 minutes
            local recent_errors=$(grep "$(date -v-5M '+%Y-%m-%d %H:%M')" "$log_file" 2>/dev/null | grep -i error | wc -l || echo "0")
            error_count=$((error_count + recent_errors))
        fi
    done
    
    if [ "$error_count" -gt 10 ]; then
        alert "High error rate detected: $error_count errors in the last 5 minutes"
    elif [ "$error_count" -gt 0 ]; then
        warning "Errors detected in logs: $error_count in the last 5 minutes"
    fi
    
    echo "{\"error_count\":$error_count}"
}

# Generate monitoring report
generate_report() {
    local timestamp=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    local system_metrics=$(get_system_metrics)
    local app_health=$(check_application_health)
    local resource_check=$(check_system_resources)
    local log_check=$(check_logs)
    
    local report="{
        \"timestamp\":\"$timestamp\",
        \"system_metrics\":$system_metrics,
        \"application_health\":$app_health,
        \"resource_check\":$resource_check,
        \"log_check\":$log_check
    }"
    
    echo "$report" | jq '.' > "$METRICS_FILE"
    echo "$report"
}

# Send alert notification (placeholder - implement your notification system)
send_alert_notification() {
    local message="$1"
    local severity="${2:-warning}"
    
    # Example: Send to Slack, email, or other notification system
    # curl -X POST -H 'Content-type: application/json' \
    #     --data "{\"text\":\"[$severity] PDF Processing System: $message\"}" \
    #     YOUR_SLACK_WEBHOOK_URL
    
    log "Alert notification: [$severity] $message"
}

# Continuous monitoring mode
continuous_monitor() {
    local interval="${1:-60}"  # Default 60 seconds
    
    log "Starting continuous monitoring (interval: ${interval}s)"
    
    while true; do
        local report=$(generate_report)
        
        # Check for alerts in the report
        local app_status=$(echo "$report" | jq -r '.application_health.status')
        local resource_alerts=$(echo "$report" | jq -r '.resource_check.alerts[]' 2>/dev/null || echo "")
        local error_count=$(echo "$report" | jq -r '.log_check.error_count')
        
        if [ "$app_status" != "healthy" ]; then
            send_alert_notification "Application health status: $app_status" "critical"
        fi
        
        if [ -n "$resource_alerts" ]; then
            while IFS= read -r alert_type; do
                send_alert_notification "Resource alert: $alert_type" "warning"
            done <<< "$resource_alerts"
        fi
        
        if [ "$error_count" -gt 10 ]; then
            send_alert_notification "High error rate: $error_count errors" "warning"
        fi
        
        sleep "$interval"
    done
}

# Show current status
show_status() {
    local report=$(generate_report)
    
    echo "PDF Processing System - Monitoring Status"
    echo "========================================"
    echo ""
    
    # System metrics
    echo "System Metrics:"
    echo "  CPU Usage: $(echo "$report" | jq -r '.system_metrics.cpu_usage')%"
    echo "  Memory Usage: $(echo "$report" | jq -r '.system_metrics.memory_usage')%"
    echo "  Disk Usage: $(echo "$report" | jq -r '.system_metrics.disk_usage')%"
    echo "  Load Average: $(echo "$report" | jq -r '.system_metrics.load_average')"
    echo ""
    
    # Application health
    echo "Application Health:"
    echo "  Status: $(echo "$report" | jq -r '.application_health.status')"
    local issues=$(echo "$report" | jq -r '.application_health.issues[]' 2>/dev/null || echo "none")
    echo "  Issues: $issues"
    echo ""
    
    # Recent errors
    echo "Log Analysis:"
    echo "  Recent Errors: $(echo "$report" | jq -r '.log_check.error_count')"
    echo ""
    
    # Alerts
    local alerts=$(echo "$report" | jq -r '.resource_check.alerts[]' 2>/dev/null || echo "none")
    echo "Active Alerts: $alerts"
}

# Main script logic
case "${1:-status}" in
    "status")
        show_status
        ;;
    
    "report")
        generate_report | jq '.'
        ;;
    
    "monitor")
        continuous_monitor "${2:-60}"
        ;;
    
    "health")
        check_application_health | jq '.'
        ;;
    
    "resources")
        check_system_resources | jq '.'
        ;;
    
    "logs")
        check_logs | jq '.'
        ;;
    
    "alerts")
        if [ -f "$ALERT_LOG" ]; then
            tail -n 20 "$ALERT_LOG"
        else
            echo "No alerts found"
        fi
        ;;
    
    *)
        echo "Usage: $0 {status|report|monitor|health|resources|logs|alerts}"
        echo ""
        echo "Commands:"
        echo "  status    - Show current system status"
        echo "  report    - Generate full monitoring report"
        echo "  monitor   - Start continuous monitoring (optional interval in seconds)"
        echo "  health    - Check application health only"
        echo "  resources - Check system resources only"
        echo "  logs      - Check log files for errors"
        echo "  alerts    - Show recent alerts"
        exit 1
        ;;
esac