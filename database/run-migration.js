#!/usr/bin/env node

/**
 * Database Migration Runner
 * Executes SQL migration files against the database
 */

import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Database configuration
const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || 'root',
  database: process.env.DB_NAME || 'stamentai',
  multipleStatements: true
};

async function runMigration(migrationFile) {
  let connection;
  
  try {
    console.log(`🔄 Running migration: ${migrationFile}`);
    
    // Read migration file
    const migrationPath = path.join(__dirname, 'migrations', migrationFile);
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
    
    // Connect to database
    connection = await mysql.createConnection(dbConfig);
    
    // Execute migration
    const [results] = await connection.execute(migrationSQL);
    
    console.log(`✅ Migration completed successfully: ${migrationFile}`);
    
    // Log any results
    if (Array.isArray(results)) {
      results.forEach((result, index) => {
        if (result && typeof result === 'object') {
          console.log(`   Result ${index + 1}:`, result);
        }
      });
    }
    
  } catch (error) {
    console.error(`❌ Migration failed: ${migrationFile}`);
    console.error('Error:', error.message);
    throw error;
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

async function main() {
  try {
    const migrationFile = process.argv[2];
    
    if (!migrationFile) {
      console.log('Usage: node run-migration.js <migration-file>');
      console.log('Example: node run-migration.js 001_add_amount_sign_detection_fields.sql');
      process.exit(1);
    }
    
    await runMigration(migrationFile);
    console.log('🎉 All migrations completed successfully!');
    
  } catch (error) {
    console.error('💥 Migration process failed:', error.message);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { runMigration };