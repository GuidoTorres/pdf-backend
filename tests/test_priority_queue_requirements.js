#!/usr/bin/env node

/**
 * Test Priority Queue System Requirements
 * Tests Requirements 2.1, 2.2, 2.3, 2.4, 2.5 from scalable-pdf-processing spec
 */

import priorityQueueManager from './src/services/priorityQueueManager.js';
import { createPriorityWorkers } from './src/config/queue.js';

console.log('🧪 Testing Priority Queue System Requirements...\n');

async function testRequirement21_PremiumHighPriority() {
  console.log('📋 Testing Requirement 2.1: Premium users get high priority queue');
  
  const testCases = [
    { plan: 'pro', expectedQueue: 'premium' },
    { plan: 'enterprise', expectedQueue: 'premium' },
    { plan: 'unlimited', expectedQueue: 'premium' },
    { plan: 'ilimitado', expectedQueue: 'premium' }
  ];
  
  for (const testCase of testCases) {
    const queue = priorityQueueManager.determineQueue(testCase.plan, 1024); // 1KB file
    const priority = priorityQueueManager.calculatePriority(testCase.plan);
    
    console.log(`  ✓ Plan: ${testCase.plan} → Queue: ${queue}, Priority: ${priority}`);
    
    if (queue !== testCase.expectedQueue) {
      console.error(`  ❌ FAILED: Expected ${testCase.expectedQueue}, got ${queue}`);
      return false;
    }
  }
  
  console.log('  ✅ Requirement 2.1 PASSED\n');
  return true;
}

async function testRequirement22_HighPriorityFirst() {
  console.log('📋 Testing Requirement 2.2: High priority jobs process before normal');
  
  const premiumPriority = priorityQueueManager.calculatePriority('pro');
  const normalPriority = priorityQueueManager.calculatePriority('free');
  
  console.log(`  Premium priority: ${premiumPriority}`);
  console.log(`  Normal priority: ${normalPriority}`);
  
  if (premiumPriority >= normalPriority) {
    console.error('  ❌ FAILED: Premium priority should be lower (higher priority) than normal');
    return false;
  }
  
  console.log('  ✅ Requirement 2.2 PASSED\n');
  return true;
}

async function testRequirement23_UnlimitedMaxPriority() {
  console.log('📋 Testing Requirement 2.3: Unlimited users get maximum priority');
  
  const unlimitedPriority = priorityQueueManager.calculatePriority('unlimited');
  const ilimitadoPriority = priorityQueueManager.calculatePriority('ilimitado');
  const proPriority = priorityQueueManager.calculatePriority('pro');
  const enterprisePriority = priorityQueueManager.calculatePriority('enterprise');
  
  console.log(`  Unlimited priority: ${unlimitedPriority}`);
  console.log(`  Ilimitado priority: ${ilimitadoPriority}`);
  console.log(`  Pro priority: ${proPriority}`);
  console.log(`  Enterprise priority: ${enterprisePriority}`);
  
  if (unlimitedPriority !== 1 || ilimitadoPriority !== 1) {
    console.error('  ❌ FAILED: Unlimited plans should have priority 1 (maximum)');
    return false;
  }
  
  if (unlimitedPriority >= proPriority || unlimitedPriority >= enterprisePriority) {
    console.error('  ❌ FAILED: Unlimited should have higher priority than other plans');
    return false;
  }
  
  console.log('  ✅ Requirement 2.3 PASSED\n');
  return true;
}

async function testRequirement24_FreeNormalQueue() {
  console.log('📋 Testing Requirement 2.4: Free users use normal priority queue');
  
  const testCases = [
    { plan: 'free', expectedQueue: 'normal' },
    { plan: 'basic', expectedQueue: 'normal' }
  ];
  
  for (const testCase of testCases) {
    const queue = priorityQueueManager.determineQueue(testCase.plan, 1024); // 1KB file
    const priority = priorityQueueManager.calculatePriority(testCase.plan);
    
    console.log(`  ✓ Plan: ${testCase.plan} → Queue: ${queue}, Priority: ${priority}`);
    
    if (queue !== testCase.expectedQueue) {
      console.error(`  ❌ FAILED: Expected ${testCase.expectedQueue}, got ${queue}`);
      return false;
    }
  }
  
  console.log('  ✅ Requirement 2.4 PASSED\n');
  return true;
}

async function testRequirement25_DedicatedWorkers() {
  console.log('📋 Testing Requirement 2.5: Dedicated workers for premium users under high load');
  
  // Test queue configuration under different load scenarios
  const queueStats = await priorityQueueManager.getQueueStats();
  const config = await priorityQueueManager.getQueueConfiguration();
  
  console.log('  Current queue stats:', queueStats);
  console.log('  Queue configuration:', config);
  
  // Verify premium queue gets priority in worker allocation
  if (config.recommendedWorkers.premium < 1) {
    console.error('  ❌ FAILED: Premium queue should always have at least 1 worker');
    return false;
  }
  
  // Under high load, premium should get at least 2 workers
  if (config.isHighLoad && config.recommendedWorkers.premium < 2) {
    console.error('  ❌ FAILED: Premium queue should have at least 2 workers under high load');
    return false;
  }
  
  console.log('  ✅ Requirement 2.5 PASSED\n');
  return true;
}

async function testLargeFileHandling() {
  console.log('📋 Testing Large File Handling (>50MB)');
  
  const largeFileSize = 60 * 1024 * 1024; // 60MB
  const premiumQueue = priorityQueueManager.determineQueue('pro', largeFileSize);
  const freeQueue = priorityQueueManager.determineQueue('free', largeFileSize);
  
  console.log(`  Premium user with large file → Queue: ${premiumQueue}`);
  console.log(`  Free user with large file → Queue: ${freeQueue}`);
  
  if (premiumQueue !== 'large' || freeQueue !== 'large') {
    console.error('  ❌ FAILED: Large files should go to large queue regardless of plan');
    return false;
  }
  
  console.log('  ✅ Large File Handling PASSED\n');
  return true;
}

async function testJobAddition() {
  console.log('📋 Testing Job Addition to Priority Queues');
  
  try {
    const jobData = {
      tempFilePath: '/tmp/test.pdf',
      originalName: 'test.pdf',
      userId: 'test-user-123',
      fileSize: 1024,
      uploadedAt: new Date().toISOString()
    };
    
    // Test adding jobs with different plans
    const premiumJob = await priorityQueueManager.addJob(jobData, 'pro', 1024);
    console.log(`  ✓ Premium job added: ${premiumJob.id} to queue ${premiumJob.data.queueName}`);
    
    const freeJob = await priorityQueueManager.addJob(jobData, 'free', 1024);
    console.log(`  ✓ Free job added: ${freeJob.id} to queue ${freeJob.data.queueName}`);
    
    const unlimitedJob = await priorityQueueManager.addJob(jobData, 'unlimited', 1024);
    console.log(`  ✓ Unlimited job added: ${unlimitedJob.id} to queue ${unlimitedJob.data.queueName}`);
    
    // Verify job data contains priority information
    if (!premiumJob.data.priority || !premiumJob.data.queueName) {
      console.error('  ❌ FAILED: Job data missing priority information');
      return false;
    }
    
    console.log('  ✅ Job Addition PASSED\n');
    return true;
    
  } catch (error) {
    console.error('  ❌ FAILED: Error adding jobs:', error.message);
    return false;
  }
}

async function runAllTests() {
  console.log('🚀 Starting Priority Queue System Tests\n');
  
  const tests = [
    testRequirement21_PremiumHighPriority,
    testRequirement22_HighPriorityFirst,
    testRequirement23_UnlimitedMaxPriority,
    testRequirement24_FreeNormalQueue,
    testRequirement25_DedicatedWorkers,
    testLargeFileHandling,
    testJobAddition
  ];
  
  let passed = 0;
  let failed = 0;
  
  for (const test of tests) {
    try {
      const result = await test();
      if (result) {
        passed++;
      } else {
        failed++;
      }
    } catch (error) {
      console.error(`❌ Test failed with error: ${error.message}\n`);
      failed++;
    }
  }
  
  console.log('📊 Test Results:');
  console.log(`  ✅ Passed: ${passed}`);
  console.log(`  ❌ Failed: ${failed}`);
  console.log(`  📈 Success Rate: ${((passed / (passed + failed)) * 100).toFixed(1)}%`);
  
  if (failed === 0) {
    console.log('\n🎉 All Priority Queue Requirements PASSED!');
    console.log('✅ Task 1: Priority Queue System Implementation COMPLETE');
  } else {
    console.log('\n⚠️  Some tests failed. Please review the implementation.');
  }
  
  // Clean up and close connections
  await priorityQueueManager.close();
  process.exit(failed === 0 ? 0 : 1);
}

// Run tests if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runAllTests().catch(console.error);
}

export { runAllTests };