/**
 * Migration Runner for Failure Recovery System
 * Applies the 002_add_failure_recovery_tables.sql migration
 */

import mysql from 'mysql2/promise';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuración de la base de datos
const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'root',
    database: process.env.DB_NAME || 'stamentai',
    multipleStatements: true
};

async function runMigration() {
    let connection;
    
    try {
        console.log('🔄 Connecting to database...');
        connection = await mysql.createConnection(dbConfig);
        
        console.log('✅ Connected to database successfully');
        
        // Leer el archivo de migración
        const migrationPath = path.join(__dirname, 'migrations', '002_add_failure_recovery_tables_simple.sql');
        console.log(`📖 Reading migration file: ${migrationPath}`);
        
        const migrationSQL = await fs.readFile(migrationPath, 'utf8');
        
        console.log('🚀 Executing migration...');
        
        // Dividir y ejecutar statements individualmente
        const statements = migrationSQL
            .split(';')
            .map(stmt => stmt.trim())
            .filter(stmt => stmt.length > 0 && !stmt.startsWith('--'));

        console.log(`📝 Executing ${statements.length} SQL statements...`);

        for (let i = 0; i < statements.length; i++) {
            const statement = statements[i];
            if (statement) {
                try {
                    await connection.execute(statement);
                    console.log(`   ✓ Statement ${i + 1}/${statements.length} executed`);
                } catch (error) {
                    console.error(`   ❌ Statement ${i + 1} failed: ${statement.substring(0, 50)}...`);
                    throw error;
                }
            }
        }
        
        console.log('✅ Migration executed successfully');
        
        // Verificar que las tablas se crearon correctamente
        console.log('🔍 Verifying migration results...');
        
        const [tables] = await connection.execute(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = ? 
            AND table_name IN ('worker_metrics', 'queue_stats', 'job_failures', 'circuit_breaker_stats', 'system_alerts')
            ORDER BY table_name
        `, [dbConfig.database]);
        
        console.log('📊 Created tables:');
        tables.forEach(table => {
            console.log(`   ✓ ${table.table_name}`);
        });
        
        // Verificar que las columnas se añadieron a documents
        const [documentColumns] = await connection.execute(`
            SELECT column_name, column_type, is_nullable, column_default
            FROM information_schema.columns 
            WHERE table_schema = ? 
            AND table_name = 'documents'
            AND column_name IN ('worker_id', 'retry_count', 'started_at', 'completed_at', 'failed_at', 'last_heartbeat', 'processing_time_ms', 'memory_used_mb')
            ORDER BY column_name
        `, [dbConfig.database]);
        
        console.log('📋 Added columns to documents table:');
        documentColumns.forEach(col => {
            console.log(`   ✓ ${col.column_name} (${col.column_type})`);
        });
        
        // Verificar procedimientos almacenados
        const [procedures] = await connection.execute(`
            SELECT routine_name 
            FROM information_schema.routines 
            WHERE routine_schema = ? 
            AND routine_type = 'PROCEDURE'
            AND routine_name IN ('CleanupOldMetrics', 'GetPendingRecoveryJobs', 'MarkWorkerAsFailed', 'GetRecoveryStats')
            ORDER BY routine_name
        `, [dbConfig.database]);
        
        console.log('⚙️  Created stored procedures:');
        procedures.forEach(proc => {
            console.log(`   ✓ ${proc.routine_name}`);
        });
        
        // Verificar eventos programados
        const [events] = await connection.execute(`
            SELECT event_name, status
            FROM information_schema.events 
            WHERE event_schema = ? 
            AND event_name IN ('cleanup_old_metrics', 'resolve_old_alerts')
            ORDER BY event_name
        `, [dbConfig.database]);
        
        console.log('⏰ Created scheduled events:');
        events.forEach(event => {
            console.log(`   ✓ ${event.event_name} (${event.status})`);
        });
        
        // Obtener estadísticas iniciales
        const [stats] = await connection.execute('CALL GetRecoveryStats()');
        if (stats && stats[0] && stats[0].length > 0) {
            const stat = stats[0][0];
            console.log('📈 Initial recovery statistics:');
            console.log(`   Active jobs: ${stat.active_jobs}`);
            console.log(`   Failed workers: ${stat.failed_workers}`);
            console.log(`   Healthy workers: ${stat.healthy_workers}`);
            console.log(`   Jobs pending recovery: ${stat.jobs_pending_recovery}`);
            console.log(`   Critical alerts: ${stat.critical_alerts}`);
        }
        
        console.log('\n🎉 Failure Recovery System migration completed successfully!');
        console.log('📝 The following components are now available:');
        console.log('   • Worker health monitoring');
        console.log('   • Job failure tracking and recovery');
        console.log('   • Circuit breaker statistics');
        console.log('   • System alerts and notifications');
        console.log('   • Automated cleanup and maintenance');
        
    } catch (error) {
        console.error('❌ Migration failed:', error.message);
        
        if (error.code) {
            console.error(`   Error code: ${error.code}`);
        }
        
        if (error.sqlMessage) {
            console.error(`   SQL Error: ${error.sqlMessage}`);
        }
        
        process.exit(1);
        
    } finally {
        if (connection) {
            await connection.end();
            console.log('🔌 Database connection closed');
        }
    }
}

// Función para rollback (opcional)
async function rollbackMigration() {
    let connection;
    
    try {
        console.log('🔄 Connecting to database for rollback...');
        connection = await mysql.createConnection(dbConfig);
        
        console.log('⚠️  Rolling back failure recovery migration...');
        
        // Eliminar tablas creadas
        const tablesToDrop = [
            'system_alerts',
            'circuit_breaker_stats', 
            'job_failures',
            'queue_stats',
            'worker_metrics'
        ];
        
        for (const table of tablesToDrop) {
            try {
                await connection.execute(`DROP TABLE IF EXISTS ${table}`);
                console.log(`   ✓ Dropped table: ${table}`);
            } catch (error) {
                console.warn(`   ⚠️  Could not drop table ${table}: ${error.message}`);
            }
        }
        
        // Eliminar columnas añadidas a documents
        const columnsToRemove = [
            'memory_used_mb',
            'processing_time_ms',
            'last_heartbeat',
            'failed_at',
            'completed_at',
            'started_at',
            'retry_count',
            'worker_id'
        ];
        
        for (const column of columnsToRemove) {
            try {
                await connection.execute(`ALTER TABLE documents DROP COLUMN IF EXISTS ${column}`);
                console.log(`   ✓ Removed column: documents.${column}`);
            } catch (error) {
                console.warn(`   ⚠️  Could not remove column ${column}: ${error.message}`);
            }
        }
        
        // Restaurar enum original de status
        try {
            await connection.execute(`
                ALTER TABLE documents 
                MODIFY COLUMN status ENUM('processing', 'completed', 'failed') DEFAULT 'processing'
            `);
            console.log('   ✓ Restored original status enum');
        } catch (error) {
            console.warn(`   ⚠️  Could not restore status enum: ${error.message}`);
        }
        
        // Eliminar procedimientos
        const proceduresToDrop = [
            'GetRecoveryStats',
            'MarkWorkerAsFailed',
            'GetPendingRecoveryJobs',
            'CleanupOldMetrics'
        ];
        
        for (const proc of proceduresToDrop) {
            try {
                await connection.execute(`DROP PROCEDURE IF EXISTS ${proc}`);
                console.log(`   ✓ Dropped procedure: ${proc}`);
            } catch (error) {
                console.warn(`   ⚠️  Could not drop procedure ${proc}: ${error.message}`);
            }
        }
        
        // Eliminar eventos
        const eventsToDrop = ['cleanup_old_metrics', 'resolve_old_alerts'];
        
        for (const event of eventsToDrop) {
            try {
                await connection.execute(`DROP EVENT IF EXISTS ${event}`);
                console.log(`   ✓ Dropped event: ${event}`);
            } catch (error) {
                console.warn(`   ⚠️  Could not drop event ${event}: ${error.message}`);
            }
        }
        
        console.log('✅ Rollback completed successfully');
        
    } catch (error) {
        console.error('❌ Rollback failed:', error.message);
        process.exit(1);
        
    } finally {
        if (connection) {
            await connection.end();
        }
    }
}

// Ejecutar según argumentos de línea de comandos
const command = process.argv[2];

if (command === 'rollback') {
    rollbackMigration();
} else {
    runMigration();
}

export { runMigration, rollbackMigration };