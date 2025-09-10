-- =====================================================
-- Migration 002: Add Failure Recovery System Tables
-- Adds tables to support worker monitoring, job recovery,
-- and circuit breaker functionality
-- =====================================================

USE stamentai;

-- Tabla de métricas de workers
CREATE TABLE IF NOT EXISTS worker_metrics (
    id CHAR(36) PRIMARY KEY,
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
    INDEX idx_worker_metrics_last_heartbeat (last_heartbeat),
    UNIQUE KEY unique_worker_timestamp (worker_id, timestamp)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tabla de estadísticas de colas
CREATE TABLE IF NOT EXISTS queue_stats (
    id CHAR(36) PRIMARY KEY,
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
    INDEX idx_queue_stats_timestamp (timestamp),
    UNIQUE KEY unique_queue_timestamp (queue_name, timestamp)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tabla de fallos de trabajos
CREATE TABLE IF NOT EXISTS job_failures (
    id CHAR(36) PRIMARY KEY,
    job_id CHAR(36) NOT NULL,
    worker_id VARCHAR(255) NULL,
    failure_reason TEXT NOT NULL,
    retry_count INT DEFAULT 0,
    failure_time DATETIME DEFAULT CURRENT_TIMESTAMP,
    recovery_attempted BOOLEAN DEFAULT FALSE,
    recovery_successful BOOLEAN DEFAULT FALSE,
    recovery_time DATETIME NULL,
    metadata JSON NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (job_id) REFERENCES documents(id) ON DELETE CASCADE,
    INDEX idx_job_failures_job_id (job_id),
    INDEX idx_job_failures_worker_id (worker_id),
    INDEX idx_job_failures_failure_time (failure_time),
    INDEX idx_job_failures_retry_count (retry_count)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tabla de estado de circuit breakers
CREATE TABLE IF NOT EXISTS circuit_breaker_stats (
    id CHAR(36) PRIMARY KEY,
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
    INDEX idx_circuit_breaker_state (state),
    UNIQUE KEY unique_service_timestamp (service_name, timestamp)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tabla de alertas del sistema
CREATE TABLE IF NOT EXISTS system_alerts (
    id CHAR(36) PRIMARY KEY,
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

-- Actualizar tabla de documentos para soporte de recovery
ALTER TABLE documents 
ADD COLUMN IF NOT EXISTS worker_id VARCHAR(255) NULL COMMENT 'ID del worker procesando el documento',
ADD COLUMN IF NOT EXISTS retry_count INT DEFAULT 0 COMMENT 'Número de reintentos realizados',
ADD COLUMN IF NOT EXISTS started_at DATETIME NULL COMMENT 'Timestamp cuando inició el procesamiento',
ADD COLUMN IF NOT EXISTS completed_at DATETIME NULL COMMENT 'Timestamp cuando completó el procesamiento',
ADD COLUMN IF NOT EXISTS failed_at DATETIME NULL COMMENT 'Timestamp cuando falló permanentemente',
ADD COLUMN IF NOT EXISTS last_heartbeat DATETIME NULL COMMENT 'Último heartbeat del worker procesando',
ADD COLUMN IF NOT EXISTS processing_time_ms INT NULL COMMENT 'Tiempo total de procesamiento en milisegundos',
ADD COLUMN IF NOT EXISTS memory_used_mb DECIMAL(10,2) NULL COMMENT 'Memoria utilizada durante el procesamiento';

-- Actualizar enum de status para incluir nuevos estados
ALTER TABLE documents 
MODIFY COLUMN status ENUM('queued', 'processing', 'completed', 'failed', 'recovery_pending', 'retrying') DEFAULT 'queued';

-- Añadir índices para optimizar consultas de recovery
ALTER TABLE documents 
ADD INDEX IF NOT EXISTS idx_documents_worker_id (worker_id),
ADD INDEX IF NOT EXISTS idx_documents_retry_count (retry_count),
ADD INDEX IF NOT EXISTS idx_documents_started_at (started_at),
ADD INDEX IF NOT EXISTS idx_documents_last_heartbeat (last_heartbeat);

-- =====================================================
-- Procedimientos almacenados para recovery
-- =====================================================

DELIMITER //

-- Procedimiento para limpiar métricas antiguas
CREATE PROCEDURE IF NOT EXISTS CleanupOldMetrics()
BEGIN
    DECLARE deleted_worker_metrics INT DEFAULT 0;
    DECLARE deleted_queue_stats INT DEFAULT 0;
    DECLARE deleted_circuit_stats INT DEFAULT 0;
    
    -- Limpiar métricas de workers más antiguas de 7 días
    DELETE FROM worker_metrics 
    WHERE timestamp < DATE_SUB(NOW(), INTERVAL 7 DAY);
    SET deleted_worker_metrics = ROW_COUNT();
    
    -- Limpiar estadísticas de colas más antiguas de 7 días
    DELETE FROM queue_stats 
    WHERE timestamp < DATE_SUB(NOW(), INTERVAL 7 DAY);
    SET deleted_queue_stats = ROW_COUNT();
    
    -- Limpiar estadísticas de circuit breaker más antiguas de 30 días
    DELETE FROM circuit_breaker_stats 
    WHERE timestamp < DATE_SUB(NOW(), INTERVAL 30 DAY);
    SET deleted_circuit_stats = ROW_COUNT();
    
    -- Retornar estadísticas de limpieza
    SELECT 
        deleted_worker_metrics,
        deleted_queue_stats,
        deleted_circuit_stats,
        NOW() as cleanup_time;
END //

-- Procedimiento para obtener trabajos pendientes de recovery
CREATE PROCEDURE IF NOT EXISTS GetPendingRecoveryJobs()
BEGIN
    SELECT 
        id,
        user_id,
        job_id,
        original_file_name as fileName,
        file_size as fileSize,
        status,
        retry_count,
        worker_id,
        started_at,
        last_heartbeat,
        created_at,
        TIMESTAMPDIFF(MINUTE, COALESCE(last_heartbeat, started_at, created_at), NOW()) as minutes_since_update
    FROM documents 
    WHERE status IN ('processing', 'queued', 'recovery_pending', 'retrying')
    AND (
        -- Trabajos sin heartbeat reciente (más de 10 minutos)
        (last_heartbeat IS NOT NULL AND last_heartbeat < DATE_SUB(NOW(), INTERVAL 10 MINUTE))
        OR 
        -- Trabajos procesando sin heartbeat por más de 5 minutos
        (status = 'processing' AND last_heartbeat IS NULL AND started_at < DATE_SUB(NOW(), INTERVAL 5 MINUTE))
        OR
        -- Trabajos en cola por más de 1 hora
        (status = 'queued' AND created_at < DATE_SUB(NOW(), INTERVAL 1 HOUR))
        OR
        -- Trabajos marcados para recovery
        status IN ('recovery_pending', 'retrying')
    )
    AND created_at > DATE_SUB(NOW(), INTERVAL 24 HOUR) -- Solo últimas 24 horas
    ORDER BY 
        CASE status 
            WHEN 'recovery_pending' THEN 1
            WHEN 'retrying' THEN 2
            WHEN 'processing' THEN 3
            WHEN 'queued' THEN 4
        END,
        retry_count ASC,
        created_at ASC;
END //

-- Procedimiento para marcar workers como fallidos
CREATE PROCEDURE IF NOT EXISTS MarkWorkerAsFailed(IN p_worker_id VARCHAR(255), IN p_reason TEXT)
BEGIN
    DECLARE affected_jobs INT DEFAULT 0;
    
    -- Actualizar métricas del worker
    UPDATE worker_metrics 
    SET status = 'failed', 
        updated_at = NOW() 
    WHERE worker_id = p_worker_id 
    AND status != 'failed';
    
    -- Marcar trabajos del worker para recovery
    UPDATE documents 
    SET status = 'recovery_pending',
        updated_at = NOW()
    WHERE worker_id = p_worker_id 
    AND status = 'processing';
    
    SET affected_jobs = ROW_COUNT();
    
    -- Registrar fallo en job_failures
    INSERT INTO job_failures (job_id, worker_id, failure_reason, retry_count, failure_time)
    SELECT id, worker_id, p_reason, retry_count, NOW()
    FROM documents 
    WHERE worker_id = p_worker_id 
    AND status = 'recovery_pending';
    
    -- Crear alerta del sistema
    INSERT INTO system_alerts (alert_type, severity, title, message, source_component, metadata)
    VALUES (
        'worker_failure',
        'critical',
        CONCAT('Worker ', p_worker_id, ' failed'),
        CONCAT('Worker ', p_worker_id, ' failed with reason: ', p_reason),
        'FailureRecoveryManager',
        JSON_OBJECT('worker_id', p_worker_id, 'affected_jobs', affected_jobs, 'reason', p_reason)
    );
    
    SELECT affected_jobs as jobs_marked_for_recovery;
END //

-- Función para obtener estadísticas de recovery
CREATE PROCEDURE IF NOT EXISTS GetRecoveryStats()
BEGIN
    SELECT 
        (SELECT COUNT(*) FROM documents WHERE status IN ('processing', 'queued', 'recovery_pending', 'retrying')) as active_jobs,
        (SELECT COUNT(DISTINCT worker_id) FROM worker_metrics WHERE status = 'failed') as failed_workers,
        (SELECT COUNT(DISTINCT worker_id) FROM worker_metrics WHERE last_heartbeat > DATE_SUB(NOW(), INTERVAL 5 MINUTE)) as healthy_workers,
        (SELECT COUNT(*) FROM documents WHERE status = 'recovery_pending') as jobs_pending_recovery,
        (SELECT COUNT(*) FROM system_alerts WHERE resolved = FALSE AND severity = 'critical') as critical_alerts,
        (SELECT AVG(TIMESTAMPDIFF(SECOND, started_at, completed_at)) FROM documents WHERE completed_at IS NOT NULL AND started_at IS NOT NULL AND completed_at > DATE_SUB(NOW(), INTERVAL 1 HOUR)) as avg_processing_time_seconds,
        NOW() as stats_timestamp;
END //

DELIMITER ;

-- =====================================================
-- Eventos programados para maintenance
-- =====================================================

-- Evento para limpiar métricas antiguas cada día a las 3 AM
CREATE EVENT IF NOT EXISTS cleanup_old_metrics
ON SCHEDULE EVERY 1 DAY
STARTS (TIMESTAMP(CURRENT_DATE) + INTERVAL 1 DAY + INTERVAL 3 HOUR)
DO
    CALL CleanupOldMetrics();

-- Evento para resolver alertas antiguas cada 6 horas
CREATE EVENT IF NOT EXISTS resolve_old_alerts
ON SCHEDULE EVERY 6 HOUR
STARTS CURRENT_TIMESTAMP
DO
    UPDATE system_alerts 
    SET resolved = TRUE, 
        resolved_at = NOW(),
        updated_at = NOW()
    WHERE resolved = FALSE 
    AND created_at < DATE_SUB(NOW(), INTERVAL 24 HOUR)
    AND severity != 'critical';

-- =====================================================
-- Datos iniciales y verificación
-- =====================================================

-- Insertar configuración inicial de circuit breakers
INSERT IGNORE INTO circuit_breaker_stats (service_name, state, timestamp)
VALUES 
    ('pdf-processing', 'CLOSED', NOW()),
    ('worker-management', 'CLOSED', NOW()),
    ('queue-management', 'CLOSED', NOW());

-- Verificar tablas creadas
SELECT 
    'Failure Recovery tables created successfully!' as status,
    (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'stamentai' AND table_name IN ('worker_metrics', 'queue_stats', 'job_failures', 'circuit_breaker_stats', 'system_alerts')) as tables_created,
    NOW() as migration_completed;

COMMIT;