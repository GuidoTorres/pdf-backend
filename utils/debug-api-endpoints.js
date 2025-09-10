import express from 'express';
import database from './src/config/database.js';
import databaseService from './src/services/databaseService.js';
import { User, Subscription, Document } from './src/models/index.js';

// Initialize database models
import './src/models/index.js';

async function debugEndpoints() {
  try {
    // Sync database first
    await database.sync();
    console.log('✅ Database synchronized');

    // 1. Check if we have any users
    const users = await User.findAll({ 
      include: [{ model: Subscription, as: 'subscription' }],
      limit: 5 
    });
    
    console.log('\n📊 USERS IN DATABASE:');
    console.log(`Total users: ${users.length}`);
    
    if (users.length > 0) {
      const user = users[0];
      console.log('\n👤 FIRST USER DATA:');
      console.log('User ID:', user.id);
      console.log('Email:', user.email);
      console.log('Name:', user.name);
      console.log('Subscription:', user.subscription ? {
        plan: user.subscription.plan,
        pages_remaining: user.subscription.pages_remaining,
        renewed_at: user.subscription.renewed_at,
        next_reset: user.subscription.next_reset
      } : 'NO SUBSCRIPTION');

      // 2. Test getUserInfo function
      console.log('\n🔍 TESTING getUserInfo():');
      try {
        const userInfo = await databaseService.getUserInfo(user.id);
        console.log('getUserInfo result:', JSON.stringify(userInfo, null, 2));
      } catch (error) {
        console.error('❌ getUserInfo failed:', error.message);
      }

      // 3. Check user documents
      console.log('\n📄 USER DOCUMENTS:');
      const documents = await databaseService.getUserDocuments(user.id);
      console.log(`Total documents for user: ${documents.length}`);
      
      if (documents.length > 0) {
        const doc = documents[0];
        console.log('First document:', {
          id: doc.id,
          job_id: doc.job_id,
          original_file_name: doc.original_file_name,
          status: doc.status,
          progress: doc.progress,
          page_count: doc.page_count,
          transactions: doc.transactions ? 'HAS TRANSACTIONS' : 'NO TRANSACTIONS',
          metadata: doc.metadata ? 'HAS METADATA' : 'NO METADATA'
        });
      } else {
        console.log('No documents found for user');
      }

      // 4. Check all subscriptions
      console.log('\n💳 ALL SUBSCRIPTIONS:');
      const subscriptions = await Subscription.findAll();
      console.log(`Total subscriptions: ${subscriptions.length}`);
      subscriptions.forEach((sub, index) => {
        console.log(`Subscription ${index + 1}:`, {
          user_id: sub.user_id,
          plan: sub.plan,
          pages_remaining: sub.pages_remaining,
          status: sub.status,
          renewed_at: sub.renewed_at,
          next_reset: sub.next_reset
        });
      });

    } else {
      console.log('❌ No users found in database');
      
      // Create a test user
      console.log('\n🔧 Creating test user...');
      const testUser = await databaseService.createUserProfile({
        email: 'test@example.com',
        name: 'Test User',
        password: 'testpassword123',
        email_verified: true
      });
      
      console.log('✅ Test user created:', {
        id: testUser.id,
        email: testUser.email,
        name: testUser.name
      });

      // Check if subscription was created
      const testUserInfo = await databaseService.getUserInfo(testUser.id);
      console.log('Test user info with subscription:', JSON.stringify(testUserInfo, null, 2));
    }

    // 5. Check documents table structure
    console.log('\n🗄️  DOCUMENTS TABLE STRUCTURE:');
    const allDocuments = await Document.findAll({ limit: 3 });
    console.log(`Total documents: ${allDocuments.length}`);
    
    if (allDocuments.length > 0) {
      const doc = allDocuments[0];
      console.log('Sample document structure:', {
        id: doc.id,
        user_id: doc.user_id,
        job_id: doc.job_id,
        original_file_name: doc.original_file_name,
        file_size: doc.file_size,
        page_count: doc.page_count,
        status: doc.status,
        step: doc.step,
        progress: doc.progress,
        provider: doc.provider,
        transactions: doc.transactions ? 'HAS_DATA' : null,
        metadata: doc.metadata ? 'HAS_DATA' : null,
        error_message: doc.error_message,
        original_credit: doc.original_credit,
        original_debit: doc.original_debit,
        original_amount: doc.original_amount,
        sign_detection_method: doc.sign_detection_method,
        created_at: doc.created_at,
        updated_at: doc.updated_at
      });
    }

  } catch (error) {
    console.error('❌ Debug failed:', error);
    console.error(error.stack);
  } finally {
    await database.close();
    process.exit(0);
  }
}

console.log('🚀 Starting backend API endpoints debug...\n');
debugEndpoints();