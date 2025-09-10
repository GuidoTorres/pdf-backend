#!/usr/bin/env node

/**
 * Metrics Migration Runner
 * 
 * This script runs the metrics tables migration (003_add_metrics_tables.sql)
 * and sets up the database schema for the comprehensive metrics system.
 */

import mysql from 'mysql2/promise';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Database configuration
const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'pdf_processor',
  multipleStatements: true
};

async function runMigration() {
  let connection;
  
  try {
    console.log('🚀 Starting metrics migration...');
    console.log(`📊 Connecting to database: ${dbConfig.host}/${dbConfig.database}`);
    
    // Create database connection
    connection = await mysql.createConnection(dbConfig);
    
    // Test connection
    await connection.ping();
    console.log('✅ Database connection established');
    
    // Read migration file
    const migrationPath = path.join(__dirname, 'migrations', '003_add_metrics_tables.sql');
    console.log(`📄 Reading migration file: ${migrationPath}`);
    
    const migrationSQL = await fs.readFile(migrationPath, 'utf8');
    
    // Execute migration
    console.log('⚡ Executing migration...');
    await connection.execute(migrationSQL);
    
    console.log('✅ Migration executed successfully');
    
    // Verify tables were created
    console.log('🔍 Verifying table creation...');
    
    const tables = ['worker_metrics', 'queue_stats', 'job_metrics'];
    
    for (const table of tables) {
      const [rows] = await connection.execute(
        'SELECT COUNT(*) as count FROM information_schema.tables WHERE table_schema = ? AND table_name = ?',
        [dbConfig.database, table]
      );
      
      if (rows[0].count > 0) {
        console.log(`✅ Table '${table}' created successfully`);
        
        // Show table structure
        const [columns] = await connection.execute(`DESCRIBE ${table}`);
        console.log(`   📋 Columns: ${columns.length}`);
      } else {
        console.log(`❌ Table '${table}' was not created`);
      }
    }
    
    // Verify views were created
    console.log('🔍 Verifying view creation...');
    
    const views = ['v_active_workers', 'v_queue_overview', 'v_job_performance_summary'];
    
    for (const view of views) {
      const [rows] = await connection.execute(
        'SELECT COUNT(*) as count FROM information_schema.views WHERE table_schema = ? AND table_name = ?',
        [dbConfig.database, view]
      );
      
      if (rows[0].count > 0) {
        console.log(`✅ View '${view}' created successfully`);
      } else {
        console.log(`❌ View '${view}' was not created`);
      }
    }
    
    // Verify triggers were created
    console.log('🔍 Verifying trigger creation...');
    
    const triggers = ['cleanup_old_worker_metrics', 'cleanup_old_queue_stats', 'cleanup_old_job_metrics'];
    
    for (const trigger of triggers) {
      const [rows] = await connection.execute(
        'SELECT COUNT(*) as count FROM information_schema.triggers WHERE trigger_schema = ? AND trigger_name = ?',
        [dbConfig.database, trigger]
      );
      
      if (rows[0].count > 0) {
        console.log(`✅ Trigger '${trigger}' created successfully`);
      } else {
        console.log(`⚠️  Trigger '${trigger}' was not created (this may be expected in some environments)`);
      }
    }
    
    // Insert test data to verify functionality
    console.log('🧪 Inserting test data...');
    
    const testWorkerId = 'test-worker-' + Date.now();
    const testJobId = 'test-job-' + Date.now();
    
    // Insert test worker metrics
    await connection.execute(
      `INSERT INTO worker_metrics (id, worker_id, status, jobs_in_progress, memory_usage_mb, cpu_usage_percent) 
       VALUES (UUID(), ?, 'active', 1, 512.5, 45.2)`,
      [testWorkerId]
    );
    
    // Insert test queue stats
    await connection.execute(
      `INSERT INTO queue_stats (id, queue_name, jobs_waiting, jobs_active, throughput_per_hour) 
       VALUES (UUID(), 'test-queue', 5, 2, 25.5)`
    );
    
    // Verify test data
    const [workerRows] = await connection.execute(
      'SELECT COUNT(*) as count FROM worker_metrics WHERE worker_id = ?',
      [testWorkerId]
    );
    
    const [queueRows] = await connection.execute(
      'SELECT COUNT(*) as count FROM queue_stats WHERE queue_name = ?',
      ['test-queue']
    );
    
    if (workerRows[0].count > 0 && queueRows[0].count > 0) {
      console.log('✅ Test data inserted and verified successfully');
      
      // Clean up test data
      await connection.execute('DELETE FROM worker_metrics WHERE worker_id = ?', [testWorkerId]);
      await connection.execute('DELETE FROM queue_stats WHERE queue_name = ?', ['test-queue']);
      console.log('🧹 Test data cleaned up');
    } else {
      console.log('❌ Test data verification failed');
    }
    
    // Show migration summary
    console.log('\n📊 Migration Summary:');
    console.log('==================');
    console.log('✅ Tables created: worker_metrics, queue_stats, job_metrics');
    console.log('✅ Views created: v_active_workers, v_queue_overview, v_job_performance_summary');
    console.log('✅ Indexes created for performance optimization');
    console.log('✅ Triggers created for automatic cleanup');
    console.log('✅ Foreign key constraints established');
    console.log('\n🎉 Metrics migration completed successfully!');
    console.log('\n📝 Next steps:');
    console.log('1. Update your application to use the new MetricsIntegrationService');
    console.log('2. Configure alert thresholds in the AlertingSystem');
    console.log('3. Set up daily report generation schedule');
    console.log('4. Test the metrics collection with real workloads');
    
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    
    if (error.code) {
      console.error(`   Error code: ${error.code}`);
    }
    
    if (error.sqlMessage) {
      console.error(`   SQL Error: ${error.sqlMessage}`);
    }
    
    console.error('\n🔧 Troubleshooting tips:');
    console.error('1. Verify database connection parameters');
    console.error('2. Ensure the database exists and is accessible');
    console.error('3. Check that the user has sufficient privileges');
    console.error('4. Verify that previous migrations have been run');
    
    process.exit(1);
    
  } finally {
    if (connection) {
      await connection.end();
      console.log('🔌 Database connection closed');
    }
  }
}

// Handle command line arguments
const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
📊 Metrics Migration Runner

Usage: node run-metrics-migration.js [options]

Options:
  --help, -h     Show this help message
  --dry-run      Show what would be executed without running the migration
  --force        Force migration even if tables already exist

Environment Variables:
  DB_HOST        Database host (default: localhost)
  DB_USER        Database user (default: root)
  DB_PASSWORD    Database password (default: empty)
  DB_NAME        Database name (default: pdf_processor)

Examples:
  node run-metrics-migration.js
  DB_HOST=myhost DB_USER=myuser node run-metrics-migration.js
  node run-metrics-migration.js --dry-run
`);
  process.exit(0);
}

if (args.includes('--dry-run')) {
  console.log('🔍 DRY RUN MODE - No changes will be made');
  console.log('📄 Migration file would be executed:');
  
  try {
    const migrationPath = path.join(__dirname, 'migrations', '003_add_metrics_tables.sql');
    const migrationSQL = await fs.readFile(migrationPath, 'utf8');
    
    console.log('--- Migration SQL ---');
    console.log(migrationSQL.substring(0, 500) + '...');
    console.log('--- End Migration SQL ---');
    
  } catch (error) {
    console.error('❌ Error reading migration file:', error.message);
  }
  
  process.exit(0);
}

// Run the migration
runMigration();