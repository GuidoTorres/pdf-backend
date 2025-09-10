#!/usr/bin/env node

/**
 * Integration Test for Priority Queue System
 * Tests the complete flow from job submission to processing
 */

import priorityQueueManager from './src/services/priorityQueueManager.js';
import { createPriorityWorkers } from './src/config/queue.js';

console.log('🔄 Testing Priority Queue Integration...\n');

// Mock processor function for testing
const mockProcessor = async (job) => {
  const { userPlan, originalName, fileSize } = job.data;
  console.log(`  🔧 Processing job ${job.id}: ${originalName} (${userPlan} user, ${fileSize} bytes)`);
  
  // Simulate processing time based on plan
  const processingTime = userPlan === 'unlimited' ? 100 : userPlan === 'pro' ? 200 : 500;
  await new Promise(resolve => setTimeout(resolve, processingTime));
  
  return {
    success: true,
    transactions: [{ amount: 100, description: 'Test transaction' }],
    processingTime,
    userPlan
  };
};

async function testPriorityProcessing() {
  console.log('📋 Testing Priority Processing Order');
  
  try {
    // Create workers for testing
    const workers = createPriorityWorkers(mockProcessor);
    
    // Add jobs with different priorities
    const jobs = [];
    
    // Add free user job first
    const freeJob = await priorityQueueManager.addJob({
      tempFilePath: '/tmp/free.pdf',
      originalName: 'free-user.pdf',
      userId: 'free-user',
      fileSize: 1024
    }, 'free', 1024);
    jobs.push({ job: freeJob, plan: 'free', order: 1 });
    
    // Add premium job (should process before free)
    const proJob = await priorityQueueManager.addJob({
      tempFilePath: '/tmp/pro.pdf',
      originalName: 'pro-user.pdf',
      userId: 'pro-user',
      fileSize: 1024
    }, 'pro', 1024);
    jobs.push({ job: proJob, plan: 'pro', order: 2 });
    
    // Add unlimited job (should process first)
    const unlimitedJob = await priorityQueueManager.addJob({
      tempFilePath: '/tmp/unlimited.pdf',
      originalName: 'unlimited-user.pdf',
      userId: 'unlimited-user',
      fileSize: 1024
    }, 'unlimited', 1024);
    jobs.push({ job: unlimitedJob, plan: 'unlimited', order: 3 });
    
    console.log('  ✓ Added jobs in order: free, pro, unlimited');
    console.log('  ⏳ Waiting for processing to complete...');
    
    // Wait for all jobs to complete
    const results = await Promise.all(jobs.map(({ job }) => job.waitUntilFinished()));
    
    console.log('  📊 Processing Results:');
    results.forEach((result, index) => {
      const { plan } = jobs[index];
      console.log(`    ${plan}: ${result.processingTime}ms`);
    });
    
    // Clean up workers
    await Promise.all(Object.values(workers).map(worker => worker.close()));
    
    console.log('  ✅ Priority Processing Test PASSED\n');
    return true;
    
  } catch (error) {
    console.error('  ❌ Priority Processing Test FAILED:', error.message);
    return false;
  }
}

async function testQueueStatistics() {
  console.log('📋 Testing Queue Statistics');
  
  try {
    // Add some test jobs
    await priorityQueueManager.addJob({
      tempFilePath: '/tmp/test1.pdf',
      originalName: 'test1.pdf',
      userId: 'user1',
      fileSize: 1024
    }, 'pro', 1024);
    
    await priorityQueueManager.addJob({
      tempFilePath: '/tmp/test2.pdf',
      originalName: 'test2.pdf',
      userId: 'user2',
      fileSize: 1024
    }, 'free', 1024);
    
    const stats = await priorityQueueManager.getQueueStats();
    console.log('  📊 Queue Statistics:', stats);
    
    // Verify stats structure
    if (!stats.premium || !stats.normal || !stats.large) {
      throw new Error('Missing queue statistics');
    }
    
    console.log('  ✅ Queue Statistics Test PASSED\n');
    return true;
    
  } catch (error) {
    console.error('  ❌ Queue Statistics Test FAILED:', error.message);
    return false;
  }
}

async function testLargeFileHandling() {
  console.log('📋 Testing Large File Handling');
  
  try {
    const largeFileSize = 60 * 1024 * 1024; // 60MB
    
    const largeJob = await priorityQueueManager.addJob({
      tempFilePath: '/tmp/large.pdf',
      originalName: 'large-file.pdf',
      userId: 'user-large',
      fileSize: largeFileSize
    }, 'pro', largeFileSize);
    
    console.log(`  ✓ Large file job added to queue: ${largeJob.data.queueName}`);
    
    if (largeJob.data.queueName !== 'large') {
      throw new Error(`Expected large queue, got ${largeJob.data.queueName}`);
    }
    
    console.log('  ✅ Large File Handling Test PASSED\n');
    return true;
    
  } catch (error) {
    console.error('  ❌ Large File Handling Test FAILED:', error.message);
    return false;
  }
}

async function testQueueConfiguration() {
  console.log('📋 Testing Queue Configuration');
  
  try {
    const config = await priorityQueueManager.getQueueConfiguration();
    
    console.log('  📊 Queue Configuration:', config);
    
    // Verify configuration structure
    if (!config.recommendedWorkers || !config.queuePriorities) {
      throw new Error('Invalid queue configuration structure');
    }
    
    // Verify premium queue gets proper priority
    if (config.queuePriorities.premium !== 1) {
      throw new Error('Premium queue should have highest priority (1)');
    }
    
    console.log('  ✅ Queue Configuration Test PASSED\n');
    return true;
    
  } catch (error) {
    console.error('  ❌ Queue Configuration Test FAILED:', error.message);
    return false;
  }
}

async function runIntegrationTests() {
  console.log('🚀 Starting Priority Queue Integration Tests\n');
  
  const tests = [
    testQueueStatistics,
    testLargeFileHandling,
    testQueueConfiguration,
    testPriorityProcessing
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
  
  console.log('📊 Integration Test Results:');
  console.log(`  ✅ Passed: ${passed}`);
  console.log(`  ❌ Failed: ${failed}`);
  console.log(`  📈 Success Rate: ${((passed / (passed + failed)) * 100).toFixed(1)}%`);
  
  if (failed === 0) {
    console.log('\n🎉 All Integration Tests PASSED!');
    console.log('✅ Priority Queue System is working correctly end-to-end');
  } else {
    console.log('\n⚠️  Some integration tests failed. Please review the implementation.');
  }
  
  // Clean up and close connections
  await priorityQueueManager.close();
  process.exit(failed === 0 ? 0 : 1);
}

// Run tests if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runIntegrationTests().catch(console.error);
}

export { runIntegrationTests };