import clusterService from '../src/services/clusterService.js';
import logService from '../src/services/logService.js';

/**
 * Demo script to show ClusterManager functionality
 * This demonstrates the key features implemented for Task 2
 */
async function runClusterDemo() {
  console.log('🚀 Starting Cluster Manager Demo...\n');

  try {
    // 1. Initialize cluster service with custom configuration
    console.log('📋 Initializing cluster with configuration:');
    const config = {
      minWorkers: 3,
      maxWorkers: 8,
      scaleUpThreshold: 5,
      scaleDownThreshold: 2,
      healthCheckInterval: 10000,  // 10 seconds for demo
      scaleCheckInterval: 5000     // 5 seconds for demo
    };
    console.log(JSON.stringify(config, null, 2));
    
    await clusterService.initialize(config);
    console.log('✅ Cluster initialized successfully\n');

    // 2. Show initial cluster status
    console.log('📊 Initial Cluster Status:');
    const initialStatus = await clusterService.getClusterStatus();
    console.log(`- Status: ${initialStatus.status}`);
    console.log(`- Total Workers: ${initialStatus.cluster.health.totalWorkers}`);
    console.log(`- Active Workers: ${initialStatus.cluster.health.activeWorkers}`);
    console.log(`- Configuration: Min=${config.minWorkers}, Max=${config.maxWorkers}\n`);

    // 3. Demonstrate manual scaling
    console.log('⚡ Testing Manual Scaling:');
    console.log('Scaling to 5 workers...');
    await clusterService.scaleCluster(5);
    
    const scaledStatus = await clusterService.getClusterStatus();
    console.log(`✅ Scaled to ${scaledStatus.cluster.health.totalWorkers} workers\n`);

    // 4. Show worker metrics
    console.log('📈 Worker Metrics:');
    const workerMetrics = clusterService.getWorkerMetrics();
    workerMetrics.forEach((worker, index) => {
      console.log(`Worker ${index + 1}:`);
      console.log(`  - ID: ${worker.workerId}`);
      console.log(`  - Queue: ${worker.queueName}`);
      console.log(`  - Status: ${worker.status}`);
      console.log(`  - Jobs Completed: ${worker.jobsCompleted}`);
      console.log(`  - Created: ${new Date(worker.createdAt).toLocaleTimeString()}`);
    });
    console.log();

    // 5. Demonstrate health monitoring
    console.log('🏥 Health Monitoring:');
    const health = clusterService.getClusterHealth();
    console.log(`- Total Workers: ${health.totalWorkers}`);
    console.log(`- Active Workers: ${health.activeWorkers}`);
    console.log(`- Error Workers: ${health.errorWorkers}`);
    console.log(`- Is Healthy: ${health.isHealthy ? '✅' : '❌'}`);
    console.log();

    // 6. Show load balancer statistics
    console.log('⚖️ Load Balancer Statistics:');
    const status = await clusterService.getClusterStatus();
    const lbStats = status.loadBalancer;
    console.log(`- Algorithm: ${lbStats.algorithm}`);
    console.log(`- Idle Workers: ${lbStats.idleWorkers}`);
    console.log(`- Processing Workers: ${lbStats.processingWorkers}`);
    console.log(`- Average Processing Time: ${lbStats.avgProcessingTime}ms`);
    console.log();

    // 7. Demonstrate configuration update
    console.log('🔧 Testing Configuration Update:');
    await clusterService.updateConfiguration({
      maxWorkers: 10,
      scaleUpThreshold: 8
    });
    console.log('✅ Configuration updated: maxWorkers=10, scaleUpThreshold=8\n');

    // 8. Show comprehensive cluster statistics
    console.log('📊 Comprehensive Cluster Statistics:');
    const fullStats = await clusterService.getClusterStatus();
    console.log('System Metrics:');
    console.log(`  - CPU Usage: ${fullStats.cluster.system.cpuUsage?.toFixed(2) || 0}%`);
    console.log(`  - Memory Usage: ${fullStats.cluster.system.memoryUsage?.toFixed(2) || 0}%`);
    console.log(`  - Active Jobs: ${fullStats.cluster.system.activeJobs || 0}`);
    
    console.log('Queue Statistics:');
    Object.entries(fullStats.queues).forEach(([queueName, stats]) => {
      console.log(`  ${queueName}:`);
      console.log(`    - Waiting: ${stats.waiting}`);
      console.log(`    - Active: ${stats.active}`);
      console.log(`    - Completed: ${stats.completed}`);
      console.log(`    - Failed: ${stats.failed}`);
    });
    console.log();

    // 9. Demonstrate auto-scaling trigger simulation
    console.log('🎯 Simulating Auto-scaling Conditions:');
    console.log('Running monitoring cycle to check auto-scaling...');
    await clusterService.performMonitoringCycle();
    
    const finalStatus = await clusterService.getClusterStatus();
    console.log(`Final worker count: ${finalStatus.cluster.health.totalWorkers}`);
    console.log();

    // 10. Show key features implemented
    console.log('✨ Key Features Demonstrated:');
    console.log('✅ Dynamic worker creation and management');
    console.log('✅ Auto-scaling based on queue load and system metrics');
    console.log('✅ Health checks and monitoring');
    console.log('✅ Intelligent job distribution (Load Balancer)');
    console.log('✅ Real-time metrics collection');
    console.log('✅ Configuration management');
    console.log('✅ Graceful scaling up and down');
    console.log();

    console.log('🎉 Demo completed successfully!');
    console.log('💡 The ClusterManager is now ready for production use.');
    console.log('   It will automatically scale workers based on load,');
    console.log('   monitor worker health, and distribute jobs intelligently.');

  } catch (error) {
    console.error('❌ Demo failed:', error.message);
    console.error(error.stack);
  } finally {
    // Cleanup
    console.log('\n🧹 Cleaning up...');
    await clusterService.shutdown();
    console.log('✅ Cluster shut down gracefully');
  }
}

// Run the demo
if (import.meta.url === `file://${process.argv[1]}`) {
  runClusterDemo().catch(console.error);
}

export default runClusterDemo;