import { Worker } from 'bullmq';
import Redis from 'ioredis';
import os from 'os';
import config from '../config/config.js';
import { processJob } from '../services/jobProcessor.js';
import logService from '../services/logService.js';
import webSocketManager from '../services/websocketManager.js';

/**
 * ScalableWorker - Enhanced worker with cluster integration and real-time metrics
 * Requirements: 1.1, 1.4, 1.5, 3.5
 */
class ScalableWorker {
  constructor(options = {}) {
    this.workerId = options.workerId || `worker-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
    this.queueName = options.queueName || 'pdf-processing-normal';
    this.clusterManager = options.clusterManager || null;
    this.concurrency = options.concurrency || (this.queueName === 'pdf-processing-premium' ? 2 : 1);
    
    // Redis connection for metrics and communication
    this.redis = new Redis(config.redis.url, {
      maxRetriesPerRequest: null
    });
    
    // Worker metrics
    this.metrics = {
      workerId: this.workerId,
      queueName: this.queueName,
      status: 'idle',
      createdAt: Date.now(),
      lastHeartbeat: Date.now(),
      jobsProcessed: 0,
      jobsFailed: 0,
      currentJob: null,
      avgProcessingTime: 0,
      totalProcessingTime: 0,
      memoryUsage: 0,
      cpuUsage: 0,
      lastError: null,
      lastErrorAt: null
    };
    
    // BullMQ Worker instance
    this.worker = null;
    
    // Graceful shutdown handling
    this.isShuttingDown = false;
    this.shutdownPromise = null;
    
    // Metrics reporting interval
    this.metricsInterval = null;
    this.metricsReportingInterval = options.metricsReportingInterval || 10000; // 10 seconds
    
    logService.log('[SCALABLE_WORKER] Worker initialized', {
      workerId: this.workerId,
      queueName: this.queueName,
      concurrency: this.concurrency
    });
  }

  /**
   * Start the worker
   * Requirements: 1.1, 1.4
   */
  async start() {
    try {
      logService.log('[SCALABLE_WORKER] Starting worker', { workerId: this.workerId });
      
      // Create BullMQ worker with enhanced processing
      this.worker = new Worker(this.queueName, async (job) => {
        return await this.processJobWithMetrics(job);
      }, {
        connection: this.redis,
        concurrency: this.concurrency,
        maxStalledCount: 3,
        stalledInterval: 30000,
        removeOnComplete: 10,
        removeOnFail: 5
      });
      
      // Set up event handlers
      this.setupEventHandlers();
      
      // Start metrics reporting
      this.startMetricsReporting();
      
      // Register with cluster manager if available
      if (this.clusterManager) {
        await this.registerWithCluster();
      }
      
      // Set up graceful shutdown handlers
      this.setupShutdownHandlers();
      
      this.updateMetrics({ status: 'active' });
      
      logService.log('[SCALABLE_WORKER] Worker started successfully', { workerId: this.workerId });
      
    } catch (error) {
      logService.error('[SCALABLE_WORKER] Failed to start worker:', error);
      throw error;
    }
  }

  /**
   * Process job with enhanced metrics collection and real-time reporting
   * Requirements: 1.4, 4.1, 4.2, 7.1
   */
  async processJobWithMetrics(job) {
    const startTime = Date.now();
    const startMemory = process.memoryUsage();
    const startCpu = process.cpuUsage();
    const { userId, originalName, fileSize, userPlan } = job.data;
    
    // Update metrics - job started
    this.updateMetrics({
      status: 'processing',
      currentJob: job.id,
      lastHeartbeat: Date.now()
    });
    
    // Notify user via WebSocket that job started (Requirement 4.2)
    if (userId) {
      webSocketManager.notifyJobStarted(userId, {
        jobId: job.id,
        workerId: this.workerId,
        fileName: originalName,
        queue: this.queueName
      });
    }
    
    // Report to cluster manager
    if (this.clusterManager) {
      await this.reportToCluster('job-started', {
        jobId: job.id,
        workerId: this.workerId,
        queueName: this.queueName,
        startTime,
        userId,
        fileSize
      });
    }
    
    try {
      // Process the job using existing logic with progress reporting
      const result = await this.processJobWithProgressReporting(job, startTime);
      
      // Calculate processing metrics
      const processingTime = Date.now() - startTime;
      const endMemory = process.memoryUsage();
      const endCpu = process.cpuUsage(startCpu);
      
      const memoryUsed = Math.max(0, endMemory.heapUsed - startMemory.heapUsed);
      const cpuTime = (endCpu.user + endCpu.system) / 1000; // Convert to milliseconds
      
      // Update worker metrics
      const newJobsProcessed = this.metrics.jobsProcessed + 1;
      const newTotalTime = this.metrics.totalProcessingTime + processingTime;
      const newAvgTime = newTotalTime / newJobsProcessed;
      
      this.updateMetrics({
        status: 'idle',
        currentJob: null,
        jobsProcessed: newJobsProcessed,
        totalProcessingTime: newTotalTime,
        avgProcessingTime: newAvgTime,
        memoryUsage: memoryUsed,
        cpuUsage: cpuTime,
        lastHeartbeat: Date.now()
      });
      
      // Notify user via WebSocket that job completed (Requirement 4.4)
      if (userId) {
        webSocketManager.notifyJobCompleted(userId, {
          jobId: job.id,
          success: true,
          result: result,
          processingTime,
          queue: this.queueName,
          workerId: this.workerId,
          fileSize
        });
      }
      
      // Report success to cluster manager
      if (this.clusterManager) {
        await this.reportToCluster('job-completed', {
          jobId: job.id,
          workerId: this.workerId,
          processingTime,
          memoryUsed,
          cpuTime,
          success: true,
          userId,
          fileSize
        });
      }
      
      logService.log('[SCALABLE_WORKER] Job completed successfully', {
        workerId: this.workerId,
        jobId: job.id,
        processingTime,
        memoryUsed,
        avgProcessingTime: newAvgTime,
        userId,
        userPlan
      });
      
      return result;
      
    } catch (error) {
      const processingTime = Date.now() - startTime;
      
      // Update metrics - job failed
      this.updateMetrics({
        status: 'idle',
        currentJob: null,
        jobsFailed: this.metrics.jobsFailed + 1,
        lastError: error.message,
        lastErrorAt: Date.now(),
        lastHeartbeat: Date.now()
      });
      
      // Notify user via WebSocket that job failed (Requirement 4.4)
      if (userId) {
        webSocketManager.notifyJobFailed(userId, {
          jobId: job.id,
          error: error.message,
          retryCount: job.attemptsMade || 0,
          canRetry: (job.attemptsMade || 0) < 3,
          queue: this.queueName
        });
      }
      
      // Report failure to cluster manager
      if (this.clusterManager) {
        await this.reportToCluster('job-failed', {
          jobId: job.id,
          workerId: this.workerId,
          processingTime,
          error: error.message,
          success: false,
          userId,
          fileSize
        });
      }
      
      logService.error('[SCALABLE_WORKER] Job processing failed', {
        workerId: this.workerId,
        jobId: job.id,
        processingTime,
        error: error.message,
        userId,
        userPlan
      });
      
      throw error;
    }
  }

  /**
   * Process job with progress reporting to user
   * Requirements: 4.3
   */
  async processJobWithProgressReporting(job, startTime) {
    const { userId } = job.data;
    
    // Report initial progress
    if (userId) {
      webSocketManager.notifyJobProgress(userId, {
        jobId: job.id,
        progress: 10,
        stage: 'Initializing processing...',
        estimatedTimeRemaining: this.estimateRemainingTime(startTime, 10)
      });
    }
    
    // Process the job using existing logic
    const result = await processJob(job);
    
    // Report completion progress
    if (userId) {
      webSocketManager.notifyJobProgress(userId, {
        jobId: job.id,
        progress: 100,
        stage: 'Processing completed',
        estimatedTimeRemaining: 0
      });
    }
    
    return result;
  }

  /**
   * Estimate remaining processing time
   * Requirements: 4.1, 4.3
   */
  estimateRemainingTime(startTime, currentProgress) {
    if (currentProgress <= 0) return this.metrics.avgProcessingTime || 30;
    
    const elapsedTime = Date.now() - startTime;
    const progressRatio = currentProgress / 100;
    const estimatedTotalTime = elapsedTime / progressRatio;
    const remainingTime = Math.max(0, estimatedTotalTime - elapsedTime);
    
    return Math.round(remainingTime / 1000); // Convert to seconds
  }

  /**
   * Set up BullMQ event handlers
   * Requirements: 1.4, 6.1
   */
  setupEventHandlers() {
    this.worker.on('completed', (job) => {
      logService.log('[SCALABLE_WORKER] Job completed event', {
        workerId: this.workerId,
        jobId: job.id,
        duration: job.finishedOn - job.processedOn
      });
    });

    this.worker.on('failed', (job, err) => {
      logService.error('[SCALABLE_WORKER] Job failed event', {
        workerId: this.workerId,
        jobId: job.id,
        error: err.message,
        duration: job.finishedOn - job.processedOn
      });
    });

    this.worker.on('active', (job) => {
      logService.log('[SCALABLE_WORKER] Job active event', {
        workerId: this.workerId,
        jobId: job.id,
        priority: job.data?.priority,
        userPlan: job.data?.userPlan
      });
    });

    this.worker.on('stalled', (jobId) => {
      logService.warn('[SCALABLE_WORKER] Job stalled', {
        workerId: this.workerId,
        jobId
      });
      
      this.updateMetrics({
        status: 'stalled',
        lastError: 'Job stalled',
        lastErrorAt: Date.now()
      });
    });

    this.worker.on('error', (err) => {
      logService.error('[SCALABLE_WORKER] Worker error', {
        workerId: this.workerId,
        error: err.message
      });
      
      this.updateMetrics({
        status: 'error',
        lastError: err.message,
        lastErrorAt: Date.now()
      });
    });

    this.worker.on('ready', () => {
      logService.log('[SCALABLE_WORKER] Worker ready', { workerId: this.workerId });
      this.updateMetrics({ status: 'idle' });
    });

    this.worker.on('closing', () => {
      logService.log('[SCALABLE_WORKER] Worker closing', { workerId: this.workerId });
      this.updateMetrics({ status: 'closing' });
    });
  }

  /**
   * Start metrics reporting to Redis, cluster manager, and WebSocket
   * Requirements: 7.1, 7.2
   */
  startMetricsReporting() {
    this.metricsInterval = setInterval(async () => {
      try {
        // Update system metrics
        await this.updateSystemMetrics();
        
        // Store metrics in Redis for monitoring
        const metricsKey = `worker:metrics:${this.workerId}`;
        await this.redis.setex(metricsKey, 60, JSON.stringify(this.metrics));
        
        // Report to WebSocket manager for real-time dashboard
        webSocketManager.updateWorkerMetrics(this.workerId, this.metrics);
        
        // Report to cluster manager
        if (this.clusterManager) {
          await this.reportToCluster('metrics-update', {
            workerId: this.workerId,
            metrics: this.metrics
          });
        }
        
        // Update heartbeat
        this.updateMetrics({ lastHeartbeat: Date.now() });
        
      } catch (error) {
        logService.error('[SCALABLE_WORKER] Metrics reporting failed:', error);
      }
    }, this.metricsReportingInterval);
    
    logService.log('[SCALABLE_WORKER] Metrics reporting started', { 
      workerId: this.workerId,
      interval: this.metricsReportingInterval 
    });
  }

  /**
   * Update system-level metrics (CPU, memory)
   * Requirements: 7.1
   */
  async updateSystemMetrics() {
    try {
      const memUsage = process.memoryUsage();
      const cpuUsage = await this.getCpuUsage();
      
      this.updateMetrics({
        memoryUsage: memUsage.heapUsed,
        cpuUsage: cpuUsage
      });
      
    } catch (error) {
      logService.error('[SCALABLE_WORKER] Failed to update system metrics:', error);
    }
  }

  /**
   * Get current CPU usage percentage
   */
  async getCpuUsage() {
    return new Promise((resolve) => {
      const startUsage = process.cpuUsage();
      
      setTimeout(() => {
        const endUsage = process.cpuUsage(startUsage);
        const totalUsage = endUsage.user + endUsage.system;
        const percentage = (totalUsage / 1000000) * 100; // Convert to percentage
        resolve(Math.min(100, percentage));
      }, 100);
    });
  }

  /**
   * Update worker metrics
   * Requirements: 7.1, 7.2
   */
  updateMetrics(updates) {
    this.metrics = {
      ...this.metrics,
      ...updates,
      lastUpdated: Date.now()
    };
  }

  /**
   * Register with cluster manager
   * Requirements: 1.1, 1.4
   */
  async registerWithCluster() {
    try {
      if (this.clusterManager && typeof this.clusterManager.registerWorker === 'function') {
        await this.clusterManager.registerWorker(this.workerId, this);
        logService.log('[SCALABLE_WORKER] Registered with cluster manager', { workerId: this.workerId });
      }
    } catch (error) {
      logService.error('[SCALABLE_WORKER] Failed to register with cluster manager:', error);
    }
  }

  /**
   * Report events to cluster manager
   * Requirements: 1.4, 7.1
   */
  async reportToCluster(event, data) {
    try {
      if (this.clusterManager && typeof this.clusterManager.handleWorkerEvent === 'function') {
        await this.clusterManager.handleWorkerEvent(event, data);
      }
    } catch (error) {
      logService.error('[SCALABLE_WORKER] Failed to report to cluster manager:', error);
    }
  }

  /**
   * Set up graceful shutdown handlers
   * Requirements: 3.5, 5.5
   */
  setupShutdownHandlers() {
    // Handle SIGTERM (cluster manager shutdown)
    process.on('SIGTERM', () => {
      logService.log('[SCALABLE_WORKER] Received SIGTERM, initiating graceful shutdown', { 
        workerId: this.workerId 
      });
      this.gracefulShutdown();
    });

    // Handle SIGINT (Ctrl+C)
    process.on('SIGINT', () => {
      logService.log('[SCALABLE_WORKER] Received SIGINT, initiating graceful shutdown', { 
        workerId: this.workerId 
      });
      this.gracefulShutdown();
    });

    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      logService.error('[SCALABLE_WORKER] Uncaught exception:', error);
      this.updateMetrics({
        status: 'error',
        lastError: error.message,
        lastErrorAt: Date.now()
      });
      this.gracefulShutdown();
    });

    // Handle unhandled promise rejections
    process.on('unhandledRejection', (reason, promise) => {
      logService.error('[SCALABLE_WORKER] Unhandled promise rejection:', reason);
      this.updateMetrics({
        status: 'error',
        lastError: reason?.message || 'Unhandled promise rejection',
        lastErrorAt: Date.now()
      });
    });
  }

  /**
   * Perform graceful shutdown
   * Requirements: 3.5, 5.5
   */
  async gracefulShutdown() {
    if (this.isShuttingDown) {
      return this.shutdownPromise;
    }
    
    this.isShuttingDown = true;
    this.updateMetrics({ status: 'shutting_down' });
    
    logService.log('[SCALABLE_WORKER] Starting graceful shutdown', { workerId: this.workerId });
    
    this.shutdownPromise = this.performShutdown();
    return this.shutdownPromise;
  }

  /**
   * Perform the actual shutdown process
   * Requirements: 3.5, 5.5
   */
  async performShutdown() {
    try {
      // Stop accepting new jobs
      if (this.worker) {
        logService.log('[SCALABLE_WORKER] Stopping worker from accepting new jobs', { 
          workerId: this.workerId 
        });
        await this.worker.pause();
      }
      
      // Wait for current job to complete (with timeout)
      if (this.metrics.currentJob) {
        logService.log('[SCALABLE_WORKER] Waiting for current job to complete', { 
          workerId: this.workerId,
          currentJob: this.metrics.currentJob 
        });
        
        const timeout = 60000; // 1 minute timeout
        const startWait = Date.now();
        
        while (this.metrics.currentJob && (Date.now() - startWait) < timeout) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
        if (this.metrics.currentJob) {
          logService.warn('[SCALABLE_WORKER] Timeout waiting for job completion, forcing shutdown', { 
            workerId: this.workerId,
            currentJob: this.metrics.currentJob 
          });
        }
      }
      
      // Stop metrics reporting
      if (this.metricsInterval) {
        clearInterval(this.metricsInterval);
        this.metricsInterval = null;
      }
      
      // Close worker
      if (this.worker) {
        logService.log('[SCALABLE_WORKER] Closing BullMQ worker', { workerId: this.workerId });
        await this.worker.close();
        this.worker = null;
      }
      
      // Clean up Redis connection
      if (this.redis) {
        // Remove worker metrics from Redis
        const metricsKey = `worker:metrics:${this.workerId}`;
        await this.redis.del(metricsKey);
        
        // Close Redis connection
        await this.redis.quit();
        this.redis = null;
      }
      
      // Notify WebSocket manager to remove worker metrics
      webSocketManager.removeWorkerMetrics(this.workerId);
      
      // Notify cluster manager
      if (this.clusterManager) {
        await this.reportToCluster('worker-shutdown', {
          workerId: this.workerId,
          finalMetrics: this.metrics
        });
      }
      
      this.updateMetrics({ status: 'shutdown' });
      
      logService.log('[SCALABLE_WORKER] Graceful shutdown completed', { workerId: this.workerId });
      
    } catch (error) {
      logService.error('[SCALABLE_WORKER] Error during shutdown:', error);
    }
  }

  /**
   * Get current worker status
   * Requirements: 7.1, 7.2
   */
  getStatus() {
    return {
      workerId: this.workerId,
      queueName: this.queueName,
      status: this.metrics.status,
      isShuttingDown: this.isShuttingDown,
      currentJob: this.metrics.currentJob,
      metrics: this.metrics
    };
  }

  /**
   * Get worker metrics
   * Requirements: 7.1, 7.2
   */
  getMetrics() {
    return { ...this.metrics };
  }

  /**
   * Check if worker is healthy
   * Requirements: 6.1
   */
  isHealthy() {
    const now = Date.now();
    const heartbeatThreshold = 60000; // 1 minute
    const errorThreshold = 300000; // 5 minutes
    
    // Check heartbeat
    if (now - this.metrics.lastHeartbeat > heartbeatThreshold) {
      return false;
    }
    
    // Check error state
    if (this.metrics.status === 'error' && 
        this.metrics.lastErrorAt && 
        (now - this.metrics.lastErrorAt < errorThreshold)) {
      return false;
    }
    
    // Check if shutting down
    if (this.isShuttingDown) {
      return false;
    }
    
    return true;
  }

  /**
   * Force shutdown (used by cluster manager)
   * Requirements: 5.5
   */
  async forceShutdown() {
    logService.warn('[SCALABLE_WORKER] Force shutdown initiated', { workerId: this.workerId });
    
    try {
      // Stop metrics reporting immediately
      if (this.metricsInterval) {
        clearInterval(this.metricsInterval);
        this.metricsInterval = null;
      }
      
      // Force close worker
      if (this.worker) {
        await this.worker.close(true); // Force close
        this.worker = null;
      }
      
      // Close Redis connection
      if (this.redis) {
        await this.redis.quit();
        this.redis = null;
      }
      
      this.updateMetrics({ status: 'force_shutdown' });
      
      logService.log('[SCALABLE_WORKER] Force shutdown completed', { workerId: this.workerId });
      
    } catch (error) {
      logService.error('[SCALABLE_WORKER] Error during force shutdown:', error);
    }
  }
}

export default ScalableWorker;