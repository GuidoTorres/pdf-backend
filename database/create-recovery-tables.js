/**
 * Simple script to create failure recovery tables
 */

import mysql from 'mysql2/promise';

const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'root',
    database: process.env.DB_NAME || 'stamentai'
};

async function createTables() {
    let connection;
    
    try {
        console.log('🔄 Connecting to database...');
        connection = await mysql.createConnection(dbConfig);
        console.log('✅ Connected to database successfully');

        // Create worker_metrics table
        console.log('📊 Creating worker_metrics table...');
        await connection.execute(`
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
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        console.log('   ✓ worker_metrics table created');

        // Create queue_stats table
        console.log('📊 Creating queue_stats table...');
        await connection.execute(`
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
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        console.log('   ✓ queue_stats table created');

        // Create job_failures table
        console.log('📊 Creating job_failures table...');
        await connection.execute(`
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
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        console.log('   ✓ job_failures table created');

        // Create circuit_breaker_stats table
        console.log('📊 Creating circuit_breaker_stats table...');
        await connection.execute(`
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
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        console.log('   ✓ circuit_breaker_stats table created');

        // Create system_alerts table
        console.log('📊 Creating system_alerts table...');
        await connection.execute(`
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
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        console.log('   ✓ system_alerts table created');

        // Add columns to documents table
        console.log('📋 Adding columns to documents table...');
        
        const columnsToAdd = [
            { name: 'worker_id', type: 'VARCHAR(255) NULL', comment: 'ID del worker procesando el documento' },
            { name: 'retry_count', type: 'INT DEFAULT 0', comment: 'Número de reintentos realizados' },
            { name: 'started_at', type: 'DATETIME NULL', comment: 'Timestamp cuando inició el procesamiento' },
            { name: 'completed_at', type: 'DATETIME NULL', comment: 'Timestamp cuando completó el procesamiento' },
            { name: 'failed_at', type: 'DATETIME NULL', comment: 'Timestamp cuando falló permanentemente' },
            { name: 'last_heartbeat', type: 'DATETIME NULL', comment: 'Último heartbeat del worker procesando' },
            { name: 'processing_time_ms', type: 'INT NULL', comment: 'Tiempo total de procesamiento en milisegundos' },
            { name: 'memory_used_mb', type: 'DECIMAL(10,2) NULL', comment: 'Memoria utilizada durante el procesamiento' }
        ];

        for (const column of columnsToAdd) {
            try {
                await connection.execute(`
                    ALTER TABLE documents 
                    ADD COLUMN ${column.name} ${column.type} COMMENT '${column.comment}'
                `);
                console.log(`   ✓ Added column: ${column.name}`);
            } catch (error) {
                if (error.code === 'ER_DUP_FIELDNAME') {
                    console.log(`   ⚠️  Column ${column.name} already exists`);
                } else {
                    console.error(`   ❌ Failed to add column ${column.name}: ${error.message}`);
                }
            }
        }

        // Update documents status enum
        console.log('📋 Updating documents status enum...');
        try {
            await connection.execute(`
                ALTER TABLE documents 
                MODIFY COLUMN status ENUM('queued', 'processing', 'completed', 'failed', 'recovery_pending', 'retrying') DEFAULT 'queued'
            `);
            console.log('   ✓ Updated status enum');
        } catch (error) {
            console.log(`   ⚠️  Status enum update failed (may already be updated): ${error.message}`);
        }

        // Add indexes
        console.log('📋 Adding indexes...');
        const indexes = [
            'ALTER TABLE documents ADD INDEX IF NOT EXISTS idx_documents_worker_id (worker_id)',
            'ALTER TABLE documents ADD INDEX IF NOT EXISTS idx_documents_retry_count (retry_count)',
            'ALTER TABLE documents ADD INDEX IF NOT EXISTS idx_documents_started_at (started_at)',
            'ALTER TABLE documents ADD INDEX IF NOT EXISTS idx_documents_last_heartbeat (last_heartbeat)'
        ];

        for (const indexSQL of indexes) {
            try {
                await connection.execute(indexSQL);
                console.log(`   ✓ Index added`);
            } catch (error) {
                if (error.code === 'ER_DUP_KEYNAME') {
                    console.log(`   ⚠️  Index already exists`);
                } else {
                    console.log(`   ⚠️  Index creation failed: ${error.message}`);
                }
            }
        }

        // Verify tables were created
        const [tables] = await connection.execute(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = ? 
            AND table_name IN ('worker_metrics', 'queue_stats', 'job_failures', 'circuit_breaker_stats', 'system_alerts')
            ORDER BY table_name
        `, [dbConfig.database]);

        console.log('\n🎉 Failure Recovery System tables created successfully!');
        console.log('📊 Created tables:');
        tables.forEach(table => {
            console.log(`   ✓ ${table.table_name}`);
        });

        console.log('\n📝 The following components are now available:');
        console.log('   • Worker health monitoring');
        console.log('   • Job failure tracking and recovery');
        console.log('   • Circuit breaker statistics');
        console.log('   • System alerts and notifications');

    } catch (error) {
        console.error('❌ Failed to create tables:', error.message);
        process.exit(1);
    } finally {
        if (connection) {
            await connection.end();
            console.log('🔌 Database connection closed');
        }
    }
}

createTables();