#!/usr/bin/env node
/**
 * Test Script: Unlimited User Functionality
 * This script tests the unlimited access functionality
 */

import database from '../src/config/database.js';
import { User, Subscription } from '../src/models/index.js';
import userService from '../src/services/userService.js';
import logService from '../src/services/logService.js';

// Test counter
let testsPassed = 0;
let totalTests = 0;

function test(description, condition) {
  totalTests++;
  if (condition) {
    console.log(`✅ ${description}`);
    testsPassed++;
  } else {
    console.log(`❌ ${description}`);
  }
}

async function runUnlimitedTests() {
  try {
    await database.sync();
    console.log('🧪 Testing Unlimited User Functionality\n');

    // Test 1: Check if unlimited_access field exists in User model
    console.log('📋 Test 1: Checking User model unlimited_access field...');
    const userAttributes = User.getTableName ? Object.keys(User.rawAttributes) : Object.keys(User.getAttributes());
    test('User model has unlimited_access field', userAttributes.includes('unlimited_access'));

    // Test 2: Check if unlimited plan exists in Subscription model
    console.log('\n📋 Test 2: Checking Subscription model unlimited plan...');
    const subscriptionPlanEnum = Subscription.rawAttributes.plan.values;
    test('Subscription model includes unlimited plan', subscriptionPlanEnum.includes('unlimited'));

    // Test 3: Create a test user with unlimited access
    console.log('\n📋 Test 3: Creating test user with unlimited access...');
    
    // Clean up any existing test user
    await User.destroy({ where: { email: 'test-unlimited@example.com' } });
    
    const testUser = await User.create({
      email: 'test-unlimited@example.com',
      name: 'Test Unlimited User',
      unlimited_access: true
    });

    const testSubscription = await Subscription.create({
      user_id: testUser.id,
      plan: 'unlimited',
      pages_remaining: 999999
    });

    test('Test unlimited user created successfully', testUser && testUser.unlimited_access === true);
    test('Test unlimited subscription created successfully', testSubscription && testSubscription.plan === 'unlimited');

    // Test 4: Test page deduction for unlimited user
    console.log('\n📋 Test 4: Testing page deduction for unlimited user...');
    
    const deductionResult = await userService.deductPages(testUser.id, 10);
    
    test('Unlimited user pages not deducted', deductionResult.deducted === 0);
    test('Unlimited user pages_remaining unchanged', deductionResult.remaining === 999999);
    test('Deduction result indicates unlimited access', deductionResult.unlimited === true);

    // Test 5: Create regular user and test normal deduction
    console.log('\n📋 Test 5: Testing normal page deduction for regular user...');
    
    // Clean up any existing test user
    await User.destroy({ where: { email: 'test-regular@example.com' } });
    
    const regularUser = await User.create({
      email: 'test-regular@example.com',
      name: 'Test Regular User',
      unlimited_access: false
    });

    const regularSubscription = await Subscription.create({
      user_id: regularUser.id,
      plan: 'pro',
      pages_remaining: 100
    });

    const regularDeductionResult = await userService.deductPages(regularUser.id, 10);
    
    test('Regular user pages deducted correctly', regularDeductionResult.deducted === 10);
    test('Regular user pages_remaining decreased', regularDeductionResult.remaining === 90);
    test('Regular user result does not indicate unlimited', !regularDeductionResult.unlimited);

    // Test 6: Test getUserWithSubscription includes unlimited_access
    console.log('\n📋 Test 6: Testing getUserWithSubscription includes unlimited_access...');
    
    const userWithSub = await userService.getUserWithSubscription(testUser.id);
    test('getUserWithSubscription returns unlimited_access field', userWithSub.unlimited_access === true);

    // Clean up test data
    console.log('\n🧹 Cleaning up test data...');
    await User.destroy({ where: { email: 'test-unlimited@example.com' } });
    await User.destroy({ where: { email: 'test-regular@example.com' } });
    console.log('✅ Test data cleaned up');

    console.log('\n🎉 Test Results Summary:');
    console.log(`   ✅ Tests passed: ${testsPassed}/${totalTests}`);
    console.log(`   📊 Success rate: ${Math.round((testsPassed / totalTests) * 100)}%`);
    
    if (testsPassed === totalTests) {
      console.log('\n🏆 ALL TESTS PASSED! Unlimited functionality is working correctly.');
      return true;
    } else {
      console.log('\n⚠️  Some tests failed. Please check the implementation.');
      return false;
    }

  } catch (error) {
    console.error('\n❌ Test execution failed:', error.message);
    console.error('Error details:', error);
    return false;
  } finally {
    await database.close();
  }
}

// Run tests
console.log('🔬 Unlimited Functionality Test Suite');
console.log('===================================\n');

runUnlimitedTests()
  .then(success => {
    if (success) {
      console.log('\n✅ ALL TESTS COMPLETED SUCCESSFULLY');
      process.exit(0);
    } else {
      console.log('\n❌ SOME TESTS FAILED');
      process.exit(1);
    }
  })
  .catch(error => {
    console.error('\n💥 Unexpected error:', error);
    process.exit(1);
  });