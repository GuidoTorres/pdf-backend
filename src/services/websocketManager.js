import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import config from '../config/config.js';
import logService from './logService.js';

class WebSocketManager {
  constructor() {
    this.io = null;
    this.userSockets = new Map(); // userId -> socket
    this.adminSockets = new Set(); // Admin sockets
    this.queueMetrics = {
      premium: { waiting: 0, active: 0, completed: 0 },
      normal: { waiting: 0, active: 0, completed: 0 },
      large: { waiting: 0, active: 0, completed: 0 }
    };
    this.workerMetrics = new Map(); // workerId -> metrics
    this.historicalMetrics = [];
  }

  /**
   * Initialize WebSocket server
   * @param {Object} server - HTTP server instance
   */
  initialize(server) {
    this.io = new Server(server, {
      cors: {
        origin: ['http://localhost:5173', 'http://localhost:3000', 'http://127.0.0.1:5173', 'https://pdf-converter-sable.vercel.app'],
        credentials: true,
        methods: ['GET', 'POST']
      },
      transports: ['websocket', 'polling']
    });

    this.setupEventHandlers();
    this.startMetricsCollection();
    
    logService.info('WebSocket server initialized');
  }

  /**
   * Setup WebSocket event handlers
   */
  setupEventHandlers() {
    this.io.on('connection', (socket) => {
      logService.info(`WebSocket client connected: ${socket.id}`);

      // Handle authentication
      socket.on('authenticate', async (data) => {
        try {
          const { token, isAdmin } = data;
          
          if (!token) {
            socket.emit('auth-error', { message: 'Token required' });
            return;
          }

          const decoded = jwt.verify(token, config.jwt.secret);
          socket.userId = decoded.userId;
          socket.isAdmin = isAdmin || false;

          // Store user socket mapping
          this.userSockets.set(decoded.userId, socket);
          
          if (socket.isAdmin) {
            this.adminSockets.add(socket);
            // Send current metrics to admin
            socket.emit('admin-metrics', this.getAdminMetrics());
          }

          socket.emit('authenticated', { 
            userId: decoded.userId, 
            isAdmin: socket.isAdmin 
          });

          logService.info(`User ${decoded.userId} authenticated via WebSocket`);
        } catch (error) {
          logService.error('WebSocket authentication error:', error);
          socket.emit('auth-error', { message: 'Invalid token' });
        }
      });

      // Handle job status requests
      socket.on('request-job-status', (jobId) => {
        if (socket.userId) {
          this.sendJobStatus(socket.userId, jobId);
        }
      });

      // Handle admin requests
      socket.on('request-admin-metrics', () => {
        if (socket.isAdmin) {
          socket.emit('admin-metrics', this.getAdminMetrics());
        }
      });

      // Handle disconnection
      socket.on('disconnect', () => {
        if (socket.userId) {
          this.userSockets.delete(socket.userId);
        }
        if (socket.isAdmin) {
          this.adminSockets.delete(socket);
        }
        logService.info(`WebSocket client disconnected: ${socket.id}`);
      });
    });
  }

  /**
   * Notify user about job status change
   * @param {string} userId - User ID
   * @param {string} event - Event type
   * @param {Object} data - Event data
   */
  notifyUser(userId, event, data) {
    const socket = this.userSockets.get(userId);
    if (socket && socket.connected) {
      socket.emit(event, {
        ...data,
        timestamp: new Date().toISOString()
      });
      logService.debug(`[WebSocket] Notified user ${userId} of event ${event}`);
    } else {
      logService.warn(`[WebSocket] Cannot notify user ${userId} of event ${event} - socket not found or disconnected`);
    }
  }

  /**
   * Notify job queued
   * @param {string} userId - User ID
   * @param {Object} jobData - Job information
   */
  notifyJobQueued(userId, jobData) {
    const estimatedTime = this.calculateEstimatedTime(jobData.priority, jobData.fileSize);
    
    this.notifyUser(userId, 'job-queued', {
      jobId: jobData.jobId,
      fileName: jobData.fileName,
      queuePosition: jobData.queuePosition,
      estimatedTime,
      priority: jobData.priority
    });

    this.updateQueueMetrics(jobData.queue, 'queued');
  }

  /**
   * Notify job started
   * @param {string} userId - User ID
   * @param {Object} jobData - Job information
   */
  notifyJobStarted(userId, jobData) {
    this.notifyUser(userId, 'job-started', {
      jobId: jobData.jobId,
      workerId: jobData.workerId,
      startedAt: new Date().toISOString()
    });

    this.updateQueueMetrics(jobData.queue, 'started');
  }

  /**
   * Notify job progress
   * @param {string} userId - User ID
   * @param {Object} progressData - Progress information
   */
  notifyJobProgress(userId, progressData) {
    logService.info(`[WebSocket] Job progress for user ${userId}: ${progressData.stage} (${progressData.progress}%)`);
    this.notifyUser(userId, 'job-progress', {
      jobId: progressData.jobId,
      progress: progressData.progress,
      stage: progressData.stage,
      estimatedTimeRemaining: progressData.estimatedTimeRemaining
    });
  }

  /**
   * Notify job completed
   * @param {string} userId - User ID
   * @param {Object} resultData - Completion information
   */
  notifyJobCompleted(userId, resultData) {
    this.notifyUser(userId, 'job-completed', {
      jobId: resultData.jobId,
      success: resultData.success,
      result: resultData.result,
      processingTime: resultData.processingTime,
      completedAt: new Date().toISOString()
    });

    this.updateQueueMetrics(resultData.queue, 'completed');
    this.recordProcessingMetrics(resultData);
  }

  /**
   * Notify job failed
   * @param {string} userId - User ID
   * @param {Object} errorData - Error information
   */
  notifyJobFailed(userId, errorData) {
    this.notifyUser(userId, 'job-failed', {
      jobId: errorData.jobId,
      error: errorData.error,
      retryCount: errorData.retryCount,
      canRetry: errorData.canRetry
    });

    this.updateQueueMetrics(errorData.queue, 'failed');
  }

  /**
   * Broadcast queue status to all connected clients
   */
  broadcastQueueStatus() {
    const queueStatus = {
      queues: this.queueMetrics,
      totalWaiting: Object.values(this.queueMetrics).reduce((sum, q) => sum + q.waiting, 0),
      totalActive: Object.values(this.queueMetrics).reduce((sum, q) => sum + q.active, 0),
      activeWorkers: this.workerMetrics.size,
      timestamp: new Date().toISOString()
    };

    // Send to all authenticated users
    this.userSockets.forEach((socket) => {
      if (socket.connected) {
        socket.emit('queue-status', queueStatus);
      }
    });

    // Send detailed metrics to admins
    this.adminSockets.forEach((socket) => {
      if (socket.connected) {
        socket.emit('admin-queue-status', {
          ...queueStatus,
          workerDetails: Array.from(this.workerMetrics.entries()).map(([id, metrics]) => ({
            workerId: id,
            ...metrics
          }))
        });
      }
    });
  }

  /**
   * Update worker metrics
   * @param {string} workerId - Worker ID
   * @param {Object} metrics - Worker metrics
   */
  updateWorkerMetrics(workerId, metrics) {
    this.workerMetrics.set(workerId, {
      ...metrics,
      lastUpdate: new Date().toISOString()
    });

    // Broadcast updated metrics to admins
    this.adminSockets.forEach((socket) => {
      if (socket.connected) {
        socket.emit('worker-metrics-update', {
          workerId,
          metrics: this.workerMetrics.get(workerId)
        });
      }
    });
  }

  /**
   * Remove worker metrics when worker stops
   * @param {string} workerId - Worker ID
   */
  removeWorkerMetrics(workerId) {
    this.workerMetrics.delete(workerId);
    
    this.adminSockets.forEach((socket) => {
      if (socket.connected) {
        socket.emit('worker-removed', { workerId });
      }
    });
  }

  /**
   * Calculate estimated processing time
   * @param {string} priority - Job priority
   * @param {number} fileSize - File size in bytes
   * @returns {number} Estimated time in seconds
   */
  calculateEstimatedTime(priority, fileSize) {
    // Base processing time per MB
    const baseTimePerMB = 5; // 5 seconds per MB
    const fileSizeMB = fileSize / (1024 * 1024);
    
    // Priority multipliers
    const priorityMultipliers = {
      'premium': 0.5,   // Premium users get 50% faster processing
      'normal': 1.0,    // Normal processing time
      'large': 1.5      // Large files take 50% longer
    };

    const multiplier = priorityMultipliers[priority] || 1.0;
    
    // Queue wait time based on current queue length
    const queueLength = this.queueMetrics[priority]?.waiting || 0;
    const avgProcessingTime = this.getAverageProcessingTime();
    const queueWaitTime = queueLength * avgProcessingTime;

    const processingTime = fileSizeMB * baseTimePerMB * multiplier;
    
    return Math.round(queueWaitTime + processingTime);
  }

  /**
   * Get average processing time from historical data
   * @returns {number} Average processing time in seconds
   */
  getAverageProcessingTime() {
    if (this.historicalMetrics.length === 0) {
      return 30; // Default 30 seconds
    }

    const recentMetrics = this.historicalMetrics.slice(-50); // Last 50 jobs
    const totalTime = recentMetrics.reduce((sum, metric) => sum + metric.processingTime, 0);
    
    return totalTime / recentMetrics.length;
  }

  /**
   * Update queue metrics
   * @param {string} queueName - Queue name
   * @param {string} action - Action type (queued, started, completed, failed)
   */
  updateQueueMetrics(queueName, action) {
    if (!this.queueMetrics[queueName]) {
      this.queueMetrics[queueName] = { waiting: 0, active: 0, completed: 0 };
    }

    switch (action) {
      case 'queued':
        this.queueMetrics[queueName].waiting++;
        break;
      case 'started':
        this.queueMetrics[queueName].waiting = Math.max(0, this.queueMetrics[queueName].waiting - 1);
        this.queueMetrics[queueName].active++;
        break;
      case 'completed':
      case 'failed':
        this.queueMetrics[queueName].active = Math.max(0, this.queueMetrics[queueName].active - 1);
        if (action === 'completed') {
          this.queueMetrics[queueName].completed++;
        }
        break;
    }

    // Broadcast updated queue status
    this.broadcastQueueStatus();
  }

  /**
   * Record processing metrics for historical analysis
   * @param {Object} resultData - Processing result data
   */
  recordProcessingMetrics(resultData) {
    const metric = {
      timestamp: new Date().toISOString(),
      processingTime: resultData.processingTime,
      fileSize: resultData.fileSize,
      queue: resultData.queue,
      workerId: resultData.workerId,
      success: resultData.success
    };

    this.historicalMetrics.push(metric);

    // Keep only last 1000 metrics to prevent memory issues
    if (this.historicalMetrics.length > 1000) {
      this.historicalMetrics = this.historicalMetrics.slice(-1000);
    }
  }

  /**
   * Get admin metrics dashboard data
   * @returns {Object} Admin metrics
   */
  getAdminMetrics() {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    
    const recentMetrics = this.historicalMetrics.filter(
      metric => new Date(metric.timestamp) > oneHourAgo
    );

    const successfulJobs = recentMetrics.filter(m => m.success);
    const failedJobs = recentMetrics.filter(m => !m.success);

    return {
      queues: this.queueMetrics,
      workers: Array.from(this.workerMetrics.entries()).map(([id, metrics]) => ({
        workerId: id,
        ...metrics
      })),
      performance: {
        totalJobsLastHour: recentMetrics.length,
        successfulJobs: successfulJobs.length,
        failedJobs: failedJobs.length,
        successRate: recentMetrics.length > 0 ? (successfulJobs.length / recentMetrics.length) * 100 : 0,
        averageProcessingTime: this.getAverageProcessingTime(),
        totalActiveJobs: Object.values(this.queueMetrics).reduce((sum, q) => sum + q.active, 0),
        totalWaitingJobs: Object.values(this.queueMetrics).reduce((sum, q) => sum + q.waiting, 0)
      },
      system: {
        connectedUsers: this.userSockets.size,
        connectedAdmins: this.adminSockets.size,
        activeWorkers: this.workerMetrics.size,
        uptime: process.uptime()
      },
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Send job status to specific user
   * @param {string} userId - User ID
   * @param {string} jobId - Job ID
   */
  async sendJobStatus(userId, jobId) {
    try {
      // This would typically query the database for job status
      // For now, we'll emit a placeholder response
      this.notifyUser(userId, 'job-status-response', {
        jobId,
        message: 'Job status requested - implement database query'
      });
    } catch (error) {
      logService.error('Error sending job status:', error);
    }
  }

  /**
   * Start periodic metrics collection and broadcasting
   */
  startMetricsCollection() {
    // Broadcast queue status every 5 seconds
    setInterval(() => {
      this.broadcastQueueStatus();
    }, 5000);

    // Clean up old metrics every hour
    setInterval(() => {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      this.historicalMetrics = this.historicalMetrics.filter(
        metric => new Date(metric.timestamp) > oneHourAgo
      );
    }, 60 * 60 * 1000);

    logService.info('WebSocket metrics collection started');
  }

  /**
   * Get WebSocket server instance
   * @returns {Object} Socket.IO server instance
   */
  getIO() {
    return this.io;
  }

  /**
   * Get connected users count
   * @returns {number} Number of connected users
   */
  getConnectedUsersCount() {
    return this.userSockets.size;
  }

  /**
   * Get connected admins count
   * @returns {number} Number of connected admins
   */
  getConnectedAdminsCount() {
    return this.adminSockets.size;
  }
}

// Export singleton instance
const webSocketManager = new WebSocketManager();
export default webSocketManager;