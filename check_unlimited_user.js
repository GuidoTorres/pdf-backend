#!/usr/bin/env node

/**
 * Quick script to check unlimited_access field for a user
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { config } from 'dotenv';

// Setup dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
config({ path: join(__dirname, '.env') });

// Import models
import { User, Subscription } from './src/models/index.js';

async function checkUnlimitedUser() {
  try {
    console.log('🔍 Checking unlimited_access users in database...\n');

    // Find all users with unlimited_access = true
    const unlimitedUsers = await User.findAll({
      where: { unlimited_access: true },
      include: [{
        model: Subscription,
        as: 'subscription',
        required: false
      }]
    });

    if (unlimitedUsers.length === 0) {
      console.log('❌ No users found with unlimited_access = true');
      console.log('\n📋 Checking all users unlimited_access status...');
      
      const allUsers = await User.findAll({
        include: [{
          model: Subscription,
          as: 'subscription',
          required: false
        }]
      });

      allUsers.forEach(user => {
        console.log(`   👤 ${user.email}: unlimited_access = ${user.unlimited_access}`);
      });
    } else {
      console.log(`✅ Found ${unlimitedUsers.length} user(s) with unlimited access:`);
      unlimitedUsers.forEach(user => {
        console.log(`   👤 ${user.email} (ID: ${user.id})`);
        console.log(`      🔓 unlimited_access: ${user.unlimited_access}`);
        console.log(`      📋 Subscription: ${user.subscription ? user.subscription.plan : 'None'}`);
        console.log(`      📄 Pages remaining: ${user.subscription ? user.subscription.pages_remaining : 'N/A'}`);
        console.log('');
      });
    }

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

checkUnlimitedUser();