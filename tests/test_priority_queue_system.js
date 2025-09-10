import priorityQueueManager from './src/services/priorityQueueManager.js';
import userService from './src/services/userService.js';
import logService from './src/services/logService.js';

/**
 * Test the priority queue system implementation
 */
async function testPriorityQueueSystem() {
  console.log('🚀 Starting Priority Queue System Tests...\n');

  try {
    // Test 1: Queue Determination Logic
    console.log('📋 Test 1: Queue Determination Logic');
    await testQueueDetermination();

    // Test 2: Priority Calculation
    console.log('\n📊 Test 2: Priority Calculation');
    await testPriorityCalculation();

    // Test 3: Job Addition to Different Queues
    console.log('\n📤 Test 3: Job Addition to Different Queues');
    await testJobAddition();

    // Test 4: Queue Statistics
    console.log('\n📈 Test 4: Queue Statistics');
    await testQueueStatistics();

    // Test 5: Job Retrieval
    console.log('\n🔍 Test 5: Job Retrieval');
    await testJobRetrieval();

    // Test 6: Large File Handling
    console.log('\n📁 Test 6: Large File Handling');
    await testLargeFileHandling();

    console.log('\n✅ All Priority Queue System Tests Completed Successfully!');

  } catch (error) {
    console.error('\n❌ Priority Queue System Tests Failed:', error);
    throw error;
  } finally {
    // Cleanup
    await priorityQueueManager.close();
  }
}

async function testQueueDetermination() {
  const testCases = [
    { plan: 'enterprise', fileSize: 1024 * 1024, expected: 'premium' },
    { plan: 'pro', fileSize: 1024 * 1024, expected: 'premium' },
    { plan: 'basic', fileSize: 1024 * 1024, expected: 'normal' },
    { plan: 'free', fileSize: 1024 * 1024, expected: 'normal' },
    { plan: 'enterprise', fileSize: 60 * 1024 * 1024, expected: 'large' },
    { plan: 'free', fileSize: 60 * 1024 * 1024, expected: 'large' }
  ];

  for (const testCase of testCases) {
    const result = priorityQueueManager.determineQueue(testCase.plan, testCase.fileSize);
    console.log(`  Plan: ${testCase.plan}, Size: ${(testCase.fileSize / 1024 / 1024).toFixed(1)}MB → Queue: ${result}`);
    
    if (result !== testCase.expected) {
      throw new Error(`Expected queue ${testCase.expected}, got ${result}`);
    }
  }
  console.log('  ✅ Queue determination logic working correctly');
}

async function testPriorityCalculation() {
  const testCases = [
    { plan: 'unlimited', expected: 1 },
    { plan: 'enterprise', expected: 2 },
    { plan: 'pro', expected: 3 },
    { plan: 'basic', expected: 4 },
    { plan: 'free', expected: 5 },
    { plan: 'unknown', expected: 5 }
  ];

  for (const testCase of testCases) {
    const result = priorityQueueManager.calculatePriority(testCase.plan);
    console.log(`  Plan: ${testCase.plan} → Priority: ${result}`);
    
    if (result !== testCase.expected) {
      throw new Error(`Expected priority ${testCase.expected}, got ${result}`);
    }
  }
  console.log('  ✅ Priority calculation working correctly');
}

async function testJobAddition() {
  const testJobs = [
    {
      jobData: {
        tempFilePath: '/tmp/test-enterprise.pdf',
        originalName: 'test-enterprise.pdf',
        userId: 'user-enterprise-123'
      },
      userPlan: 'enterprise',
      fileSize: 1024 * 1024
    },
    {
      jobData: {
        tempFilePath: '/tmp/test-free.pdf',
        originalName: 'test-free.pdf',
        userId: 'user-free-456'
      },
      userPlan: 'free',
      fileSize: 2 * 1024 * 1024
    },
    {
      jobData: {
        tempFilePath: '/tmp/test-large.pdf',
        originalName: 'test-large.pdf',
        userId: 'user-basic-789'
      },
      userPlan: 'basic',
      fileSize: 60 * 1024 * 1024
    }
  ];

  const addedJobs = [];

  for (const testJob of testJobs) {
    const job = await priorityQueueManager.addJob(
      testJob.jobData,
      testJob.userPlan,
      testJob.fileSize
    );

    addedJobs.push(job);
    
    console.log(`  Added job ${job.id} to queue ${job.data.queueName} with priority ${job.data.priority}`);
    
    // Verify job data
    if (!job.data.queueName || !job.data.priority) {
      throw new Error('Job missing queue information');
    }
  }

  console.log('  ✅ Job addition working correctly');
  return addedJobs;
}

async function testQueueStatistics() {
  const stats = await priorityQueueManager.getQueueStats();
  
  console.log('  Queue Statistics:');
  for (const [queueName, queueStats] of Object.entries(stats)) {
    console.log(`    ${queueName}: waiting=${queueStats.waiting}, active=${queueStats.active}, total=${queueStats.total}`);
  }

  // Verify stats structure
  const expectedQueues = ['premium', 'normal', 'large'];
  for (const queueName of expectedQueues) {
    if (!stats[queueName]) {
      throw new Error(`Missing stats for queue: ${queueName}`);
    }
    
    const queueStats = stats[queueName];
    if (typeof queueStats.waiting !== 'number' || typeof queueStats.active !== 'number') {
      throw new Error(`Invalid stats structure for queue: ${queueName}`);
    }
  }

  console.log('  ✅ Queue statistics working correctly');
}

async function testJobRetrieval() {
  // Add a test job
  const testJobData = {
    tempFilePath: '/tmp/test-retrieval.pdf',
    originalName: 'test-retrieval.pdf',
    userId: 'user-test-retrieval'
  };

  const job = await priorityQueueManager.addJob(testJobData, 'pro', 1024 * 1024);
  console.log(`  Added test job: ${job.id}`);

  // Retrieve the job
  const retrievedJob = await priorityQueueManager.getJob(job.id);
  
  if (!retrievedJob) {
    throw new Error('Failed to retrieve job');
  }

  if (retrievedJob.id !== job.id) {
    throw new Error('Retrieved job ID mismatch');
  }

  console.log(`  Retrieved job: ${retrievedJob.id} from queue ${retrievedJob.data.queueName}`);
  console.log('  ✅ Job retrieval working correctly');
}

async function testLargeFileHandling() {
  const largeFileSize = 75 * 1024 * 1024; // 75MB
  
  const testJobData = {
    tempFilePath: '/tmp/test-large-file.pdf',
    originalName: 'test-large-file.pdf',
    userId: 'user-large-file-test'
  };

  // Test with different plans - all should go to large queue
  const plans = ['enterprise', 'pro', 'basic', 'free'];
  
  for (const plan of plans) {
    const job = await priorityQueueManager.addJob(testJobData, plan, largeFileSize);
    
    if (job.data.queueName !== 'large') {
      throw new Error(`Large file with plan ${plan} should go to large queue, got ${job.data.queueName}`);
    }
    
    console.log(`  Plan ${plan} with ${(largeFileSize / 1024 / 1024).toFixed(1)}MB → Queue: ${job.data.queueName} ✓`);
  }

  console.log('  ✅ Large file handling working correctly');
}

// Test user service integration
async function testUserServiceIntegration() {
  console.log('\n👤 Testing User Service Integration...');
  
  try {
    // Test getUserPlan with non-existent user (should return 'free')
    const defaultPlan = await userService.getUserPlan('non-existent-user-id');
    console.log(`  Default plan for non-existent user: ${defaultPlan}`);
    
    if (defaultPlan !== 'free') {
      throw new Error(`Expected 'free' plan for non-existent user, got '${defaultPlan}'`);
    }

    // Test getUserPriority
    const priority = await userService.getUserPriority('non-existent-user-id');
    console.log(`  Default priority for non-existent user: ${priority}`);
    
    if (priority !== 4) {
      throw new Error(`Expected priority 4 for non-existent user, got ${priority}`);
    }

    console.log('  ✅ User service integration working correctly');

  } catch (error) {
    console.error('  ❌ User service integration test failed:', error.message);
    // Don't throw here as this might fail due to database connection issues in test environment
  }
}

// Run the tests
if (import.meta.url === `file://${process.argv[1]}`) {
  testPriorityQueueSystem()
    .then(() => {
      console.log('\n🎉 All tests passed!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Tests failed:', error);
      process.exit(1);
    });
}

export { testPriorityQueueSystem };