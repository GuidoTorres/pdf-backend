import priorityQueueManager from './src/services/priorityQueueManager.js';
import userService from './src/services/userService.js';

/**
 * Simple integration test for priority queue system
 * Tests the complete flow without workers
 */

console.log('🔄 Testing Priority Queue Integration (Simple)...\n');

async function testJobAdditionByUserId() {
  console.log('📋 Testing Job Addition by User ID');
  
  try {
    // Test with different user plans
    const jobData = {
      tempFilePath: '/tmp/test.pdf',
      originalName: 'test.pdf',
      userId: 'test-user-id',
      fileSize: 1024,
      uploadedAt: new Date().toISOString()
    };

    // Test with mock user ID (will fallback to free plan)
    const job = await priorityQueueManager.addJobByUserId(jobData, 'non-existent-user', 1024);
    
    console.log(`  ✓ Job added with fallback: ${job.id} to queue ${job.data.queueName}`);
    console.log(`  ✓ Priority: ${job.data.priority}, Plan: ${job.data.userPlan}`);
    
    if (job.data.userPlan !== 'free') {
      throw new Error('Expected fallback to free plan');
    }
    
    console.log('  ✅ Job Addition by User ID PASSED\n');
    return true;

  } catch (error) {
    console.error('  ❌ FAILED:', error.message);
    return false;
  }
}

async function testQueueConfiguration() {
  console.log('📋 Testing Queue Configuration');
  
  try {
    const config = await priorityQueueManager.getQueueConfiguration();
    
    console.log('  📊 Queue Configuration:', JSON.stringify(config, null, 2));
    
    // Verify configuration structure
    if (!config.recommendedWorkers || !config.queuePriorities) {
      throw new Error('Invalid queue configuration structure');
    }
    
    if (!config.recommendedWorkers.premium || !config.recommendedWorkers.normal || !config.recommendedWorkers.large) {
      throw new Error('Missing worker recommendations');
    }
    
    console.log('  ✅ Queue Configuration PASSED\n');
    return true;

  } catch (error) {
    console.error('  ❌ FAILED:', error.message);
    return false;
  }
}

async function testQueueStats() {
  console.log('📋 Testing Queue Statistics');
  
  try {
    const stats = await priorityQueueManager.getQueueStats();
    
    console.log('  📊 Queue Statistics:', JSON.stringify(stats, null, 2));
    
    // Verify stats structure
    if (!stats.premium || !stats.normal || !stats.large) {
      throw new Error('Missing queue statistics');
    }
    
    for (const [queueName, queueStats] of Object.entries(stats)) {
      if (typeof queueStats.waiting !== 'number' || typeof queueStats.active !== 'number') {
        throw new Error(`Invalid statistics for queue ${queueName}`);
      }
    }
    
    console.log('  ✅ Queue Statistics PASSED\n');
    return true;

  } catch (error) {
    console.error('  ❌ FAILED:', error.message);
    return false;
  }
}

async function testJobRetrieval() {
  console.log('📋 Testing Job Retrieval');
  
  try {
    // Add a test job
    const jobData = {
      tempFilePath: '/tmp/test-retrieval.pdf',
      originalName: 'test-retrieval.pdf',
      userId: 'test-user',
      fileSize: 1024,
      uploadedAt: new Date().toISOString()
    };

    const job = await priorityQueueManager.addJob(jobData, 'pro', 1024);
    console.log(`  ✓ Added test job: ${job.id}`);
    
    // Retrieve the job
    const retrievedJob = await priorityQueueManager.getJob(job.id);
    
    if (!retrievedJob) {
      throw new Error('Job not found');
    }
    
    if (retrievedJob.id !== job.id) {
      throw new Error('Retrieved job ID mismatch');
    }
    
    console.log(`  ✓ Retrieved job: ${retrievedJob.id}`);
    console.log('  ✅ Job Retrieval PASSED\n');
    return true;

  } catch (error) {
    console.error('  ❌ FAILED:', error.message);
    return false;
  }
}

async function runSimpleIntegrationTests() {
  console.log('🚀 Starting Simple Priority Queue Integration Tests\n');
  
  const tests = [
    testJobAdditionByUserId,
    testQueueConfiguration,
    testQueueStats,
    testJobRetrieval
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
      console.error(`❌ Test failed: ${error.message}`);
      failed++;
    }
  }
  
  console.log('📊 Test Results:');
  console.log(`  ✅ Passed: ${passed}`);
  console.log(`  ❌ Failed: ${failed}`);
  console.log(`  📈 Success Rate: ${((passed / (passed + failed)) * 100).toFixed(1)}%`);
  
  if (failed === 0) {
    console.log('\n🎉 All Simple Integration Tests PASSED!');
    console.log('✅ Priority Queue System Integration is working correctly');
  } else {
    console.log('\n⚠️  Some integration tests failed. Please review the implementation.');
  }
  
  // Clean up and close connections
  await priorityQueueManager.close();
  
  process.exit(failed === 0 ? 0 : 1);
}

// Run the tests
runSimpleIntegrationTests().catch(console.error);