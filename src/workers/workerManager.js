import { Worker } from 'bullmq';
import Redis from 'ioredis';
import config from '../config/config.js';
import priorityQueueManager from '../services/priorityQueueManager.js';
import { processJob } from '../services/jobProcessor.js';
import logService from '../services/logService.js';

class WorkerManager {
  constructor() {
    this.connection = new Redis(config.redis.url, {
      maxRetriesPerRequest: null
    });
    
    this.workers = {};
    this.isShuttingDown = false;
  }

  /**
   * Initialize all workers for priority queues
   */
  async initialize() {
    try {
      logService.log('[WORKER_MANAGER] Initializing workers...');
      
      const queues = priorityQueueManager.getQueues();
      
      // Create workers for each priority queue
      for (const [queueName, queue] of Object.entries(queues)) {
        await this.createWorkerForQueue(queueName);
      }
      
      // Create legacy worker for backward compatibility
      await this.createLegacyWorker();
      
      logService.log('[WORKER_MANAGER] All workers initialized successfully');
      
      // Setup graceful shutdown
      this.setupGracefulShutdown();
      
    } catch (error) {
      logService.error('[WORKER_MANAGER] Failed to initialize workers:', error);
      throw error;
    }
  }

  /**
   * Create worker for a specific queue
   */
  async createWorkerForQueue(queueName) {
    try {
      // Determine concurrency based on queue type
      const concurrency = this.getConcurrencyForQueue(queueName);
      
      const worker = new Worker(
        `pdf-processing-${queueName}`,
        async (job) => {
          logService.log(`[WORKER_MANAGER] [${queueName}] Processing job ${job.id}`);
          return await processJob(job);
        },
        {
          connection: this.connection,
          concurrency,
          removeOnComplete: 10,
          removeOnFail: 5
        }
      );

      // Setup event handlers
      this.setupWorkerEventHandlers(worker, queueName);
      
      this.workers[queueName] = worker;
      
      logService.log(`[WORKER_MANAGER] Worker created for queue: ${queueName} (concurrency: ${concurrency})`);
      
    } catch (error) {
      logService.error(`[WORKER_MANAGER] Failed to create worker for queue ${queueName}:`, error);
      throw error;
    }
  }

  /**
   * Create legacy worker for backward compatibility
   */
  async createLegacyWorker() {
    try {
      const worker = new Worker(
        'pdf-processing',
        async (job) => {
          logService.log(`[WORKER_MANAGER] [legacy] Processing job ${job.id}`);
          return await processJob(job);
        },
        {
          connection: this.connection,
          concurrency: 2,
          removeOnComplete: 10,
          removeOnFail: 5
        }
      );

      this.setupWorkerEventHandlers(worker, 'legacy');
      
      this.workers['legacy'] = worker;
      
      logService.log('[WORKER_MANAGER] Legacy worker created');
      
    } catch (error) {
      logService.error('[WORKER_MANAGER] Failed to create legacy worker:', error);
      throw error;
    }
  }

  /**
   * Get concurrency level for queue type
   */
  getConcurrencyForQueue(queueName) {
    const concurrencyMap = {
      'premium': 3,  // Higher concurrency for premium users
      'normal': 2,   // Standard concurrency
      'large': 1     // Lower concurrency for large files
    };
    
    return concurrencyMap[queueName] || 2;
  }

  /**
   * Setup event handlers for a worker
   */
  setupWorkerEventHandlers(worker, queueName) {
    worker.on('completed', (job, result) => {
      logService.log(`[WORKER_MANAGER] [${queueName}] Job ${job.id} completed successfully`);
    });

    worker.on('failed', (job, err) => {
      logService.error(`[WORKER_MANAGER] [${queueName}] Job ${job?.id} failed:`, err);
    });

    worker.on('error', (err) => {
      logService.error(`[WORKER_MANAGER] [${queueName}] Worker error:`, err);
    });

    worker.on('ready', () => {
      logService.log(`[WORKER_MANAGER] [${queueName}] Worker ready`);
    });

    worker.on('closing', () => {
      logService.log(`[WORKER_MANAGER] [${queueName}] Worker closing`);
    });
  }

  /**
   * Setup graceful shutdown handlers
   */
  setupGracefulShutdown() {
    const shutdown = async (signal) => {
      if (this.isShuttingDown) {
        return;
      }
      
      this.isShuttingDown = true;
      logService.log(`[WORKER_MANAGER] Received ${signal}, shutting down gracefully...`);
      
      try {
        // Close all workers
        const closePromises = Object.entries(this.workers).map(async ([queueName, worker]) => {
          logService.log(`[WORKER_MANAGER] Closing worker: ${queueName}`);
          await worker.close();
        });
        
        await Promise.all(closePromises);
        
        // Close Redis connection
        await this.connection.quit();
        
        logService.log('[WORKER_MANAGER] Graceful shutdown completed');
        process.exit(0);
        
      } catch (error) {
        logService.error('[WORKER_MANAGER] Error during shutdown:', error);
        process.exit(1);
      }
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  }

  /**
   * Get worker statistics
   */
  async getWorkerStats() {
    const stats = {};
    
    for (const [queueName, worker] of Object.entries(this.workers)) {
      stats[queueName] = {
        isRunning: worker.isRunning(),
        concurrency: worker.opts.concurrency
      };
    }
    
    return stats;
  }

  /**
   * Close all workers
   */
  async close() {
    if (this.isShuttingDown) {
      return;
    }
    
    this.isShuttingDown = true;
    
    const closePromises = Object.values(this.workers).map(worker => worker.close());
    await Promise.all(closePromises);
    
    await this.connection.quit();
    
    logService.log('[WORKER_MANAGER] All workers closed');
  }
}

// Create singleton instance
const workerManager = new WorkerManager();

export default workerManager;