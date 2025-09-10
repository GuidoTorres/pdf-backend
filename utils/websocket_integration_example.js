import webSocketIntegration from './src/services/websocketIntegration.js';

console.log('🔗 WebSocket Integration Example\n');

// Example: Simulating document processing workflow with WebSocket notifications

async function simulateDocumentProcessing() {
  const userId = 'user-123';
  const documentId = 'doc-456';
  
  console.log('📄 Starting document processing simulation...\n');

  // Step 1: Document is queued
  console.log('1️⃣ Document queued for processing');
  const jobInfo = webSocketIntegration.notifyDocumentQueued(userId, {
    documentId,
    fileName: 'bank_statement.pdf',
    fileSize: 3 * 1024 * 1024, // 3MB
    userPlan: 'premium'
  });
  
  console.log(`   ✅ Job queued with ID: ${jobInfo.jobId}`);
  console.log(`   📊 Estimated time: ${jobInfo.estimatedTime} seconds`);
  console.log(`   🎯 Priority: ${jobInfo.priority}`);
  console.log(`   📍 Queue position: ${jobInfo.queuePosition}`);

  // Wait a bit to simulate queue time
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Step 2: Processing starts
  console.log('\n2️⃣ Processing started');
  webSocketIntegration.notifyDocumentStarted(documentId, 'worker-1');
  
  // Update worker metrics
  webSocketIntegration.updateWorkerMetrics('worker-1', {
    jobsInProgress: 1,
    jobsCompletedHour: 12,
    avgProcessingTime: 25,
    memoryUsageMb: 256,
    cpuUsagePercent: 60,
    status: 'active'
  });

  // Step 3: Progress updates
  console.log('\n3️⃣ Processing progress updates');
  const progressSteps = [
    { progress: 20, stage: 'extracting_text' },
    { progress: 40, stage: 'analyzing_structure' },
    { progress: 60, stage: 'detecting_transactions' },
    { progress: 80, stage: 'validating_data' },
    { progress: 95, stage: 'generating_results' }
  ];

  for (const step of progressSteps) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    webSocketIntegration.notifyDocumentProgress(documentId, step.progress, step.stage);
    console.log(`   📈 ${step.progress}% - ${step.stage}`);
  }

  // Step 4: Processing completes
  await new Promise(resolve => setTimeout(resolve, 1000));
  console.log('\n4️⃣ Processing completed');
  
  const result = {
    transactions: [
      { date: '2024-01-15', amount: -150.00, description: 'Grocery Store' },
      { date: '2024-01-16', amount: 2500.00, description: 'Salary Deposit' },
      { date: '2024-01-17', amount: -75.50, description: 'Gas Station' }
    ],
    totalTransactions: 3,
    balance: 2274.50,
    processingTime: 8500
  };

  webSocketIntegration.notifyDocumentCompleted(documentId, result, true);
  console.log(`   ✅ Processing completed successfully`);
  console.log(`   📊 Found ${result.totalTransactions} transactions`);
  console.log(`   💰 Final balance: $${result.balance}`);

  // Update worker metrics after completion
  webSocketIntegration.updateWorkerMetrics('worker-1', {
    jobsInProgress: 0,
    jobsCompletedHour: 13,
    avgProcessingTime: 24,
    memoryUsageMb: 128,
    cpuUsagePercent: 20,
    status: 'idle'
  });

  // Step 5: Show statistics
  console.log('\n5️⃣ Integration statistics');
  const stats = webSocketIntegration.getStatistics();
  console.log(`   📈 Active jobs: ${stats.activeJobs}`);
  console.log(`   📊 Jobs by status:`, stats.jobsByStatus);
  console.log(`   🎯 Jobs by priority:`, stats.jobsByPriority);
  console.log(`   ⏱️ Average processing time: ${stats.averageProcessingTime}ms`);
}

// Example: Simulating a failed processing
async function simulateFailedProcessing() {
  const userId = 'user-789';
  const documentId = 'doc-failed-123';
  
  console.log('\n❌ Simulating failed document processing...\n');

  // Queue the document
  webSocketIntegration.notifyDocumentQueued(userId, {
    documentId,
    fileName: 'corrupted_file.pdf',
    fileSize: 1 * 1024 * 1024, // 1MB
    userPlan: 'normal'
  });

  await new Promise(resolve => setTimeout(resolve, 1000));

  // Start processing
  webSocketIntegration.notifyDocumentStarted(documentId, 'worker-2');

  await new Promise(resolve => setTimeout(resolve, 2000));

  // Progress a bit then fail
  webSocketIntegration.notifyDocumentProgress(documentId, 30, 'extracting_text');
  
  await new Promise(resolve => setTimeout(resolve, 1000));

  // Simulate failure
  webSocketIntegration.notifyDocumentFailed(
    documentId, 
    'File appears to be corrupted or password protected', 
    1, 
    true
  );

  console.log('   ❌ Processing failed with retry option');
}

// Example: Multiple concurrent jobs
async function simulateMultipleJobs() {
  console.log('\n🔄 Simulating multiple concurrent jobs...\n');

  const jobs = [
    { userId: 'user-a', documentId: 'doc-a', fileName: 'statement_a.pdf', plan: 'premium' },
    { userId: 'user-b', documentId: 'doc-b', fileName: 'statement_b.pdf', plan: 'normal' },
    { userId: 'user-c', documentId: 'doc-c', fileName: 'statement_c.pdf', plan: 'unlimited' }
  ];

  // Queue all jobs
  jobs.forEach((job, index) => {
    setTimeout(() => {
      webSocketIntegration.notifyDocumentQueued(job.userId, {
        documentId: job.documentId,
        fileName: job.fileName,
        fileSize: (2 + index) * 1024 * 1024, // 2MB, 3MB, 4MB
        userPlan: job.plan
      });
      console.log(`   📄 Queued: ${job.fileName} (${job.plan})`);
    }, index * 500);
  });

  // Show final statistics after all jobs are queued
  setTimeout(() => {
    const stats = webSocketIntegration.getStatistics();
    console.log('\n📊 Final statistics:');
    console.log(`   Active jobs: ${stats.activeJobs}`);
    console.log(`   Jobs by priority:`, stats.jobsByPriority);
  }, 2000);
}

// Run the examples
async function runExamples() {
  try {
    await simulateDocumentProcessing();
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    await simulateFailedProcessing();
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    await simulateMultipleJobs();
    
    console.log('\n🎉 WebSocket Integration Examples Completed!');
    console.log('\n💡 Integration Tips:');
    console.log('1. Call notifyDocumentQueued() when adding documents to processing queue');
    console.log('2. Call notifyDocumentStarted() when worker begins processing');
    console.log('3. Call notifyDocumentProgress() periodically during processing');
    console.log('4. Call notifyDocumentCompleted() or notifyDocumentFailed() when done');
    console.log('5. Update worker metrics regularly for accurate load balancing');
    
  } catch (error) {
    console.error('❌ Example failed:', error);
  }
}

runExamples();

// Cleanup after examples
setTimeout(() => {
  process.exit(0);
}, 8000);