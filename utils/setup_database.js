#!/usr/bin/env node
/**
 * Database Setup Script
 * Sets up MySQL database and user for the application
 */

import mysql from 'mysql2/promise';
import config from './src/config/config.js';

console.log('🛠️  Setting up MySQL Database for StamentAI...\n');

async function setupDatabase() {
  let connection = null;
  
  try {
    // First, try to connect as root without password
    console.log('🔌 Attempting to connect to MySQL...');
    
    const connectionConfigs = [
      // Try with the configured password
      {
        host: config.database.host,
        port: config.database.port,
        user: config.database.user,
        password: config.database.password
      },
      // Try without password
      {
        host: config.database.host,
        port: config.database.port,
        user: config.database.user,
        password: ''
      },
      // Try with common default passwords
      {
        host: config.database.host,
        port: config.database.port,
        user: config.database.user,
        password: 'password'
      }
    ];
    
    let connected = false;
    for (const connConfig of connectionConfigs) {
      try {
        console.log(`   Trying user: ${connConfig.user}, password: ${connConfig.password ? '***' : 'EMPTY'}`);
        connection = await mysql.createConnection(connConfig);
        console.log('✅ Connected to MySQL successfully!');
        connected = true;
        break;
      } catch (error) {
        console.log(`   ❌ Failed: ${error.message}`);
      }
    }
    
    if (!connected) {
      throw new Error('Could not connect to MySQL with any configuration');
    }
    
    // Create database if it doesn't exist
    console.log(`\n🗄️  Creating database '${config.database.name}'...`);
    await connection.execute(`CREATE DATABASE IF NOT EXISTS \`${config.database.name}\``);
    console.log(`✅ Database '${config.database.name}' is ready`);
    
    // Create user if it doesn't exist (for production security)
    console.log('\n👤 Setting up database user...');
    try {
      await connection.execute(`CREATE USER IF NOT EXISTS '${config.database.user}'@'localhost' IDENTIFIED BY '${config.database.password}'`);
      await connection.execute(`GRANT ALL PRIVILEGES ON \`${config.database.name}\`.* TO '${config.database.user}'@'localhost'`);
      await connection.execute('FLUSH PRIVILEGES');
      console.log(`✅ User '${config.database.user}' configured with proper permissions`);
    } catch (error) {
      console.log(`⚠️  User setup warning: ${error.message}`);
      console.log('   This is normal if the user already exists with correct permissions');
    }
    
    // Test the connection with the application database
    await connection.end();
    
    console.log('\n🎯 Testing final connection...');
    const testConnection = await mysql.createConnection({
      host: config.database.host,
      port: config.database.port,
      user: config.database.user,
      password: config.database.password,
      database: config.database.name
    });
    
    console.log('✅ Final connection test successful!');
    await testConnection.end();
    
    console.log('\n🎉 Database setup completed successfully!');
    console.log('📋 Configuration summary:');
    console.log(`   Database: ${config.database.name}`);
    console.log(`   User: ${config.database.user}`);
    console.log(`   Host: ${config.database.host}:${config.database.port}`);
    console.log('\n✅ Your application should now be able to connect to the database');
    
    return true;
    
  } catch (error) {
    console.error('\n❌ Database setup failed:');
    console.error(`   Error: ${error.message}`);
    
    console.log('\n🔧 Manual setup instructions:');
    console.log('1. Start MySQL:');
    console.log('   brew services start mysql');
    console.log('');
    console.log('2. Connect to MySQL as root:');
    console.log('   mysql -u root -p');
    console.log('');
    console.log('3. Run these commands in MySQL:');
    console.log(`   CREATE DATABASE IF NOT EXISTS \`${config.database.name}\`;`);
    console.log(`   CREATE USER IF NOT EXISTS '${config.database.user}'@'localhost' IDENTIFIED BY '${config.database.password}';`);
    console.log(`   GRANT ALL PRIVILEGES ON \`${config.database.name}\`.* TO '${config.database.user}'@'localhost';`);
    console.log('   FLUSH PRIVILEGES;');
    console.log('   EXIT;');
    
    return false;
    
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

// Run the setup
setupDatabase()
  .then(success => {
    if (success) {
      console.log('\n✅ DATABASE SETUP COMPLETED');
      process.exit(0);
    } else {
      console.log('\n❌ DATABASE SETUP FAILED');
      process.exit(1);
    }
  })
  .catch(error => {
    console.error('\n💥 Setup error:', error);
    process.exit(1);
  });