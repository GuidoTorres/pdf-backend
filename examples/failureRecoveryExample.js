/**
 * Failure Recovery System Usage Example
 * 
 * This example demonstrates how to integrate and use the failure recovery system
 * with the existing PDF processing infrastructure.
 */

import FailureRecoveryIntegration from '../src/services/failureRecoveryIntegration.js';

// Mock services for demonstration
const mockServices = {
    clusterManager: {
        on: (event, callback) => console.log(`ClusterManager listening for: ${event}`),
        emit: (event, data) => console.log(`ClusterManager emitted: ${event}`, data),
        getActiveWorkers: async () => [
            { id: 'worker-1', status: 'active', currentJob: null },
            { id: 'worker-2', status: 'active', currentJob: null }
        ],
        createWorker: async () => ({ id: `worker-${Date.now()}`, status: 'active' }),
        stopWorker: async (workerId) => console.log(`Stopping worker: ${workerId}`),
        reportWorkerStatus: (workerId, status, metrics) => {
            console.log(`Worker ${workerId} status: ${status}`, metrics);
        }
    },

    priorityQueueManager: {
        on: (event, callback) => console.log(`QueueManager listening for: ${event}`),
        addJob: async (jobData, userPlan, fileSize, options = {}) => {
            console.log(`Job added to queue:`, { jobData, userPlan, fileSize, options });
            return { id: `queue-job-${Date.now()}` };
        },
        getQueueStats: async () => ({
            waiting: 5,
            active: 3,
            completed: 100,
            failed: 2,
            avgProcessingTime: 30000
        })
    },

    websocketManager: {
        notifyUser: (userId, event, data) => {
            console.log(`WebSocket notification to user ${userId}:`, { event, data });
        },
        broadcast: (event, data) => {
            console.log(`WebSocket broadcast:`, { event, data });
        }
    },

    databaseService: {
        query: async (sql, params) => {
            console.log(`Database query:`, { sql: sql.substring(0, 50) + '...', params });
            return [{ affectedRows: 1 }];
        }
    }
};

async function demonstrateFailureRecovery() {
    console.log('🚀 Starting Failure Recovery System Demo\n');

    // 1. Initialize the failure recovery integration
    console.log('1️⃣ Initializing Failure Recovery Integration...');
    const recoveryIntegration = new FailureRecoveryIntegration();
    
    try {
        await recoveryIntegration.initialize(mockServices);
        console.log('✅ Failure Recovery Integration initialized successfully\n');
    } catch (error) {
        console.error('❌ Failed to initialize:', error.message);
        return;
    }

    // 2. Simulate job registration
    console.log('2️⃣ Simulating job registration...');
    const jobId = 'demo-job-123';
    const workerId = 'worker-1';
    const jobData = {
        userId: 'user-456',
        fileName: 'demo-document.pdf',
        fileSize: 2048000,
        userPlan: 'premium'
    };

    await recoveryIntegration.recoveryCoordinator.registerJob(jobId, workerId, jobData);
    console.log('✅ Job registered for monitoring\n');

    // 3. Simulate job progress updates
    console.log('3️⃣ Simulating job progress updates...');
    await recoveryIntegration.recoveryCoordinator.updateJobProgress(jobId, 25);
    await new Promise(resolve => setTimeout(resolve, 100));
    await recoveryIntegration.recoveryCoordinator.updateJobProgress(jobId, 50);
    await new Promise(resolve => setTimeout(resolve, 100));
    await recoveryIntegration.recoveryCoordinator.updateJobProgress(jobId, 75);
    console.log('✅ Job progress updated\n');

    // 4. Simulate worker heartbeats
    console.log('4️⃣ Simulating worker heartbeats...');
    recoveryIntegration.recoveryCoordinator.recordWorkerHeartbeat('worker-1', {
        jobsInProgress: 1,
        memoryUsageMb: 512,
        cpuUsagePercent: 45,
        status: 'active'
    });
    recoveryIntegration.recoveryCoordinator.recordWorkerHeartbeat('worker-2', {
        jobsInProgress: 0,
        memoryUsageMb: 256,
        cpuUsagePercent: 15,
        status: 'idle'
    });
    console.log('✅ Worker heartbeats recorded\n');

    // 5. Simulate worker failure and recovery
    console.log('5️⃣ Simulating worker failure...');
    await recoveryIntegration.recoveryCoordinator.failureRecoveryManager.handleWorkerFailure(
        'worker-1', 
        'Simulated worker crash for demo'
    );
    console.log('✅ Worker failure handled, recovery initiated\n');

    // 6. Wait for retry mechanism
    console.log('6️⃣ Waiting for retry mechanism...');
    await new Promise(resolve => setTimeout(resolve, 1500));
    console.log('✅ Retry mechanism executed\n');

    // 7. Simulate job completion on new worker
    console.log('7️⃣ Simulating job completion on recovered worker...');
    const result = { success: true, extractedData: 'Demo extracted data' };
    await recoveryIntegration.recoveryCoordinator.markJobCompleted(jobId, result);
    console.log('✅ Job completed successfully\n');

    // 8. Get recovery statistics
    console.log('8️⃣ Getting recovery statistics...');
    const stats = await recoveryIntegration.getSystemRecoveryStats();
    console.log('📊 Recovery Statistics:');
    console.log(JSON.stringify(stats, null, 2));
    console.log('');

    // 9. Perform health check
    console.log('9️⃣ Performing system health check...');
    const healthCheck = await recoveryIntegration.performHealthCheck();
    console.log('🏥 Health Check Results:');
    console.log(JSON.stringify(healthCheck, null, 2));
    console.log('');

    // 10. Demonstrate Circuit Breaker
    console.log('🔟 Demonstrating Circuit Breaker...');
    const circuitBreaker = recoveryIntegration.recoveryCoordinator.failureRecoveryManager.circuitBreaker;
    
    // Simulate some operations
    try {
        await circuitBreaker.execute(async () => {
            console.log('   ✅ Operation 1 succeeded');
            return 'success';
        });

        // Simulate failures
        for (let i = 0; i < 3; i++) {
            try {
                await circuitBreaker.execute(async () => {
                    throw new Error(`Simulated failure ${i + 1}`);
                });
            } catch (error) {
                console.log(`   ❌ Operation ${i + 2} failed: ${error.message}`);
            }
        }

        // Circuit should be open now
        const circuitState = circuitBreaker.getState();
        console.log(`   🔴 Circuit Breaker State: ${circuitState.state}`);
        console.log(`   📊 Failure Count: ${circuitState.failureCount}`);

    } catch (error) {
        console.log(`   ⚠️  Circuit breaker error: ${error.message}`);
    }

    // 11. Cleanup
    console.log('\n🧹 Cleaning up...');
    await recoveryIntegration.shutdown();
    console.log('✅ Cleanup completed');

    console.log('\n🎉 Failure Recovery System Demo completed successfully!');
    console.log('\n📝 Summary of demonstrated features:');
    console.log('   • Job registration and monitoring');
    console.log('   • Worker health tracking');
    console.log('   • Automatic failure detection');
    console.log('   • Job retry with exponential backoff');
    console.log('   • Circuit breaker pattern');
    console.log('   • Real-time notifications');
    console.log('   • System health monitoring');
    console.log('   • Recovery statistics');
}

// Run the demonstration
demonstrateFailureRecovery().catch(error => {
    console.error('❌ Demo failed:', error);
    process.exit(1);
});