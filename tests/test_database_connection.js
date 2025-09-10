#!/usr/bin/env node
/**
 * Simple Database Connection Test
 * Tests MySQL connection with current credentials
 */

import mysql from 'mysql2/promise';
import config from './src/config/config.js';

console.log('🔍 Testing MySQL Database Connection...\n');

async function testDatabaseConnection() {
  console.log('📋 Database Configuration:');
  console.log(`   Host: ${config.database.host}`);
  console.log(`   Port: ${config.database.port}`);
  console.log(`   Database: ${config.database.name}`);
  console.log(`   User: ${config.database.user}`);
  console.log(`   Password: ${config.database.password ? '***' : 'EMPTY'}\n`);

  try {
    // Test 1: Try to connect to MySQL server (without specific database)
    console.log('🔌 Test 1: Connecting to MySQL server...');
    const serverConnection = await mysql.createConnection({
      host: config.database.host,
      port: config.database.port,
      user: config.database.user,
      password: config.database.password
    });
    
    console.log('✅ Successfully connected to MySQL server');
    
    // Test 2: Check if database exists
    console.log('\n🗄️  Test 2: Checking if database exists...');
    const [databases] = await serverConnection.execute('SHOW DATABASES');
    const dbExists = databases.some(db => db.Database === config.database.name);
    
    if (dbExists) {
      console.log(`✅ Database '${config.database.name}' exists`);
    } else {
      console.log(`⚠️  Database '${config.database.name}' does not exist`);
      
      // Create database
      console.log(`🔧 Creating database '${config.database.name}'...`);
      await serverConnection.execute(`CREATE DATABASE IF NOT EXISTS \`${config.database.name}\``);
      console.log(`✅ Database '${config.database.name}' created successfully`);
    }
    
    await serverConnection.end();
    
    // Test 3: Connect to specific database
    console.log('\n🎯 Test 3: Connecting to specific database...');
    const dbConnection = await mysql.createConnection({
      host: config.database.host,
      port: config.database.port,
      user: config.database.user,
      password: config.database.password,
      database: config.database.name
    });
    
    console.log(`✅ Successfully connected to database '${config.database.name}'`);
    
    // Test 4: Check tables
    console.log('\n📊 Test 4: Checking existing tables...');
    const [tables] = await dbConnection.execute('SHOW TABLES');
    console.log(`📋 Found ${tables.length} tables:`);
    tables.forEach(table => {
      const tableName = table[`Tables_in_${config.database.name}`];
      console.log(`   - ${tableName}`);
    });
    
    await dbConnection.end();
    
    console.log('\n🎉 All database connection tests passed!');
    console.log('✅ Your database is ready for the application');
    
    return true;
    
  } catch (error) {
    console.error('\n❌ Database connection failed:');
    console.error(`   Error: ${error.message}`);
    console.error(`   Code: ${error.code}`);
    
    if (error.code === 'ER_ACCESS_DENIED_ERROR') {
      console.log('\n🔧 Possible solutions:');
      console.log('   1. Check if MySQL is running: brew services start mysql');
      console.log('   2. Reset MySQL root password:');
      console.log('      mysql -u root -p');
      console.log('      ALTER USER \'root\'@\'localhost\' IDENTIFIED BY \'root\';');
      console.log('   3. Or create a new user:');
      console.log('      CREATE USER \'stamentai\'@\'localhost\' IDENTIFIED BY \'password\';');
      console.log('      GRANT ALL PRIVILEGES ON stamentai.* TO \'stamentai\'@\'localhost\';');
      console.log('      FLUSH PRIVILEGES;');
    } else if (error.code === 'ECONNREFUSED') {
      console.log('\n🔧 MySQL server is not running. Start it with:');
      console.log('   brew services start mysql');
      console.log('   # or');
      console.log('   sudo systemctl start mysql');
    }
    
    return false;
  }
}

// Run the test
testDatabaseConnection()
  .then(success => {
    if (success) {
      console.log('\n✅ DATABASE CONNECTION TEST PASSED');
      process.exit(0);
    } else {
      console.log('\n❌ DATABASE CONNECTION TEST FAILED');
      process.exit(1);
    }
  })
  .catch(error => {
    console.error('\n💥 Unexpected error:', error);
    process.exit(1);
  });