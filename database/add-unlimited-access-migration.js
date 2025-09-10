#!/usr/bin/env node
/**
 * Migration Script: Add unlimited_access field to users table and unlimited plan to subscriptions
 * This script adds support for unlimited access users
 */

import mysql from 'mysql2/promise';
import config from '../src/config/config.js';

async function runMigration() {
  let connection;

  try {
    console.log('🚀 Starting unlimited access migration...\n');

    // Connect to database
    connection = await mysql.createConnection({
      host: config.database.host,
      port: config.database.port,
      user: config.database.user,
      password: config.database.password,
      database: config.database.name,
    });

    console.log('✅ Connected to database');

    // 1. Add unlimited_access column to users table
    console.log('\n📋 Step 1: Adding unlimited_access column to users table...');
    
    try {
      // First check if the column already exists
      const [columns] = await connection.execute(`
        SHOW COLUMNS FROM users LIKE 'unlimited_access'
      `);
      
      if (columns.length === 0) {
        // Add the column at the end of the table
        await connection.execute(`
          ALTER TABLE users 
          ADD COLUMN unlimited_access BOOLEAN DEFAULT FALSE
        `);
        console.log('✅ Added unlimited_access column to users table');
      } else {
        console.log('ℹ️  unlimited_access column already exists in users table');
      }
    } catch (error) {
      throw error;
    }

    // 2. Update subscriptions table ENUM to include unlimited
    console.log('\n📋 Step 2: Updating subscriptions plan ENUM to include unlimited...');
    
    try {
      await connection.execute(`
        ALTER TABLE subscriptions 
        MODIFY COLUMN plan ENUM('free', 'basic', 'pro', 'enterprise', 'unlimited') DEFAULT 'free'
      `);
      console.log('✅ Updated subscriptions plan ENUM to include unlimited');
    } catch (error) {
      if (error.message.includes('unlimited')) {
        console.log('ℹ️  unlimited plan already exists in subscriptions ENUM');
      } else {
        throw error;
      }
    }

    // 3. Add index on unlimited_access for performance
    console.log('\n📋 Step 3: Adding index on unlimited_access column...');
    
    try {
      await connection.execute(`
        CREATE INDEX idx_users_unlimited_access ON users(unlimited_access)
      `);
      console.log('✅ Added index on unlimited_access column');
    } catch (error) {
      if (error.code === 'ER_DUP_KEYNAME') {
        console.log('ℹ️  Index on unlimited_access already exists');
      } else {
        throw error;
      }
    }

    console.log('\n🎉 Migration completed successfully!');
    console.log('\n📊 Summary:');
    console.log('   • Added unlimited_access BOOLEAN column to users table');
    console.log('   • Updated subscriptions plan ENUM to include "unlimited"');
    console.log('   • Added database index for performance');
    console.log('\n💡 Next steps:');
    console.log('   • Use create_unlimited_user.js to create unlimited users');
    console.log('   • Unlimited users will have pages_remaining: 999999');
    console.log('   • Unlimited users will not have pages deducted during processing');

    return true;

  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
    console.error('Error details:', error);
    return false;
  } finally {
    if (connection) {
      await connection.end();
      console.log('\n🔌 Database connection closed');
    }
  }
}

// Execute migration
console.log('🔧 Unlimited Access Migration Script');
console.log('==================================\n');

runMigration()
  .then(success => {
    if (success) {
      console.log('\n✅ MIGRATION COMPLETED SUCCESSFULLY');
      process.exit(0);
    } else {
      console.log('\n❌ MIGRATION FAILED');
      process.exit(1);
    }
  })
  .catch(error => {
    console.error('\n💥 Unexpected error:', error);
    process.exit(1);
  });