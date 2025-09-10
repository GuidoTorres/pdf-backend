import { Queue } from 'bullmq';
import Redis from 'ioredis';
import config from '../config/config.js';
import logService from './logService.js';

class PriorityQueueManager {
  constructor() {
    // Create Redis connection
    this.connection = new Redis(config.redis.url, {
      maxRetriesPerRequest: null
    });

    // Initialize separate queues for different priorities
    this.queues = {
      premium: new Queue('pdf-processing-premium', { 
        connection: this.connection,
        defaultJobOptions: {
          removeOnComplete: 10,
          removeOnFail: 5,
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 2000,
          }
        }
      }),
      normal: new Queue('pdf-processing-normal', { 
        connection: this.connection,
        defaultJobOptions: {
          removeOnComplete: 10,
          removeOnFail: 5,
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 2000,
          }
        }
      }),
      large: new Queue('pdf-processing-large', { 
        connection: this.connection,
        defaultJobOptions: {
          removeOnComplete: 5,
          removeOnFail: 3,
          attempts: 2,
          backoff: {
            type: 'exponential',
            delay: 5000,
          }
        }
      })
    };

    // Priority mapping based on subscription plans
    // Lower numbers = higher priority (Requirements 2.1, 2.2, 2.3)
    this.priorityMap = {
      'enterprise': 2,    // High priority 
      'pro': 3,          // High priority (premium equivalent)  
      'basic': 4,        // Medium priority
      'free': 5          // Normal priority
    };

    // Large file threshold (50MB)
    this.largeFileThreshold = 50 * 1024 * 1024;

    logService.log('[PRIORITY_QUEUE_MANAGER] Initialized with queues:', Object.keys(this.queues));
  }

  /**
   * Determine which queue to use based on user plan and file size
   * @param {string} userPlan - User subscription plan
   * @param {number} fileSize - File size in bytes
   * @returns {string} Queue name to use
   */
  determineQueue(userPlan, fileSize) {
    // Large files go to dedicated queue regardless of plan
    if (fileSize > this.largeFileThreshold) {
      logService.log('[PRIORITY_QUEUE_MANAGER] Large file detected, using large queue', { 
        fileSize, 
        threshold: this.largeFileThreshold 
      });
      return 'large';
    }

    // Premium plans (enterprise, pro, unlimited, ilimitado) get premium queue
    // Requirements 2.1, 2.3: Premium and unlimited users get high priority queue
    if (['enterprise', 'pro', 'unlimited', 'ilimitado'].includes(userPlan)) {
      logService.log('[PRIORITY_QUEUE_MANAGER] Premium user detected, using premium queue', { userPlan });
      return 'premium';
    }

    // Basic and free users use normal queue (Requirements 2.4)
    logService.log('[PRIORITY_QUEUE_MANAGER] Standard user detected, using normal queue', { userPlan });
    return 'normal';
  }

  /**
   * Calculate job priority within a queue based on subscription plan
   * @param {string} userPlan - User subscription plan
   * @returns {number} Priority value (lower number = higher priority)
   */
  calculatePriority(userPlan) {
    // Handle unlimited/ilimitado plans with maximum priority (Requirement 2.3)
    if (['unlimited', 'ilimitado'].includes(userPlan)) {
      return 1; // Maximum priority (higher than all other plans)
    }
    
    return this.priorityMap[userPlan] || this.priorityMap['free'];
  }

  /**
   * Add a job to the appropriate priority queue with automatic plan detection
   * @param {Object} jobData - Job data including file info and user details
   * @param {string} userId - User ID to determine plan
   * @param {number} fileSize - File size in bytes
   * @returns {Promise<Object>} BullMQ job object
   */
  async addJobByUserId(jobData, userId, fileSize) {
    try {
      // Import userService here to avoid circular dependencies
      const { default: userService } = await import('./userService.js');
      const userPlan = await userService.getUserPlan(userId);
      
      return await this.addJob(jobData, userPlan, fileSize);
    } catch (error) {
      logService.error('[PRIORITY_QUEUE_MANAGER] Error getting user plan, using free plan as fallback:', error);
      // Fallback to free plan if user plan cannot be determined
      return await this.addJob(jobData, 'free', fileSize);
    }
  }

  /**
   * Add a job to the appropriate priority queue
   * @param {Object} jobData - Job data including file info and user details
   * @param {string} userPlan - User subscription plan
   * @param {number} fileSize - File size in bytes
   * @returns {Promise<Object>} BullMQ job object
   */
  async addJob(jobData, userPlan, fileSize) {
    try {
      const queueName = this.determineQueue(userPlan, fileSize);
      const priority = this.calculatePriority(userPlan);
      const queue = this.queues[queueName];

      if (!queue) {
        throw new Error(`Queue ${queueName} not found`);
      }

      // Enhanced job data with priority information
      const enhancedJobData = {
        ...jobData,
        userPlan,
        fileSize,
        queueName,
        priority,
        createdAt: new Date().toISOString()
      };

      // Add job with priority
      const job = await queue.add('process-pdf', enhancedJobData, {
        priority,
        delay: 0, // Process immediately
        jobId: `${queueName}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
      });

      logService.log('[PRIORITY_QUEUE_MANAGER] Job added successfully', {
        jobId: job.id,
        queueName,
        priority,
        userPlan,
        fileSize,
        fileName: jobData.originalName
      });

      return job;

    } catch (error) {
      logService.error('[PRIORITY_QUEUE_MANAGER] Error adding job to queue:', error);
      throw error;
    }
  }

  /**
   * Get job from any queue by ID
   * @param {string} jobId - Job ID to search for
   * @returns {Promise<Object|null>} Job object or null if not found
   */
  async getJob(jobId) {
    try {
      // Search in all queues
      for (const [queueName, queue] of Object.entries(this.queues)) {
        const job = await queue.getJob(jobId);
        if (job) {
          logService.log('[PRIORITY_QUEUE_MANAGER] Job found in queue', { jobId, queueName });
          return job;
        }
      }

      logService.log('[PRIORITY_QUEUE_MANAGER] Job not found in any queue', { jobId });
      return null;

    } catch (error) {
      logService.error('[PRIORITY_QUEUE_MANAGER] Error getting job:', error);
      throw error;
    }
  }

  /**
   * Get queue statistics for monitoring
   * @returns {Promise<Object>} Statistics for all queues
   */
  async getQueueStats() {
    try {
      const stats = {};

      for (const [queueName, queue] of Object.entries(this.queues)) {
        const waiting = await queue.getWaiting();
        const active = await queue.getActive();
        const completed = await queue.getCompleted();
        const failed = await queue.getFailed();

        stats[queueName] = {
          waiting: waiting.length,
          active: active.length,
          completed: completed.length,
          failed: failed.length,
          total: waiting.length + active.length
        };
      }

      return stats;

    } catch (error) {
      logService.error('[PRIORITY_QUEUE_MANAGER] Error getting queue stats:', error);
      throw error;
    }
  }

  /**
   * Get all queues for worker creation
   * @returns {Object} All queue instances
   */
  getQueues() {
    return this.queues;
  }

  /**
   * Get queue configuration for worker allocation
   * Requirement 2.5: Maintain dedicated workers for premium users under high load
   * @returns {Object} Queue configuration with worker allocation recommendations
   */
  async getQueueConfiguration() {
    const stats = await this.getQueueStats();
    
    // Calculate recommended worker allocation based on queue load
    const totalWaiting = Object.values(stats).reduce((sum, stat) => sum + stat.waiting, 0);
    const isHighLoad = totalWaiting > 10; // High load threshold
    
    const config = {
      isHighLoad,
      totalWaiting,
      recommendedWorkers: {
        premium: isHighLoad ? Math.max(2, Math.ceil(stats.premium?.waiting / 3)) : 1, // Min 2 workers under high load
        normal: Math.max(1, Math.ceil(stats.normal?.waiting / 5)),
        large: Math.max(1, Math.ceil(stats.large?.waiting / 2))
      },
      queuePriorities: {
        premium: 1, // Highest priority (Requirements 2.1, 2.2)
        normal: 2,  // Normal priority
        large: 3    // Lower priority for large files
      }
    };
    
    logService.log('[PRIORITY_QUEUE_MANAGER] Queue configuration calculated', config);
    return config;
  }

  /**
   * Clean up completed and failed jobs
   * @param {number} maxAge - Maximum age in milliseconds
   */
  async cleanup(maxAge = 24 * 60 * 60 * 1000) { // 24 hours default
    try {
      for (const [queueName, queue] of Object.entries(this.queues)) {
        await queue.clean(maxAge, 10, 'completed');
        await queue.clean(maxAge, 5, 'failed');
        logService.log('[PRIORITY_QUEUE_MANAGER] Cleaned up old jobs', { queueName });
      }
    } catch (error) {
      logService.error('[PRIORITY_QUEUE_MANAGER] Error during cleanup:', error);
    }
  }

  /**
   * Close all queue connections
   */
  async close() {
    try {
      for (const [queueName, queue] of Object.entries(this.queues)) {
        await queue.close();
        logService.log('[PRIORITY_QUEUE_MANAGER] Closed queue', { queueName });
      }
      await this.connection.quit();
      logService.log('[PRIORITY_QUEUE_MANAGER] Closed Redis connection');
    } catch (error) {
      logService.error('[PRIORITY_QUEUE_MANAGER] Error closing connections:', error);
    }
  }
}

// Create singleton instance
const priorityQueueManager = new PriorityQueueManager();

export default priorityQueueManager;