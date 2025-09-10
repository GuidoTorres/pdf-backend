import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import ScalableWorker from './scalableWorker.js';
import ClusterManager from '../services/clusterManager.js';
import priorityQueueManager from '../services/priorityQueueManager.js';
import logService from '../services/logService.js';

logService.log('[PDF-WORKER] Starting scalable PDF processing system...');

/**
 * Enhanced PDF Worker with Cluster Integration
 * Requirements: 1.1, 1.4, 1.5, 3.5
 */
class EnhancedPdfWorkerSystem {
  constructor() {
    this.clusterManager = null;
    this.workers = new Map();
    this.isRunning = false;
    this.shutdownPromise = null;
  }

  /**
   * Start the enhanced worker system
   * Requirements: 1.1, 1.4
   */
  async start() {
    try {
      logService.log('[PDF-WORKER] Starting enhanced PDF worker system...');
      
      // Initialize cluster manager
      this.clusterManager = new ClusterManager({
        minWorkers: 3,
        maxWorkers: 10,
        scaleUpThreshold: 8,
        scaleDownThreshold: 2
      });
      
      // Start cluster manager
      await this.clusterManager.start();
      
      // Create initial scalable workers for each queue
      await this.createInitialWorkers();
      
      // Set up graceful shutdown
      this.setupShutdownHandlers();
      
      this.isRunning = true;
      
      logService.log('[PDF-WORKER] Enhanced PDF worker system started successfully', {
        totalWorkers: this.workers.size,
        clusterManagerActive: true
      });
      
    } catch (error) {
      logService.error('[PDF-WORKER] Failed to start enhanced worker system:', error);
      throw error;
    }
  }

  /**
   * Create initial workers for all priority queues
   * Requirements: 1.1, 2.1, 2.2
   */
  async createInitialWorkers() {
    try {
      const queues = priorityQueueManager.getQueues();
      const workerPromises = [];
      
      // Create workers for each queue type
      for (const [queueType, queue] of Object.entries(queues)) {
        const queueName = queue.name;
        
        // Determine number of workers per queue based on priority
        let workerCount = 1;
        if (queueType === 'premium') {
          workerCount = 2; // More workers for premium queue (Requirement 2.5)
        } else if (queueType === 'large') {
          workerCount = 1; // Dedicated worker for large files
        }
        
        // Create workers for this queue
        for (let i = 0; i < workerCount; i++) {
          const workerId = `${queueType}-worker-${i + 1}`;
          workerPromises.push(this.createScalableWorker(queueName, workerId));
        }
      }
      
      // Wait for all workers to be created
      await Promise.all(workerPromises);
      
      logService.log('[PDF-WORKER] Initial workers created successfully', {
        totalWorkers: this.workers.size,
        queues: Object.keys(queues)
      });
      
    } catch (error) {
      logService.error('[PDF-WORKER] Failed to create initial workers:', error);
      throw error;
    }
  }

  /**
   * Create a scalable worker for a specific queue
   * Requirements: 1.1, 1.4, 1.5
   */
  async createScalableWorker(queueName, workerId) {
    try {
      logService.log('[PDF-WORKER] Creating scalable worker', { workerId, queueName });
      
      const worker = new ScalableWorker({
        workerId,
        queueName,
        clusterManager: this.clusterManager,
        concurrency: queueName === 'pdf-processing-premium' ? 2 : 1,
        metricsReportingInterval: 15000 // Report metrics every 15 seconds
      });
      
      // Start the worker
      await worker.start();
      
      // Store worker reference
      this.workers.set(workerId, worker);
      
      logService.log('[PDF-WORKER] Scalable worker created and started', { workerId, queueName });
      
      return worker;
      
    } catch (error) {
      logService.error('[PDF-WORKER] Failed to create scalable worker:', error);
      throw error;
    }
  }

  /**
   * Set up graceful shutdown handlers
   * Requirements: 3.5, 5.5
   */
  setupShutdownHandlers() {
    // Handle SIGTERM
    process.on('SIGTERM', () => {
      logService.log('[PDF-WORKER] Received SIGTERM, initiating graceful shutdown');
      this.gracefulShutdown();
    });

    // Handle SIGINT (Ctrl+C)
    process.on('SIGINT', () => {
      logService.log('[PDF-WORKER] Received SIGINT, initiating graceful shutdown');
      this.gracefulShutdown();
    });

    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      logService.error('[PDF-WORKER] Uncaught exception:', error);
      this.gracefulShutdown();
    });

    // Handle unhandled promise rejections
    process.on('unhandledRejection', (reason, promise) => {
      logService.error('[PDF-WORKER] Unhandled promise rejection:', reason);
      this.gracefulShutdown();
    });
  }

  /**
   * Perform graceful shutdown of the entire system
   * Requirements: 3.5, 5.5
   */
  async gracefulShutdown() {
    if (this.shutdownPromise) {
      return this.shutdownPromise;
    }
    
    this.shutdownPromise = this.performShutdown();
    return this.shutdownPromise;
  }

  /**
   * Perform the actual shutdown process
   * Requirements: 3.5, 5.5
   */
  async performShutdown() {
    try {
      logService.log('[PDF-WORKER] Starting graceful shutdown of worker system...');
      
      this.isRunning = false;
      
      // Shutdown all scalable workers
      const workerShutdownPromises = Array.from(this.workers.values()).map(worker => 
        worker.gracefulShutdown()
      );
      
      logService.log('[PDF-WORKER] Shutting down workers...', { count: this.workers.size });
      await Promise.all(workerShutdownPromises);
      
      // Clear workers map
      this.workers.clear();
      
      // Shutdown cluster manager
      if (this.clusterManager) {
        logService.log('[PDF-WORKER] Shutting down cluster manager...');
        await this.clusterManager.stop();
        this.clusterManager = null;
      }
      
      logService.log('[PDF-WORKER] Graceful shutdown completed successfully');
      
      // Exit process
      process.exit(0);
      
    } catch (error) {
      logService.error('[PDF-WORKER] Error during graceful shutdown:', error);
      process.exit(1);
    }
  }

  /**
   * Get system status
   * Requirements: 7.1, 7.2
   */
  getSystemStatus() {
    const workerStatuses = Array.from(this.workers.values()).map(worker => worker.getStatus());
    const clusterHealth = this.clusterManager ? this.clusterManager.getClusterHealth() : null;
    
    return {
      isRunning: this.isRunning,
      totalWorkers: this.workers.size,
      workers: workerStatuses,
      clusterHealth,
      timestamp: Date.now()
    };
  }

  /**
   * Get detailed metrics
   * Requirements: 7.1, 7.2
   */
  async getDetailedMetrics() {
    const workerMetrics = Array.from(this.workers.values()).map(worker => worker.getMetrics());
    const clusterStats = this.clusterManager ? await this.clusterManager.getClusterStats() : null;
    
    return {
      system: this.getSystemStatus(),
      workers: workerMetrics,
      cluster: clusterStats,
      queues: await priorityQueueManager.getQueueStats()
    };
  }
}

// Create and start the enhanced worker system
const workerSystem = new EnhancedPdfWorkerSystem();

// Start the system
workerSystem.start().catch(error => {
  logService.error('[PDF-WORKER] Failed to start worker system:', error);
  process.exit(1);
});

// Export for testing and monitoring
export { workerSystem, EnhancedPdfWorkerSystem };