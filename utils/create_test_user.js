#!/usr/bin/env node

/**
 * Create a test user for queue testing
 */

import databaseService from './src/services/databaseService.js';

console.log('[CREATE-USER] Creating test user...');

async function createTestUser() {
  const testUserId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'; // Fixed UUID for testing
  const subscriptionId = 'b2c3d4e5-f6g7-8901-bcde-f23456789012'; // Subscription UUID
  
  try {
    // Use raw SQL to insert the user
    const mysql = await import('mysql2/promise');
    const connection = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      port: process.env.DB_PORT || 3306,
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || 'root',
      database: process.env.DB_NAME || 'stamentai'
    });
    
    // Check if user exists first
    const [existing] = await connection.execute(
      'SELECT id FROM users WHERE id = ?',
      [testUserId]
    );
    
    if (existing.length > 0) {
      console.log('[CREATE-USER] Test user already exists');
      await connection.end();
      return;
    }
    
    // Create test user with proper UUID and correct field names
    await connection.execute(
      'INSERT INTO users (id, email, name, password_hash, email_verified, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [testUserId, 'test@example.com', 'Test User', 'hashed_password_placeholder', true, new Date(), new Date()]
    );
    
    // Create subscription for the test user
    await connection.execute(
      'INSERT INTO subscriptions (id, user_id, plan, pages_remaining, renewed_at, next_reset, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        subscriptionId,
        testUserId,
        'free',
        100, // Give test user 100 pages
        new Date(),
        new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
        'active',
        new Date(),
        new Date()
      ]
    );
    
    await connection.end();
    
    console.log('[CREATE-USER] ✅ Test user and subscription created successfully');
    
  } catch (error) {
    console.error('[CREATE-USER] ❌ Error creating test user:', error);
  }
}

createTestUser()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('[CREATE-USER] ❌ Unexpected error:', error);
    process.exit(1);
  });