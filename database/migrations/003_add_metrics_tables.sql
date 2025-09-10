-- Migration: Add metrics and performance analysis tables
-- Version: 003
-- Description: Creates tables for comprehensive metrics collection and analysis

-- Create WorkerMetrics table
CREATE TABLE IF NOT EXISTS worker_metrics (
    id VARCHAR(36) PRIMARY KEY,
    worker_id VARCHAR(255) NOT NULL,
    timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    jobs_in_progress INT NOT NULL DEFAULT 0,
    jobs_completed_hour INT NOT NULL DEFAULT 0,
    jobs_failed_hour INT NOT NULL DEFAULT 0,
    avg_processing_time FLOAT NULL COMMENT 'Average processing time in seconds',
    memory_usage_mb FLOAT NOT NULL DEFAULT 0,
    cpu_usage_percent FLOAT NOT NULL DEFAULT 0,
    status ENUM('active', 'idle', 'overloaded', 'failed', 'terminated') NOT NULL DEFAULT 'idle',
    last_heartbeat DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    error_count INT NOT NULL DEFAULT 0,
    total_jobs_processed INT NOT NULL DEFAULT 0,
    uptime_seconds INT NOT NULL DEFAULT 0,
    metadata JSON NULL COMMENT 'Additional worker metadata and configuration',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_worker_id (worker_id),
    INDEX idx_timestamp (timestamp),
    INDEX idx_worker_timestamp (worker_id, timestamp),
    INDEX idx_status (status),
    INDEX idx_last_heartbeat (last_heartbeat)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Create QueueStats table
CREATE TABLE IF NOT EXISTS queue_stats (
    id VARCHAR(36) PRIMARY KEY,
    queue_name VARCHAR(255) NOT NULL,
    timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    jobs_waiting INT NOT NULL DEFAULT 0,
    jobs_active INT NOT NULL DEFAULT 0,
    jobs_completed_hour INT NOT NULL DEFAULT 0,
    jobs_failed_hour INT NOT NULL DEFAULT 0,
    jobs_delayed INT NOT NULL DEFAULT 0,
    avg_wait_time FLOAT NULL COMMENT 'Average wait time in seconds',
    avg_processing_time FLOAT NULL COMMENT 'Average processing time in seconds',
    estimated_processing_time FLOAT NULL COMMENT 'Estimated time to process current queue in seconds',
    throughput_per_hour FLOAT NOT NULL DEFAULT 0 COMMENT 'Jobs processed per hour',
    priority_distribution JSON NULL COMMENT 'Distribution of jobs by priority level',
    user_type_distribution JSON NULL COMMENT 'Distribution of jobs by user subscription type',
    file_size_stats JSON NULL COMMENT 'Statistics about file sizes in queue',
    error_rate FLOAT NOT NULL DEFAULT 0 COMMENT 'Error rate as percentage',
    metadata JSON NULL COMMENT 'Additional queue metadata and configuration',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_queue_name (queue_name),
    INDEX idx_timestamp (timestamp),
    INDEX idx_queue_timestamp (queue_name, timestamp)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Create JobMetrics table
CREATE TABLE IF NOT EXISTS job_metrics (
    id VARCHAR(36) PRIMARY KEY,
    job_id VARCHAR(255) NOT NULL UNIQUE,
    document_id VARCHAR(36) NULL,
    user_id VARCHAR(36) NOT NULL,
    worker_id VARCHAR(255) NULL,
    queue_name VARCHAR(255) NOT NULL,
    priority INT NOT NULL DEFAULT 3,
    user_plan VARCHAR(50) NOT NULL,
    file_size BIGINT NULL COMMENT 'File size in bytes',
    page_count INT NULL,
    queued_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    started_at DATETIME NULL,
    completed_at DATETIME NULL,
    wait_time FLOAT NULL COMMENT 'Time spent waiting in queue (seconds)',
    processing_time FLOAT NULL COMMENT 'Time spent processing (seconds)',
    total_time FLOAT NULL COMMENT 'Total time from queue to completion (seconds)',
    memory_used_mb FLOAT NULL COMMENT 'Peak memory usage during processing (MB)',
    cpu_time_ms FLOAT NULL COMMENT 'CPU time used (milliseconds)',
    status ENUM('queued', 'processing', 'completed', 'failed', 'cancelled') NOT NULL DEFAULT 'queued',
    retry_count INT NOT NULL DEFAULT 0,
    error_message TEXT NULL,
    error_type VARCHAR(100) NULL,
    processing_steps JSON NULL COMMENT 'Detailed breakdown of processing steps and their timings',
    performance_metrics JSON NULL COMMENT 'Additional performance metrics and metadata',
    estimated_time FLOAT NULL COMMENT 'Initial estimated processing time (seconds)',
    accuracy_score FLOAT NULL COMMENT 'Processing accuracy score (0-1)',
    confidence_score FLOAT NULL COMMENT 'Processing confidence score (0-1)',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    INDEX idx_job_id (job_id),
    INDEX idx_user_queued (user_id, queued_at),
    INDEX idx_worker_started (worker_id, started_at),
    INDEX idx_queue_queued (queue_name, queued_at),
    INDEX idx_status (status),
    INDEX idx_user_plan (user_plan),
    INDEX idx_error_type (error_type),
    INDEX idx_completed_at (completed_at),
    
    FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE SET NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Create indexes for performance optimization
CREATE INDEX idx_worker_metrics_performance ON worker_metrics (worker_id, timestamp, status);
CREATE INDEX idx_queue_stats_performance ON queue_stats (queue_name, timestamp, jobs_waiting);
CREATE INDEX idx_job_metrics_performance ON job_metrics (status, completed_at, user_plan);
CREATE INDEX idx_job_metrics_timing ON job_metrics (processing_time, wait_time, total_time);

-- Create views for common queries
CREATE OR REPLACE VIEW v_active_workers AS
SELECT 
    worker_id,
    status,
    jobs_in_progress,
    total_jobs_processed,
    error_count,
    avg_processing_time,
    memory_usage_mb,
    cpu_usage_percent,
    last_heartbeat,
    TIMESTAMPDIFF(SECOND, last_heartbeat, NOW()) as seconds_since_heartbeat
FROM worker_metrics w1
WHERE w1.timestamp = (
    SELECT MAX(w2.timestamp) 
    FROM worker_metrics w2 
    WHERE w2.worker_id = w1.worker_id
)
AND last_heartbeat > DATE_SUB(NOW(), INTERVAL 5 MINUTE);

CREATE OR REPLACE VIEW v_queue_overview AS
SELECT 
    queue_name,
    jobs_waiting,
    jobs_active,
    jobs_completed_hour,
    jobs_failed_hour,
    avg_wait_time,
    avg_processing_time,
    throughput_per_hour,
    error_rate,
    timestamp
FROM queue_stats q1
WHERE q1.timestamp = (
    SELECT MAX(q2.timestamp) 
    FROM queue_stats q2 
    WHERE q2.queue_name = q1.queue_name
)
AND timestamp > DATE_SUB(NOW(), INTERVAL 1 HOUR);

CREATE OR REPLACE VIEW v_job_performance_summary AS
SELECT 
    DATE(completed_at) as date,
    user_plan,
    COUNT(*) as total_jobs,
    SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_jobs,
    SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed_jobs,
    AVG(processing_time) as avg_processing_time,
    AVG(wait_time) as avg_wait_time,
    AVG(memory_used_mb) as avg_memory_usage,
    MIN(processing_time) as min_processing_time,
    MAX(processing_time) as max_processing_time
FROM job_metrics
WHERE completed_at IS NOT NULL
GROUP BY DATE(completed_at), user_plan;

-- Add triggers for automatic cleanup of old data (optional)
DELIMITER //

CREATE TRIGGER cleanup_old_worker_metrics
AFTER INSERT ON worker_metrics
FOR EACH ROW
BEGIN
    -- Keep only last 30 days of worker metrics
    DELETE FROM worker_metrics 
    WHERE timestamp < DATE_SUB(NOW(), INTERVAL 30 DAY)
    AND RAND() < 0.01; -- Only run cleanup 1% of the time to avoid performance impact
END//

CREATE TRIGGER cleanup_old_queue_stats
AFTER INSERT ON queue_stats
FOR EACH ROW
BEGIN
    -- Keep only last 30 days of queue stats
    DELETE FROM queue_stats 
    WHERE timestamp < DATE_SUB(NOW(), INTERVAL 30 DAY)
    AND RAND() < 0.01; -- Only run cleanup 1% of the time to avoid performance impact
END//

CREATE TRIGGER cleanup_old_job_metrics
AFTER INSERT ON job_metrics
FOR EACH ROW
BEGIN
    -- Keep only last 90 days of job metrics
    DELETE FROM job_metrics 
    WHERE completed_at < DATE_SUB(NOW(), INTERVAL 90 DAY)
    AND RAND() < 0.001; -- Only run cleanup 0.1% of the time to avoid performance impact
END//

DELIMITER ;

-- Insert initial configuration data
INSERT IGNORE INTO queue_stats (id, queue_name, timestamp) VALUES
(UUID(), 'pdf-processing-premium', NOW()),
(UUID(), 'pdf-processing-normal', NOW()),
(UUID(), 'pdf-processing-large', NOW());

-- Add comments to tables
ALTER TABLE worker_metrics COMMENT = 'Stores performance metrics and status information for individual workers';
ALTER TABLE queue_stats COMMENT = 'Stores statistics and performance data for processing queues';
ALTER TABLE job_metrics COMMENT = 'Stores detailed metrics for individual job processing operations';