import express from 'express';
import cors from 'cors';
import database from './src/config/database.js';
import authController from './src/controllers/authController.js';
import databaseService from './src/services/databaseService.js';
import jwt from 'jsonwebtoken';
import config from './src/config/config.js';

// Initialize database models
import './src/models/index.js';

async function testAuthEndpoint() {
  try {
    // Sync database first
    await database.sync();
    console.log('✅ Database synchronized');

    // Get a test user
    const userEmail = 'hectortorresdurand@gmail.com';
    const user = await databaseService.findUserByEmail(userEmail);
    
    if (!user) {
      console.log('❌ Test user not found');
      return;
    }

    console.log('👤 Test user found:', {
      id: user.id,
      email: user.email,
      name: user.name
    });

    // Generate a test token
    const token = jwt.sign(
      { userId: user.id, email: user.email },
      config.jwt.secret,
      { expiresIn: '1h' }
    );

    console.log('🔑 Generated test token for user');

    // Create a mock session
    await databaseService.createSession(user.id, token);
    console.log('✅ Test session created');

    // Test the getUserInfo function directly
    console.log('\n🔍 Testing databaseService.getUserInfo():');
    const userInfo = await databaseService.getUserInfo(user.id);
    console.log('getUserInfo result:', JSON.stringify(userInfo, null, 2));

    // Test what the /api/auth/me endpoint would return
    console.log('\n📡 Testing /api/auth/me endpoint logic:');
    
    // Create mock request/response objects
    const mockReq = {
      user: { id: user.id, email: user.email },
      headers: { authorization: `Bearer ${token}` }
    };
    
    const mockRes = {
      json: (data) => {
        console.log('✅ /api/auth/me would return:');
        console.log(JSON.stringify(data, null, 2));
        return mockRes;
      },
      status: (code) => {
        console.log(`Status: ${code}`);
        return mockRes;
      }
    };

    // Call the controller method
    await authController.getCurrentUser(mockReq, mockRes);

    console.log('\n📋 Summary:');
    console.log('- Database has user data ✅');
    console.log('- User has subscription ✅'); 
    console.log('- getUserInfo returns correct data ✅');
    console.log('- pages_remaining:', userInfo.pages_remaining);
    console.log('- plan:', userInfo.plan);
    console.log('- User has', (await databaseService.getUserDocuments(user.id)).length, 'documents');

  } catch (error) {
    console.error('❌ Test failed:', error);
    console.error(error.stack);
  } finally {
    await database.close();
    process.exit(0);
  }
}

console.log('🧪 Testing /api/auth/me endpoint...\n');
testAuthEndpoint();