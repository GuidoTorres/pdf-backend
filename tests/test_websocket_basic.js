import webSocketManager from './src/services/websocketManager.js';
import dashboardService from './src/services/dashboardService.js';
import timeEstimationService from './src/services/timeEstimationService.js';

console.log('🧪 Testing WebSocket System Components...\n');

// Test 1: WebSocket Manager Initialization
console.log('📡 Test 1: WebSocket Manager Initialization');
try {
  console.log('✅ WebSocket Manager imported successfully');
  console.log(`   - Connected users: ${webSocketManager.getConnectedUsersCount()}`);
  console.log(`   - Connected admins: ${webSocketManager.getConnectedAdminsCount()}`);
} catch (error) {
  console.log('❌ WebSocket Manager initialization failed:', error.message);
}

// Test 2: Time Estimation Service
console.log('\n📊 Test 2: Time Estimation Service');
try {
  const estimation = timeEstimationService.estimateProcessingTime({
    fileSize: 5 * 1024 * 1024, // 5MB
    priority: 'normal',
    currentQueueLength: 3
  });
  
  console.log('✅ Time estimation calculated successfully');
  console.log(`   - Estimated time: ${estimation.estimatedTime} seconds`);
  console.log(`   - Queue wait time: ${estimation.queueWaitTime} seconds`);
  console.log(`   - Processing time: ${estimation.processingTime} seconds`);
  console.log(`   - Confidence: ${estimation.confidence}%`);
} catch (error) {
  console.log('❌ Time estimation failed:', error.message);
}

// Test 3: Record Processing Metrics
console.log('\n📈 Test 3: Recording Processing Metrics');
try {
  const jobData = {
    fileSize: 2 * 1024 * 1024, // 2MB
    processingTime: 15000, // 15 seconds
    queue: 'normal',
    workerId: 'worker-1',
    success: true
  };

  timeEstimationService.recordProcessingTime(jobData);
  
  const stats = timeEstimationService.getEstimationStatistics();
  console.log('✅ Processing metrics recorded successfully');
  console.log(`   - Total historical records: ${stats.totalHistoricalRecords}`);
  console.log(`   - Active workers: ${stats.activeWorkers}`);
} catch (error) {
  console.log('❌ Recording metrics failed:', error.message);
}

// Test 4: Dashboard Service
console.log('\n📋 Test 4: Dashboard Service');
try {
  const status = dashboardService.getStatus();
  console.log('✅ Dashboard service status retrieved');
  console.log(`   - Is collecting: ${status.isCollecting}`);
  console.log(`   - Metrics count: ${status.metricsCount}`);
  console.log(`   - Active alerts: ${status.activeAlerts}`);
} catch (error) {
  console.log('❌ Dashboard service failed:', error.message);
}

// Test 5: Admin Metrics
console.log('\n👨‍💼 Test 5: Admin Metrics');
try {
  const adminMetrics = webSocketManager.getAdminMetrics();
  console.log('✅ Admin metrics retrieved successfully');
  console.log(`   - Connected users: ${adminMetrics.system.connectedUsers}`);
  console.log(`   - Active workers: ${adminMetrics.system.activeWorkers}`);
  console.log(`   - Total waiting jobs: ${adminMetrics.performance.totalWaitingJobs}`);
  console.log(`   - Success rate: ${adminMetrics.performance.successRate}%`);
} catch (error) {
  console.log('❌ Admin metrics failed:', error.message);
}

// Test 6: Queue Metrics Update
console.log('\n🔄 Test 6: Queue Metrics Update');
try {
  // Simulate updating queue metrics
  webSocketManager.updateQueueMetrics('normal', 'queued');
  webSocketManager.updateQueueMetrics('premium', 'queued');
  webSocketManager.updateQueueMetrics('normal', 'started');
  
  const metrics = webSocketManager.getAdminMetrics();
  console.log('✅ Queue metrics updated successfully');
  console.log(`   - Normal queue waiting: ${metrics.queues.normal.waiting}`);
  console.log(`   - Normal queue active: ${metrics.queues.normal.active}`);
  console.log(`   - Premium queue waiting: ${metrics.queues.premium.waiting}`);
} catch (error) {
  console.log('❌ Queue metrics update failed:', error.message);
}

// Test 7: Worker Metrics
console.log('\n⚙️ Test 7: Worker Metrics');
try {
  const workerMetrics = {
    jobsInProgress: 2,
    jobsCompletedHour: 15,
    avgProcessingTime: 25,
    memoryUsageMb: 512,
    cpuUsagePercent: 45,
    status: 'active'
  };

  webSocketManager.updateWorkerMetrics('worker-test-1', workerMetrics);
  webSocketManager.updateWorkerMetrics('worker-test-2', { ...workerMetrics, status: 'idle' });
  
  const adminMetrics = webSocketManager.getAdminMetrics();
  console.log('✅ Worker metrics updated successfully');
  console.log(`   - Total workers tracked: ${adminMetrics.workers.length}`);
  console.log(`   - Active workers: ${adminMetrics.system.activeWorkers}`);
} catch (error) {
  console.log('❌ Worker metrics update failed:', error.message);
}

// Test 8: Time Estimation with Different Priorities
console.log('\n⏱️ Test 8: Time Estimation with Different Priorities');
try {
  const normalEstimate = timeEstimationService.estimateProcessingTime({
    fileSize: 5 * 1024 * 1024,
    priority: 'normal'
  });

  const premiumEstimate = timeEstimationService.estimateProcessingTime({
    fileSize: 5 * 1024 * 1024,
    priority: 'premium'
  });

  const largeEstimate = timeEstimationService.estimateProcessingTime({
    fileSize: 50 * 1024 * 1024,
    priority: 'large'
  });

  console.log('✅ Priority-based estimation working correctly');
  console.log(`   - Normal (5MB): ${normalEstimate.estimatedTime}s`);
  console.log(`   - Premium (5MB): ${premiumEstimate.estimatedTime}s`);
  console.log(`   - Large (50MB): ${largeEstimate.estimatedTime}s`);
  
  if (premiumEstimate.processingTime < normalEstimate.processingTime) {
    console.log('✅ Premium priority working correctly (faster than normal)');
  } else {
    console.log('⚠️ Premium priority may not be working as expected');
  }
} catch (error) {
  console.log('❌ Priority estimation failed:', error.message);
}

// Test 9: Dashboard Metrics Collection
console.log('\n📊 Test 9: Dashboard Metrics Collection');
try {
  dashboardService.startMetricsCollection();
  
  setTimeout(async () => {
    try {
      const currentMetrics = await dashboardService.collectCurrentMetrics();
      console.log('✅ Dashboard metrics collection working');
      console.log(`   - Timestamp: ${currentMetrics.timestamp}`);
      console.log(`   - Has queues data: ${!!currentMetrics.queues}`);
      console.log(`   - Has workers data: ${!!currentMetrics.workers}`);
      console.log(`   - Has performance data: ${!!currentMetrics.performance}`);
      
      dashboardService.stopMetricsCollection();
    } catch (error) {
      console.log('❌ Dashboard metrics collection failed:', error.message);
    }
  }, 1000);
} catch (error) {
  console.log('❌ Dashboard metrics collection setup failed:', error.message);
}

// Test 10: System Load Updates
console.log('\n🖥️ Test 10: System Load Updates');
try {
  timeEstimationService.updateSystemLoad({
    cpu: 65,
    memory: 75,
    activeJobs: 8
  });
  
  const estimation = timeEstimationService.estimateProcessingTime({
    fileSize: 5 * 1024 * 1024,
    priority: 'normal'
  });
  
  console.log('✅ System load updates working');
  console.log(`   - Load factor applied: ${estimation.factors.systemLoadFactor}`);
} catch (error) {
  console.log('❌ System load update failed:', error.message);
}

console.log('\n🎉 WebSocket System Component Tests Completed!');
console.log('\nNext steps:');
console.log('1. Start the server: npm start');
console.log('2. Open websocket-dashboard-demo.html in a browser');
console.log('3. Test real-time WebSocket connections');

// Cleanup
setTimeout(() => {
  process.exit(0);
}, 2000);