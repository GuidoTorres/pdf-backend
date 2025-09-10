import dotenv from 'dotenv';
dotenv.config();

import databaseService from './src/services/databaseService.js';

async function debugDocuments() {
  try {
    console.log('🔍 Debugging document history...');
    
    // Import the Document model directly
    await databaseService.initDatabase();
    const { Document } = await import('./src/models/index.js');
    
    // Check all documents
    const allDocs = await Document.findAll({
      order: [['created_at', 'DESC']],
      limit: 10
    });
    
    console.log(`📊 Total documents found: ${allDocs.length}`);
    
    if (allDocs.length > 0) {
      console.log('\n📋 Recent documents:');
      allDocs.forEach((doc, index) => {
        console.log(`${index + 1}. ID: ${doc.id}`);
        console.log(`   Job ID: ${doc.job_id}`);
        console.log(`   User ID: ${doc.user_id}`);
        console.log(`   File: ${doc.original_file_name}`);
        console.log(`   Status: ${doc.status}`);
        console.log(`   Created: ${doc.created_at}`);
        console.log(`   Transactions: ${doc.transactions ? JSON.parse(doc.transactions).length : 0}`);
        console.log('   ---');
      });
    } else {
      console.log('❌ No documents found in database');
    }
    
    // Check by specific user (you might need to adjust this)
    console.log('\n🔍 Checking for specific user...');
    const userDocs = await databaseService.getUserDocuments(1); // Assuming user ID 1
    console.log(`📊 Documents for user 1: ${userDocs.length}`);
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error debugging documents:', error);
    process.exit(1);
  }
}

debugDocuments();