import { EnhancedPdfWorkerSystem } from '../src/workers/pdfProcessor.js';
import priorityQueueManager from '../src/services/priorityQueueManager.js';
import webSocketManager from '../src/services/websocketManager.js';
import logService from '../src/services/logService.js';

/**
 * Enhanced PDF Worker System Demonstration
 * Shows the integration of scalable workers with cluster management,
 * priority queues, and real-time WebSocket communication
 */
class EnhancedWorkerDemo {
  constructor() {
    this.workerSystem = null;
    this.demoJobs = [];
    this.isRunning = false;
  }

  /**
   * Start the demonstration
   */
  async start() {
    try {
      logService.log('[DEMO] Starting Enhanced PDF Worker System Demo...');
      
      // Initialize the enhanced worker system
      this.workerSystem = new EnhancedPdfWorkerSystem();
      await this.workerSystem.start();
      
      this.isRunning = true;
      
      // Display initial system status
      await this.displaySystemStatus();
      
      // Simulate job processing
      await this.simulateJobProcessing();
      
      // Monitor system for a while
      await this.monitorSystem(30000); // Monitor for 30 seconds
      
      // Display final metrics
      await this.displayFinalMetrics();
      
    } catch (error) {
      logService.error('[DEMO] Demo failed:', error);
    } finally {
      await this.cleanup();
    }
  }

  /**
   * Display current system status
   */
  async displaySystemStatus() {
    try {
      const status = this.workerSystem.getSystemStatus();
      const queueStats = await priorityQueueManager.getQueueStats();
      
      console.log('\n=== ENHANCED WORKER SYSTEM STATUS ===');
      console.log(`System Running: ${status.isRunning}`);
      console.log(`Total Workers: ${status.totalWorkers}`);
      console.log(`Cluster Health: ${status.clusterHealth?.isHealthy ? 'Healthy' : 'Unhealthy'}`);
      
      console.log('\n=== WORKER STATUS ===');
      status.workers.forEach(worker => {
        console.log(`Worker ${worker.workerId}:`);
        console.log(`  Queue: ${worker.queueName}`);
        console.log(`  Status: ${worker.status}`);
        console.log(`  Current Job: ${worker.currentJob || 'None'}`);
      });
      
      console.log('\n=== QUEUE STATISTICS ===');
      Object.entries(queueStats).forEach(([queueName, stats]) => {
        console.log(`${queueName.toUpperCase()} Queue:`);
        console.log(`  Waiting: ${stats.waiting}`);
        console.log(`  Active: ${stats.active}`);
        console.log(`  Completed: ${stats.completed}`);
        console.log(`  Failed: ${stats.failed}`);
      });
      
    } catch (error) {
      logService.error('[DEMO] Failed to display system status:', error);
    }
  }

  /**
   * Simulate job processing with different priorities
   */
  async simulateJobProcessing() {
    try {
      logService.log('[DEMO] Simulating job processing...');
      
      // Create demo jobs with different priorities
      const demoJobs = [
        {
          userId: 'user-premium-1',
          userPlan: 'unlimited',
          fileName: 'premium-document-1.pdf',
          fileSize: 2 * 1024 * 1024, // 2MB
          tempFilePath: '/tmp/demo-premium-1.pdf'
        },
        {
          userId: 'user-normal-1',
          userPlan: 'free',
          fileName: 'normal-document-1.pdf',
          fileSize: 1.5 * 1024 * 1024, // 1.5MB
          tempFilePath: '/tmp/demo-normal-1.pdf'
        },
        {
          userId: 'user-premium-2',
          userPlan: 'pro',
          fileName: 'premium-document-2.pdf',
          fileSize: 3 * 1024 * 1024, // 3MB
          tempFilePath: '/tmp/demo-premium-2.pdf'
        },
        {
          userId: 'user-large-1',
          userPlan: 'basic',
          fileName: 'large-document-1.pdf',
          fileSize: 60 * 1024 * 1024, // 60MB (large file)
          tempFilePath: '/tmp/demo-large-1.pdf'
        },
        {
          userId: 'user-normal-2',
          userPlan: 'free',
          fileName: 'normal-document-2.pdf',
          fileSize: 1 * 1024 * 1024, // 1MB
          tempFilePath: '/tmp/demo-normal-2.pdf'
        }
      ];
      
      // Add jobs to appropriate queues
      for (const jobData of demoJobs) {
        try {
          const job = await priorityQueueManager.addJob(
            {
              ...jobData,
              originalName: jobData.fileName
            },
            jobData.userPlan,
            jobData.fileSize
          );
          
          this.demoJobs.push(job);
          
          logService.log('[DEMO] Added job to queue', {
            jobId: job.id,
            fileName: jobData.fileName,
            userPlan: jobData.userPlan,
            fileSize: jobData.fileSize,
            queue: job.queueName
          });
          
          // Simulate WebSocket notification for job queued
          if (webSocketManager) {
            webSocketManager.notifyJobQueued(jobData.userId, {
              jobId: job.id,
              fileName: jobData.fileName,
              queuePosition: 1, // Simplified
              priority: jobData.userPlan
            });
          }
          
        } catch (error) {
          logService.error('[DEMO] Failed to add job:', error);
        }
      }
      
      console.log(`\n=== ADDED ${this.demoJobs.length} DEMO JOBS ===`);
      console.log('Jobs will be processed by priority:');
      console.log('1. Premium/Unlimited users first');
      console.log('2. Normal users second');
      console.log('3. Large files in dedicated queue');
      
    } catch (error) {
      logService.error('[DEMO] Failed to simulate job processing:', error);
    }
  }

  /**
   * Monitor system performance
   */
  async monitorSystem(duration) {
    try {
      logService.log(`[DEMO] Monitoring system for ${duration / 1000} seconds...`);
      
      const startTime = Date.now();
      const monitorInterval = 5000; // Check every 5 seconds
      
      while (Date.now() - startTime < duration && this.isRunning) {
        await new Promise(resolve => setTimeout(resolve, monitorInterval));
        
        // Display current status
        console.log('\n--- MONITORING UPDATE ---');
        const metrics = await this.workerSystem.getDetailedMetrics();
        
        console.log(`Active Workers: ${metrics.system.totalWorkers}`);
        console.log(`System Health: ${metrics.system.clusterHealth?.isHealthy ? 'Healthy' : 'Unhealthy'}`);
        
        // Show queue status
        Object.entries(metrics.queues).forEach(([queueName, stats]) => {
          if (stats.waiting > 0 || stats.active > 0) {
            console.log(`${queueName}: ${stats.waiting} waiting, ${stats.active} active`);
          }
        });
        
        // Show worker activity
        const activeWorkers = metrics.workers.filter(w => w.status === 'processing');
        if (activeWorkers.length > 0) {
          console.log(`Processing: ${activeWorkers.length} workers active`);
          activeWorkers.forEach(worker => {
            console.log(`  ${worker.workerId}: Job ${worker.currentJob}`);
          });
        }
      }
      
    } catch (error) {
      logService.error('[DEMO] Monitoring failed:', error);
    }
  }

  /**
   * Display final metrics and performance summary
   */
  async displayFinalMetrics() {
    try {
      console.log('\n=== FINAL DEMO METRICS ===');
      
      const metrics = await this.workerSystem.getDetailedMetrics();
      const queueStats = metrics.queues;
      
      // Calculate totals
      const totalProcessed = Object.values(queueStats).reduce((sum, stats) => sum + stats.completed, 0);
      const totalFailed = Object.values(queueStats).reduce((sum, stats) => sum + stats.failed, 0);
      const totalJobs = totalProcessed + totalFailed;
      
      console.log(`Total Jobs Processed: ${totalProcessed}`);
      console.log(`Total Jobs Failed: ${totalFailed}`);
      console.log(`Success Rate: ${totalJobs > 0 ? ((totalProcessed / totalJobs) * 100).toFixed(2) : 0}%`);
      
      // Worker performance
      console.log('\n=== WORKER PERFORMANCE ===');
      metrics.workers.forEach(worker => {
        console.log(`Worker ${worker.workerId}:`);
        console.log(`  Jobs Processed: ${worker.jobsProcessed}`);
        console.log(`  Jobs Failed: ${worker.jobsFailed}`);
        console.log(`  Avg Processing Time: ${worker.avgProcessingTime?.toFixed(2) || 0}ms`);
        console.log(`  Status: ${worker.status}`);
      });
      
      // System resources
      if (metrics.system.clusterHealth) {
        console.log('\n=== SYSTEM RESOURCES ===');
        console.log(`Total Workers: ${metrics.system.clusterHealth.totalWorkers}`);
        console.log(`Active Workers: ${metrics.system.clusterHealth.activeWorkers}`);
        console.log(`Error Workers: ${metrics.system.clusterHealth.errorWorkers}`);
      }
      
      console.log('\n=== DEMO COMPLETED SUCCESSFULLY ===');
      
    } catch (error) {
      logService.error('[DEMO] Failed to display final metrics:', error);
    }
  }

  /**
   * Clean up resources
   */
  async cleanup() {
    try {
      logService.log('[DEMO] Cleaning up demo resources...');
      
      this.isRunning = false;
      
      if (this.workerSystem) {
        await this.workerSystem.gracefulShutdown();
      }
      
      // Clean up any remaining jobs
      for (const job of this.demoJobs) {
        try {
          await job.remove();
        } catch (error) {
          // Job might already be processed or removed
        }
      }
      
      logService.log('[DEMO] Demo cleanup completed');
      
    } catch (error) {
      logService.error('[DEMO] Cleanup failed:', error);
    }
  }
}

// Run the demo if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const demo = new EnhancedWorkerDemo();
  
  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n[DEMO] Received SIGINT, shutting down demo...');
    await demo.cleanup();
    process.exit(0);
  });
  
  process.on('SIGTERM', async () => {
    console.log('\n[DEMO] Received SIGTERM, shutting down demo...');
    await demo.cleanup();
    process.exit(0);
  });
  
  // Start the demo
  demo.start().catch(error => {
    console.error('[DEMO] Demo failed:', error);
    process.exit(1);
  });
}

export default EnhancedWorkerDemo;