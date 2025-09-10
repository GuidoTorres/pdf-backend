-- Migration 002: Add Failure Recovery System Tables (Simplified)

-- Tabla de métricas de workers
CREATE TABLE IF NOT EXISTS worker_metrics (
    id VARCHAR(36) PRIMARY KEY,
    worker_id VARCHAR(255) NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    jobs_in_progress INT DEFAULT 0,
    jobs_completed_hour INT DEFAULT 0,
    avg_processing_time DECIMAL(10,2) DEFAULT 0.00,
    memory_usage_mb DECIMAL(10,2) DEFAULT 0.00,
    cpu_usage_percent DECIMAL(5,2) DEFAULT 0.00,
    status ENUM('active', 'idle', 'overloaded', 'failed', 'recovering') DEFAULT 'active',
    last_heartbeat DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_worker_metrics_worker_id (worker_id),
    INDEX idx_worker_metrics_timestamp (timestamp),
    INDEX idx_worker_metrics_status (status),
    INDEX idx_worker_metrics_last_heartbeat (last_heartbeat)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tabla de estadísticas de colas
CREATE TABLE IF NOT EXISTS queue_stats (
    id VARCHAR(36) PRIMARY KEY,
    queue_name VARCHAR(255) NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    jobs_waiting INT DEFAULT 0,
    jobs_active INT DEFAULT 0,
    jobs_completed_hour INT DEFAULT 0,
    jobs_failed_hour INT DEFAULT 0,
    avg_wait_time DECIMAL(10,2) DEFAULT 0.00,
    estimated_processing_time DECIMAL(10,2) DEFAULT 0.00,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_queue_stats_queue_name (queue_name),
    INDEX idx_queue_stats_timestamp (timestamp)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tabla de fallos de trabajos
CREATE TABLE IF NOT EXISTS job_failures (
    id VARCHAR(36) PRIMARY KEY,
    job_id VARCHAR(36) NOT NULL,
    worker_id VARCHAR(255) NULL,
    failure_reason TEXT NOT NULL,
    retry_count INT DEFAULT 0,
    failure_time DATETIME DEFAULT CURRENT_TIMESTAMP,
    recovery_attempted BOOLEAN DEFAULT FALSE,
    recovery_successful BOOLEAN DEFAULT FALSE,
    recovery_time DATETIME NULL,
    metadata JSON NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_job_failures_job_id (job_id),
    INDEX idx_job_failures_worker_id (worker_id),
    INDEX idx_job_failures_failure_time (failure_time),
    INDEX idx_job_failures_retry_count (retry_count)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tabla de estado de circuit breakers
CREATE TABLE IF NOT EXISTS circuit_breaker_stats (
    id VARCHAR(36) PRIMARY KEY,
    service_name VARCHAR(255) NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    state ENUM('CLOSED', 'OPEN', 'HALF_OPEN') DEFAULT 'CLOSED',
    failure_count INT DEFAULT 0,
    success_count INT DEFAULT 0,
    total_calls INT DEFAULT 0,
    failure_rate DECIMAL(5,4) DEFAULT 0.0000,
    last_failure_time DATETIME NULL,
    last_success_time DATETIME NULL,
    next_attempt_time DATETIME NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_circuit_breaker_service (service_name),
    INDEX idx_circuit_breaker_timestamp (timestamp),
    INDEX idx_circuit_breaker_state (state)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tabla de alertas del sistema
CREATE TABLE IF NOT EXISTS system_alerts (
    id VARCHAR(36) PRIMARY KEY,
    alert_type ENUM('worker_failure', 'high_queue_length', 'circuit_breaker_open', 'memory_overload', 'job_timeout') NOT NULL,
    severity ENUM('info', 'warning', 'critical') DEFAULT 'warning',
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    source_component VARCHAR(255) NULL,
    metadata JSON NULL,
    acknowledged BOOLEAN DEFAULT FALSE,
    acknowledged_by VARCHAR(255) NULL,
    acknowledged_at DATETIME NULL,
    resolved BOOLEAN DEFAULT FALSE,
    resolved_at DATETIME NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_system_alerts_type (alert_type),
    INDEX idx_system_alerts_severity (severity),
    INDEX idx_system_alerts_acknowledged (acknowledged),
    INDEX idx_system_alerts_resolved (resolved),
    INDEX idx_system_alerts_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;