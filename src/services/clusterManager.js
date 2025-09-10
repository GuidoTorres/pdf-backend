import { Worker } from 'bullmq';
import Redis from 'ioredis';
import { spawn } from 'child_process';
import os from 'os';
import config from '../config/config.js';
import priorityQueueManager from './priorityQueueManager.js';
import logService from './logService.js';
import HealthCheckService from './healthCheckService.js';
import productionLogger from './productionLogger.js';

/**
 * ClusterManager - Manages dynamic worker creation, scaling, and health monitoring
 * Requirements: 1.1, 1.2, 1.3, 5.1, 5.2, 5.3, 5.4, 5.5
 */
class ClusterManager {
  constructor(options = {}) {
    this.minWorkers = options.minWorkers || 5;
    this.maxWorkers = options.maxWorkers || 15;
    this.scaleUpThreshold = options.scaleUpThreshold || 10; // Jobs in queue
    this.scaleDownThreshold = options.scaleDownThreshold || 3; // Jobs in queue
    this.healthCheckInterval = options.healthCheckInterval || 30000; // 30 seconds
    this.scaleCheckInterval = options.scaleCheckInterval || 15000; // 15 seconds
    
    // Worker management
    this.workers = new Map(); // workerId -> worker instance
    this.workerMetrics = new Map(); // workerId -> metrics
    this.workerProcesses = new Map(); // workerId -> child process (for external workers)
    
    // Redis connection for metrics and coordination
    this.redis = new Redis(config.redis.url, {
      maxRetriesPerRequest: null
    });
    
    // Production monitoring services
    this.healthCheckService = new HealthCheckService({
      checkInterval: this.healthCheckInterval,
      maxFailures: 3,
      retryDelay: 5000
    });
    
    // Production mode flag
    this.isProduction = process.env.NODE_ENV === 'production' || process.env.CLUSTER_MODE === 'true';
    
    // System metrics
    this.systemMetrics = {
      cpuUsage: 0,
      memoryUsage: 0,
      activeJobs: 0,
      totalWorkers: 0
    };
    
    // Scaling state
    this.isScaling = false;
    this.lastScaleAction = 0;
    this.scaleDebounceTime = 10000; // 10 seconds between scale actions
    
    // Health check and scaling intervals
    this.healthCheckTimer = null;
    this.scaleCheckTimer = null;
    
    logService.log('[CLUSTER_MANAGER] Initialized', {
      minWorkers: this.minWorkers,
      maxWorkers: this.maxWorkers,
      scaleUpThreshold: this.scaleUpThreshold,
      scaleDownThreshold: this.scaleDownThreshold
    });
  }

  /**
   * Start the cluster manager
   * Requirements: 1.1, 5.1
   */
  async start() {
    try {
      logService.log('[CLUSTER_MANAGER] Starting cluster manager...');
      
      // Start production health monitoring if in production mode
      if (this.isProduction) {
        await this.startProductionMonitoring();
      }
      
      // Initialize with minimum workers
      await this.scaleToTarget(this.minWorkers);
      
      // Start monitoring intervals
      this.startHealthChecks();
      this.startScaleMonitoring();
      
      logService.log('[CLUSTER_MANAGER] Cluster manager started successfully');
      
    } catch (error) {
      logService.error('[CLUSTER_MANAGER] Failed to start cluster manager:', error);
      throw error;
    }
  }

  /**
   * Stop the cluster manager and all workers
   * Requirements: 5.5
   */
  async stop() {
    try {
      logService.log('[CLUSTER_MANAGER] Stopping cluster manager...');
      
      // Stop production monitoring
      if (this.isProduction && this.healthCheckService) {
        this.healthCheckService.stop();
      }
      
      // Stop monitoring intervals
      if (this.healthCheckTimer) {
        clearInterval(this.healthCheckTimer);
        this.healthCheckTimer = null;
      }
      
      if (this.scaleCheckTimer) {
        clearInterval(this.scaleCheckTimer);
        this.scaleCheckTimer = null;
      }
      
      // Gracefully shutdown all workers
      await this.shutdownAllWorkers();
      
      // Close Redis connection
      await this.redis.quit();
      
      logService.log('[CLUSTER_MANAGER] Cluster manager stopped');
      
    } catch (error) {
      logService.error('[CLUSTER_MANAGER] Error stopping cluster manager:', error);
    }
  }

  /**
   * Create a new worker for a specific queue
   * Requirements: 1.1, 1.2
   */
  async createWorker(queueName, workerId = null) {
    try {
      const id = workerId || `worker-${queueName}-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
      
      logService.log('[CLUSTER_MANAGER] Creating worker', { workerId: id, queueName });
      
      // Create BullMQ worker
      const worker = new Worker(queueName, async (job) => {
        // Update worker metrics before processing
        this.updateWorkerMetrics(id, { status: 'processing', currentJob: job.id });
        
        try {
          // Process the job (this will use the existing processJob function)
          const result = await this.processJobWithMetrics(job, id);
          
          // Update metrics after successful processing
          this.updateWorkerMetrics(id, { 
            status: 'idle', 
            currentJob: null,
            jobsCompleted: (this.workerMetrics.get(id)?.jobsCompleted || 0) + 1,
            lastCompletedAt: Date.now()
          });
          
          return result;
          
        } catch (error) {
          // Update metrics after failed processing
          this.updateWorkerMetrics(id, { 
            status: 'error', 
            currentJob: null,
            jobsFailed: (this.workerMetrics.get(id)?.jobsFailed || 0) + 1,
            lastError: error.message,
            lastErrorAt: Date.now()
          });
          
          throw error;
        }
      }, {
        connection: this.redis,
        concurrency: queueName === 'pdf-processing-premium' ? 2 : 1, // Higher concurrency for premium
        maxStalledCount: 3,
        stalledInterval: 30000
      });
      
      // Initialize worker metrics
      this.workerMetrics.set(id, {
        workerId: id,
        queueName,
        status: 'idle',
        createdAt: Date.now(),
        lastHeartbeat: Date.now(),
        jobsCompleted: 0,
        jobsFailed: 0,
        currentJob: null,
        cpuUsage: 0,
        memoryUsage: 0,
        avgProcessingTime: 0
      });
      
      // Set up worker event handlers
      this.setupWorkerEventHandlers(worker, id);
      
      // Store worker
      this.workers.set(id, worker);
      
      logService.log('[CLUSTER_MANAGER] Worker created successfully', { workerId: id, queueName });
      
      return { workerId: id, worker };
      
    } catch (error) {
      logService.error('[CLUSTER_MANAGER] Failed to create worker:', error);
      throw error;
    }
  }

  /**
   * Process job with metrics collection
   * Requirements: 1.4, 7.1
   */
  async processJobWithMetrics(job, workerId) {
    const startTime = Date.now();
    const startMemory = process.memoryUsage();
    
    try {
      // Import and use the existing processor logic
      const { processJob } = await import('./jobProcessor.js');
      
      // Process the job
      const result = await processJob(job);
      
      // Calculate metrics
      const processingTime = Date.now() - startTime;
      const endMemory = process.memoryUsage();
      const memoryUsed = endMemory.heapUsed - startMemory.heapUsed;
      
      // Update worker metrics
      const currentMetrics = this.workerMetrics.get(workerId);
      if (currentMetrics) {
        const totalJobs = currentMetrics.jobsCompleted + 1;
        const newAvgTime = ((currentMetrics.avgProcessingTime * currentMetrics.jobsCompleted) + processingTime) / totalJobs;
        
        this.updateWorkerMetrics(workerId, {
          avgProcessingTime: newAvgTime,
          lastProcessingTime: processingTime,
          memoryUsage: Math.max(0, memoryUsed)
        });
      }
      
      logService.log('[CLUSTER_MANAGER] Job processed successfully', {
        workerId,
        jobId: job.id,
        processingTime,
        memoryUsed
      });
      
      return result;
      
    } catch (error) {
      const processingTime = Date.now() - startTime;
      
      logService.error('[CLUSTER_MANAGER] Job processing failed', {
        workerId,
        jobId: job.id,
        processingTime,
        error: error.message
      });
      
      throw error;
    }
  }

  /**
   * Set up event handlers for a worker
   * Requirements: 1.4, 6.1
   */
  setupWorkerEventHandlers(worker, workerId) {
    worker.on('completed', (job) => {
      logService.log('[CLUSTER_MANAGER] Job completed', { workerId, jobId: job.id });
      this.updateWorkerMetrics(workerId, { lastHeartbeat: Date.now() });
    });

    worker.on('failed', (job, err) => {
      logService.error('[CLUSTER_MANAGER] Job failed', { workerId, jobId: job.id, error: err.message });
      this.updateWorkerMetrics(workerId, { 
        lastHeartbeat: Date.now(),
        lastError: err.message,
        lastErrorAt: Date.now()
      });
    });

    worker.on('active', (job) => {
      logService.log('[CLUSTER_MANAGER] Job started', { workerId, jobId: job.id });
      this.updateWorkerMetrics(workerId, { 
        status: 'processing',
        currentJob: job.id,
        lastHeartbeat: Date.now()
      });
    });

    worker.on('stalled', (jobId) => {
      logService.warn('[CLUSTER_MANAGER] Job stalled', { workerId, jobId });
      this.updateWorkerMetrics(workerId, { 
        status: 'stalled',
        lastHeartbeat: Date.now()
      });
    });

    worker.on('error', (err) => {
      logService.error('[CLUSTER_MANAGER] Worker error', { workerId, error: err.message });
      this.updateWorkerMetrics(workerId, { 
        status: 'error',
        lastError: err.message,
        lastErrorAt: Date.now()
      });
    });
  }

  /**
   * Update worker metrics
   * Requirements: 7.1, 7.2
   */
  updateWorkerMetrics(workerId, updates) {
    const currentMetrics = this.workerMetrics.get(workerId);
    if (currentMetrics) {
      this.workerMetrics.set(workerId, {
        ...currentMetrics,
        ...updates,
        lastUpdated: Date.now()
      });
    }
  }

  /**
   * Remove a worker
   * Requirements: 1.3, 5.2
   */
  async removeWorker(workerId) {
    try {
      logService.log('[CLUSTER_MANAGER] Removing worker', { workerId });
      
      const worker = this.workers.get(workerId);
      if (worker) {
        // Gracefully close the worker
        await worker.close();
        this.workers.delete(workerId);
      }
      
      // Clean up metrics
      this.workerMetrics.delete(workerId);
      
      // Clean up process if it exists
      const process = this.workerProcesses.get(workerId);
      if (process) {
        process.kill('SIGTERM');
        this.workerProcesses.delete(workerId);
      }
      
      logService.log('[CLUSTER_MANAGER] Worker removed successfully', { workerId });
      
    } catch (error) {
      logService.error('[CLUSTER_MANAGER] Failed to remove worker:', error);
    }
  }

  /**
   * Scale cluster to target number of workers
   * Requirements: 5.1, 5.2
   */
  async scaleToTarget(targetWorkers) {
    try {
      if (this.isScaling) {
        logService.log('[CLUSTER_MANAGER] Scaling already in progress, skipping');
        return;
      }
      
      this.isScaling = true;
      const currentWorkers = this.workers.size;
      
      logService.log('[CLUSTER_MANAGER] Scaling cluster', { 
        currentWorkers, 
        targetWorkers 
      });
      
      if (targetWorkers > currentWorkers) {
        // Scale up
        await this.scaleUp(targetWorkers - currentWorkers);
      } else if (targetWorkers < currentWorkers) {
        // Scale down
        await this.scaleDown(currentWorkers - targetWorkers);
      }
      
      this.lastScaleAction = Date.now();
      
    } catch (error) {
      logService.error('[CLUSTER_MANAGER] Failed to scale cluster:', error);
    } finally {
      this.isScaling = false;
    }
  }

  /**
   * Scale up by creating new workers
   * Requirements: 5.1, 5.3
   */
  async scaleUp(count) {
    try {
      logService.log('[CLUSTER_MANAGER] Scaling up', { count });
      
      // Get queue configuration to determine where to add workers
      const queueConfig = await priorityQueueManager.getQueueConfiguration();
      const queues = Object.keys(priorityQueueManager.getQueues());
      
      const promises = [];
      let workersCreated = 0;
      
      // Distribute new workers across queues based on load
      for (let i = 0; i < count && workersCreated < count; i++) {
        // Prioritize premium queue under high load (Requirement 2.5)
        let queueName = 'pdf-processing-normal';
        
        if (queueConfig.isHighLoad && workersCreated < 2) {
          queueName = 'pdf-processing-premium';
        } else {
          // Round-robin distribution across queues
          const queueIndex = workersCreated % queues.length;
          queueName = queues[queueIndex];
        }
        
        promises.push(this.createWorker(queueName));
        workersCreated++;
      }
      
      await Promise.all(promises);
      
      logService.log('[CLUSTER_MANAGER] Scale up completed', { 
        workersCreated,
        totalWorkers: this.workers.size 
      });
      
    } catch (error) {
      logService.error('[CLUSTER_MANAGER] Failed to scale up:', error);
    }
  }

  /**
   * Scale down by removing idle workers
   * Requirements: 5.2
   */
  async scaleDown(count) {
    try {
      logService.log('[CLUSTER_MANAGER] Scaling down', { count });
      
      // Find idle workers to remove (prefer normal queue workers over premium)
      const idleWorkers = [];
      
      for (const [workerId, metrics] of this.workerMetrics.entries()) {
        if (metrics.status === 'idle' && !metrics.currentJob) {
          idleWorkers.push({ workerId, metrics });
        }
      }
      
      // Sort by queue priority (remove normal queue workers first)
      idleWorkers.sort((a, b) => {
        const priorityA = a.metrics.queueName === 'pdf-processing-premium' ? 1 : 0;
        const priorityB = b.metrics.queueName === 'pdf-processing-premium' ? 1 : 0;
        return priorityA - priorityB;
      });
      
      // Remove workers
      const workersToRemove = idleWorkers.slice(0, count);
      const promises = workersToRemove.map(({ workerId }) => this.removeWorker(workerId));
      
      await Promise.all(promises);
      
      logService.log('[CLUSTER_MANAGER] Scale down completed', { 
        workersRemoved: workersToRemove.length,
        totalWorkers: this.workers.size 
      });
      
    } catch (error) {
      logService.error('[CLUSTER_MANAGER] Failed to scale down:', error);
    }
  }

  /**
   * Start health check monitoring
   * Requirements: 1.3, 6.1
   */
  startHealthChecks() {
    this.healthCheckTimer = setInterval(async () => {
      await this.performHealthChecks();
    }, this.healthCheckInterval);
    
    logService.log('[CLUSTER_MANAGER] Health checks started');
  }

  /**
   * Perform health checks on all workers
   * Requirements: 1.3, 6.1, 6.2
   */
  async performHealthChecks() {
    try {
      const now = Date.now();
      const staleThreshold = 60000; // 1 minute
      const failedWorkers = [];
      
      for (const [workerId, metrics] of this.workerMetrics.entries()) {
        // Check if worker is stale (no heartbeat)
        if (now - metrics.lastHeartbeat > staleThreshold) {
          logService.warn('[CLUSTER_MANAGER] Stale worker detected', { 
            workerId, 
            lastHeartbeat: new Date(metrics.lastHeartbeat).toISOString() 
          });
          failedWorkers.push(workerId);
        }
        
        // Check if worker is in error state
        if (metrics.status === 'error' && metrics.lastErrorAt && (now - metrics.lastErrorAt < 300000)) {
          logService.warn('[CLUSTER_MANAGER] Worker in error state', { 
            workerId, 
            lastError: metrics.lastError 
          });
          failedWorkers.push(workerId);
        }
      }
      
      // Replace failed workers
      for (const workerId of failedWorkers) {
        await this.replaceFailedWorker(workerId);
      }
      
      // Update system metrics
      await this.updateSystemMetrics();
      
    } catch (error) {
      logService.error('[CLUSTER_MANAGER] Health check failed:', error);
    }
  }

  /**
   * Replace a failed worker
   * Requirements: 6.1, 6.2
   */
  async replaceFailedWorker(workerId) {
    try {
      const metrics = this.workerMetrics.get(workerId);
      const queueName = metrics?.queueName || 'pdf-processing-normal';
      
      logService.log('[CLUSTER_MANAGER] Replacing failed worker', { workerId, queueName });
      
      // Remove the failed worker
      await this.removeWorker(workerId);
      
      // Create a replacement worker
      await this.createWorker(queueName);
      
      logService.log('[CLUSTER_MANAGER] Failed worker replaced successfully', { workerId });
      
    } catch (error) {
      logService.error('[CLUSTER_MANAGER] Failed to replace worker:', error);
    }
  }

  /**
   * Start automatic scaling monitoring
   * Requirements: 5.1, 5.3, 5.4
   */
  startScaleMonitoring() {
    this.scaleCheckTimer = setInterval(async () => {
      await this.checkAndScale();
    }, this.scaleCheckInterval);
    
    logService.log('[CLUSTER_MANAGER] Scale monitoring started');
  }

  /**
   * Check queue load and scale accordingly
   * Requirements: 5.1, 5.3, 5.4
   */
  async checkAndScale() {
    try {
      // Debounce scaling actions
      if (Date.now() - this.lastScaleAction < this.scaleDebounceTime) {
        return;
      }
      
      const queueStats = await priorityQueueManager.getQueueStats();
      const totalWaiting = Object.values(queueStats).reduce((sum, stat) => sum + stat.waiting, 0);
      const totalActive = Object.values(queueStats).reduce((sum, stat) => sum + stat.active, 0);
      const currentWorkers = this.workers.size;
      
      logService.log('[CLUSTER_MANAGER] Checking scale conditions', {
        totalWaiting,
        totalActive,
        currentWorkers,
        scaleUpThreshold: this.scaleUpThreshold,
        scaleDownThreshold: this.scaleDownThreshold
      });
      
      // Scale up conditions (Requirement 5.1)
      if (totalWaiting > this.scaleUpThreshold && currentWorkers < this.maxWorkers) {
        const targetWorkers = Math.min(
          this.maxWorkers,
          currentWorkers + Math.ceil(totalWaiting / 5)
        );
        
        logService.log('[CLUSTER_MANAGER] Scaling up due to high queue load', {
          totalWaiting,
          currentWorkers,
          targetWorkers
        });
        
        await this.scaleToTarget(targetWorkers);
      }
      
      // Scale down conditions (Requirement 5.2)
      else if (totalWaiting < this.scaleDownThreshold && currentWorkers > this.minWorkers) {
        const targetWorkers = Math.max(
          this.minWorkers,
          currentWorkers - Math.ceil((currentWorkers - totalWaiting) / 3)
        );
        
        logService.log('[CLUSTER_MANAGER] Scaling down due to low queue load', {
          totalWaiting,
          currentWorkers,
          targetWorkers
        });
        
        await this.scaleToTarget(targetWorkers);
      }
      
    } catch (error) {
      logService.error('[CLUSTER_MANAGER] Scale check failed:', error);
    }
  }

  /**
   * Update system metrics
   * Requirements: 7.1, 7.2
   */
  async updateSystemMetrics() {
    try {
      const cpus = os.cpus();
      const totalMem = os.totalmem();
      const freeMem = os.freemem();
      
      this.systemMetrics = {
        cpuUsage: await this.getCpuUsage(),
        memoryUsage: ((totalMem - freeMem) / totalMem) * 100,
        activeJobs: Array.from(this.workerMetrics.values()).filter(m => m.currentJob).length,
        totalWorkers: this.workers.size,
        timestamp: Date.now()
      };
      
      // Store metrics in Redis for monitoring
      await this.redis.setex('cluster:metrics', 300, JSON.stringify(this.systemMetrics));
      
    } catch (error) {
      logService.error('[CLUSTER_MANAGER] Failed to update system metrics:', error);
    }
  }

  /**
   * Get CPU usage percentage
   */
  async getCpuUsage() {
    return new Promise((resolve) => {
      const startMeasure = process.cpuUsage();
      
      setTimeout(() => {
        const endMeasure = process.cpuUsage(startMeasure);
        const totalUsage = endMeasure.user + endMeasure.system;
        const percentage = (totalUsage / 1000000) * 100; // Convert to percentage
        resolve(Math.min(100, percentage));
      }, 100);
    });
  }

  /**
   * Shutdown all workers gracefully
   * Requirements: 5.5
   */
  async shutdownAllWorkers() {
    try {
      logService.log('[CLUSTER_MANAGER] Shutting down all workers...');
      
      const shutdownPromises = Array.from(this.workers.keys()).map(workerId => 
        this.removeWorker(workerId)
      );
      
      await Promise.all(shutdownPromises);
      
      logService.log('[CLUSTER_MANAGER] All workers shut down successfully');
      
    } catch (error) {
      logService.error('[CLUSTER_MANAGER] Error during worker shutdown:', error);
    }
  }

  /**
   * Get cluster health status
   * Requirements: 7.1, 7.2
   */
  getClusterHealth() {
    const workers = Array.from(this.workerMetrics.values());
    const activeWorkers = workers.filter(w => w.status === 'idle' || w.status === 'processing').length;
    const errorWorkers = workers.filter(w => w.status === 'error').length;
    
    return {
      totalWorkers: this.workers.size,
      activeWorkers,
      errorWorkers,
      systemMetrics: this.systemMetrics,
      isHealthy: errorWorkers === 0 && activeWorkers > 0,
      lastHealthCheck: Date.now()
    };
  }

  /**
   * Get detailed worker metrics
   * Requirements: 7.1, 7.2
   */
  getWorkerMetrics() {
    return Array.from(this.workerMetrics.values());
  }

  /**
   * Get cluster statistics
   * Requirements: 7.1, 7.2
   */
  async getClusterStats() {
    const queueStats = await priorityQueueManager.getQueueStats();
    const workerMetrics = this.getWorkerMetrics();
    const health = this.getClusterHealth();
    
    return {
      queues: queueStats,
      workers: workerMetrics,
      health,
      system: this.systemMetrics,
      scaling: {
        minWorkers: this.minWorkers,
        maxWorkers: this.maxWorkers,
        currentWorkers: this.workers.size,
        isScaling: this.isScaling,
        lastScaleAction: this.lastScaleAction
      }
    };
  }

  /**
   * Start production monitoring services
   * Requirements: 6.2, 6.3, 7.1, 7.2
   */
  async startProductionMonitoring() {
    try {
      productionLogger.info('Starting production monitoring for cluster manager');
      
      // Start health check service
      this.healthCheckService.start();
      
      // Set up health check event handlers
      this.healthCheckService.on('workerFailed', async (workerId, details) => {
        await this.handleWorkerFailure(workerId, details);
      });
      
      this.healthCheckService.on('restartWorkerRequested', async (workerId, worker) => {
        await this.restartWorker(workerId);
      });
      
      this.healthCheckService.on('healthCheckCompleted', (summary) => {
        if (summary.overallStatus !== 'healthy') {
          productionLogger.warn('Cluster health check warning', { summary });
        }
      });
      
      // Register existing workers with health check service
      for (const [workerId, worker] of this.workers.entries()) {
        this.healthCheckService.registerWorker(workerId, {
          type: 'cluster-worker',
          queueName: worker.queueName,
          process: worker.process,
          port: worker.port
        });
      }
      
      productionLogger.info('Production monitoring started successfully');
      
    } catch (error) {
      productionLogger.error('Failed to start production monitoring', { error });
      throw error;
    }
  }

  /**
   * Handle worker failure in production
   * Requirements: 6.2, 6.3
   */
  async handleWorkerFailure(workerId, details) {
    try {
      productionLogger.error('Worker failure detected', { workerId, details });
      
      const worker = this.workers.get(workerId);
      if (!worker) {
        productionLogger.warn('Failed worker not found in cluster', { workerId });
        return;
      }
      
      // Mark worker as failed
      const metrics = this.workerMetrics.get(workerId);
      if (metrics) {
        metrics.status = 'failed';
        metrics.lastFailure = {
          timestamp: Date.now(),
          reason: details.reason,
          error: details.lastError
        };
      }
      
      // Remove from active workers
      this.workers.delete(workerId);
      this.workerMetrics.delete(workerId);
      
      // Unregister from health checks
      this.healthCheckService.unregisterWorker(workerId);
      
      // Create replacement worker if needed
      const currentWorkers = this.workers.size;
      if (currentWorkers < this.minWorkers) {
        productionLogger.info('Creating replacement worker', { 
          currentWorkers, 
          minWorkers: this.minWorkers 
        });
        
        await this.createWorker(worker.queueName);
      }
      
    } catch (error) {
      productionLogger.error('Error handling worker failure', { workerId, error });
    }
  }

  /**
   * Restart a specific worker
   * Requirements: 6.2, 6.3
   */
  async restartWorker(workerId) {
    try {
      productionLogger.info('Restarting worker', { workerId });
      
      const worker = this.workers.get(workerId);
      if (!worker) {
        throw new Error(`Worker ${workerId} not found`);
      }
      
      const queueName = worker.queueName;
      
      // Stop the worker
      await this.stopWorker(workerId);
      
      // Create new worker
      const newWorker = await this.createWorker(queueName);
      
      productionLogger.info('Worker restarted successfully', { 
        oldWorkerId: workerId, 
        newWorkerId: newWorker.id 
      });
      
      return newWorker;
      
    } catch (error) {
      productionLogger.error('Failed to restart worker', { workerId, error });
      throw error;
    }
  }

  /**
   * Enhanced worker creation with production monitoring
   * Requirements: 6.2, 7.1
   */
  async createWorkerWithMonitoring(queueName) {
    const worker = await this.createWorker(queueName);
    
    if (this.isProduction && worker) {
      // Register with health check service
      this.healthCheckService.registerWorker(worker.id, {
        type: 'cluster-worker',
        queueName: queueName,
        process: worker.process,
        port: worker.port,
        lastActivity: Date.now()
      });
      
      productionLogger.logWorkerEvent(worker.id, 'worker_created', {
        queueName,
        timestamp: Date.now()
      });
    }
    
    return worker;
  }

  /**
   * Enhanced worker stopping with production monitoring
   * Requirements: 6.2, 7.1
   */
  async stopWorkerWithMonitoring(workerId) {
    if (this.isProduction) {
      productionLogger.logWorkerEvent(workerId, 'worker_stopping', {
        timestamp: Date.now()
      });
      
      // Unregister from health checks
      this.healthCheckService.unregisterWorker(workerId);
    }
    
    await this.stopWorker(workerId);
    
    if (this.isProduction) {
      productionLogger.logWorkerEvent(workerId, 'worker_stopped', {
        timestamp: Date.now()
      });
    }
  }

  /**
   * Update worker activity for health monitoring
   * Requirements: 7.1, 7.2
   */
  updateWorkerActivity(workerId, activityData = {}) {
    if (this.isProduction && this.healthCheckService) {
      this.healthCheckService.updateWorkerActivity(workerId, activityData);
    }
    
    // Update internal metrics
    const metrics = this.workerMetrics.get(workerId);
    if (metrics) {
      metrics.lastActivity = Date.now();
      
      if (activityData.memoryUsage) {
        metrics.memoryUsage = activityData.memoryUsage;
      }
      
      if (activityData.cpuUsage) {
        metrics.cpuUsage = activityData.cpuUsage;
      }
      
      if (activityData.jobsProcessed) {
        metrics.jobsProcessed = (metrics.jobsProcessed || 0) + activityData.jobsProcessed;
      }
    }
  }

  /**
   * Get production health summary
   * Requirements: 7.1, 7.2
   */
  getProductionHealthSummary() {
    if (!this.isProduction || !this.healthCheckService) {
      return { available: false };
    }
    
    return {
      available: true,
      cluster: this.getClusterHealth(),
      workers: this.healthCheckService.getHealthSummary(),
      monitoring: {
        isProduction: this.isProduction,
        healthCheckInterval: this.healthCheckService.checkInterval,
        lastHealthCheck: Date.now()
      }
    };
  }
}

export default ClusterManager;