#!/usr/bin/env node

/**
 * Debug script to test unlimited user functionality specifically
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { config } from 'dotenv';

// Setup dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
config({ path: join(__dirname, '.env') });

// Import services
import userService from './src/services/userService.js';

const TARGET_USER_ID = '37cbe336-ba49-48a6-8342-0f08b403a4c7';

async function debugUnlimitedUser() {
  try {
    console.log('🔍 Testing unlimited user functionality...\n');
    console.log(`👤 Target User ID: ${TARGET_USER_ID}\n`);

    // Test 1: Check getUserWithSubscription
    console.log('📋 Test 1: getUserWithSubscription');
    const user = await userService.getUserWithSubscription(TARGET_USER_ID);
    console.log('   Result:', {
      id: user.id,
      email: user.email,
      unlimited_access: user.unlimited_access,
      hasSubscription: !!user.subscription,
      subscriptionPlan: user.subscription ? user.subscription.plan : null,
      pagesRemaining: user.subscription ? user.subscription.pages_remaining : null
    });

    // Test 2: Check checkUserPages
    console.log('\n📋 Test 2: checkUserPages');
    const pageCheck = await userService.checkUserPages(TARGET_USER_ID);
    console.log('   Result:', pageCheck);

    // Test 3: Test deductPages
    console.log('\n📋 Test 3: deductPages (trying to deduct 1 page)');
    const deductResult = await userService.deductPages(TARGET_USER_ID, 1);
    console.log('   Result:', deductResult);

    console.log('\n✅ All tests completed successfully!');
    process.exit(0);

  } catch (error) {
    console.error('\n❌ Error during testing:', error);
    console.error('Stack trace:', error.stack);
    process.exit(1);
  }
}

debugUnlimitedUser();