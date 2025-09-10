#!/usr/bin/env node

/**
 * Amount Sign Detection Migration Script
 * Applies database schema changes for amount sign detection feature
 */

import { runMigration } from './run-migration.js';
import path from 'path';

async function migrateAmountSignDetection() {
  console.log('🚀 Starting Amount Sign Detection Migration...\n');
  
  try {
    // Run the migration
    await runMigration('001_add_amount_sign_detection_fields.sql');
    
    console.log('\n✅ Amount Sign Detection Migration completed successfully!');
    console.log('\nNew fields added to documents table:');
    console.log('  - original_credit: DECIMAL(10,2) - Original credit amount from PDF');
    console.log('  - original_debit: DECIMAL(10,2) - Original debit amount from PDF');
    console.log('  - original_amount: DECIMAL(10,2) - Original amount value from PDF');
    console.log('  - sign_detection_method: VARCHAR(20) - Method used for sign detection');
    console.log('\nIndex added:');
    console.log('  - idx_documents_sign_detection_method on sign_detection_method field');
    
  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
    console.error('\nPlease check your database connection and try again.');
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  migrateAmountSignDetection();
}

export { migrateAmountSignDetection };