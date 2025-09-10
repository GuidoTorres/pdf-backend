import webSocketManager from './websocketManager.js';
import timeEstimationService from './timeEstimationService.js';
import logService from './logService.js';

/**
 * Integration service to connect WebSocket notifications with document processing
 */
class WebSocketIntegration {
  constructor() {
    this.activeJobs = new Map(); // jobId -> job data
  }

  /**
   * Notify when a document is queued for processing
   * @param {string} userId - User ID
   * @param {Object} jobData - Job information
   */
  notifyDocumentQueued(userId, jobData) {
    try {
      const { documentId, fileName, fileSize, userPlan } = jobData;
      
      // Determine priority based on user plan
      const priority = this.determinePriority(userPlan);
      
      // Get current queue length (would be from actual queue system)
      const currentQueueLength = this.getCurrentQueueLength(priority);
      
      // Calculate time estimation
      const estimation = timeEstimationService.estimateProcessingTime({
        fileSize,
        priority,
        currentQueueLength
      });

      const jobInfo = {
        jobId: documentId,
        fileName,
        fileSize,
        priority,
        queue: priority,
        queuePosition: currentQueueLength + 1,
        estimatedTime: estimation.estimatedTime,
        confidence: estimation.confidence
      };

      // Store job info
      this.activeJobs.set(documentId, {
        ...jobInfo,
        userId,
        startTime: Date.now(),
        status: 'queued'
      });

      // Notify user via WebSocket
      webSocketManager.notifyJobQueued(userId, jobInfo);
      
      logService.info(`Document queued for user ${userId}: ${fileName} (${priority} priority)`);
      
      return jobInfo;
    } catch (error) {
      logService.error('Error notifying document queued:', error);
      throw error;
    }
  }

  /**
   * Notify when document processing starts
   * @param {string} documentId - Document ID
   * @param {string} workerId - Worker ID processing the document
   */
  notifyDocumentStarted(documentId, workerId) {
    try {
      const job = this.activeJobs.get(documentId);
      if (!job) {
        logService.warn(`Job ${documentId} not found when notifying start`);
        return;
      }

      job.status = 'processing';
      job.workerId = workerId;
      job.actualStartTime = Date.now();

      const jobInfo = {
        jobId: documentId,
        workerId,
        queue: job.priority,
        startedAt: new Date().toISOString()
      };

      webSocketManager.notifyJobStarted(job.userId, jobInfo);
      
      logService.info(`Document processing started: ${documentId} on worker ${workerId}`);
    } catch (error) {
      logService.error('Error notifying document started:', error);
    }
  }

  /**
   * Notify processing progress
   * @param {string} documentId - Document ID
   * @param {number} progress - Progress percentage (0-100)
   * @param {string} stage - Current processing stage
   */
  notifyDocumentProgress(documentId, progress, stage = 'processing') {
    try {
      const job = this.activeJobs.get(documentId);
      if (!job) {
        logService.warn(`Job ${documentId} not found when notifying progress`);
        return;
      }

      job.progress = progress;
      job.stage = stage;

      // Calculate estimated time remaining
      const elapsedTime = Date.now() - job.actualStartTime;
      const estimatedTimeRemaining = progress > 0 ? 
        Math.round((elapsedTime / progress) * (100 - progress) / 1000) : 
        job.estimatedTime;

      const progressInfo = {
        jobId: documentId,
        progress,
        stage,
        estimatedTimeRemaining
      };

      webSocketManager.notifyJobProgress(job.userId, progressInfo);
      
      logService.debug(`Document progress: ${documentId} - ${progress}% (${stage})`);
    } catch (error) {
      logService.error('Error notifying document progress:', error);
    }
  }

  /**
   * Notify when document processing completes
   * @param {string} documentId - Document ID
   * @param {Object} result - Processing result
   * @param {boolean} success - Whether processing was successful
   */
  notifyDocumentCompleted(documentId, result, success = true) {
    try {
      const job = this.activeJobs.get(documentId);
      if (!job) {
        logService.warn(`Job ${documentId} not found when notifying completion`);
        return;
      }

      const completionTime = Date.now();
      const processingTime = completionTime - job.actualStartTime;

      job.status = success ? 'completed' : 'failed';
      job.completionTime = completionTime;
      job.processingTime = processingTime;

      const resultInfo = {
        jobId: documentId,
        success,
        result: success ? result : null,
        processingTime,
        queue: job.priority,
        fileSize: job.fileSize,
        workerId: job.workerId
      };

      webSocketManager.notifyJobCompleted(job.userId, resultInfo);

      // Record metrics for future estimations
      if (success) {
        timeEstimationService.recordProcessingTime({
          fileSize: job.fileSize,
          processingTime,
          queue: job.priority,
          workerId: job.workerId,
          success: true
        });
      }

      // Clean up job data
      this.activeJobs.delete(documentId);
      
      logService.info(`Document processing completed: ${documentId} (${processingTime}ms)`);
    } catch (error) {
      logService.error('Error notifying document completed:', error);
    }
  }

  /**
   * Notify when document processing fails
   * @param {string} documentId - Document ID
   * @param {string} error - Error message
   * @param {number} retryCount - Current retry count
   * @param {boolean} canRetry - Whether the job can be retried
   */
  notifyDocumentFailed(documentId, error, retryCount = 0, canRetry = true) {
    try {
      const job = this.activeJobs.get(documentId);
      if (!job) {
        logService.warn(`Job ${documentId} not found when notifying failure`);
        return;
      }

      job.status = 'failed';
      job.error = error;
      job.retryCount = retryCount;

      const errorInfo = {
        jobId: documentId,
        error,
        retryCount,
        canRetry,
        queue: job.priority
      };

      webSocketManager.notifyJobFailed(job.userId, errorInfo);
      
      // If this is the final failure, clean up
      if (!canRetry) {
        this.activeJobs.delete(documentId);
      }
      
      logService.error(`Document processing failed: ${documentId} - ${error}`);
    } catch (error) {
      logService.error('Error notifying document failed:', error);
    }
  }

  /**
   * Update worker metrics from document processing
   * @param {string} workerId - Worker ID
   * @param {Object} metrics - Worker metrics
   */
  updateWorkerMetrics(workerId, metrics) {
    try {
      webSocketManager.updateWorkerMetrics(workerId, {
        ...metrics,
        lastUpdate: new Date().toISOString()
      });
    } catch (error) {
      logService.error('Error updating worker metrics:', error);
    }
  }

  /**
   * Remove worker when it stops
   * @param {string} workerId - Worker ID
   */
  removeWorker(workerId) {
    try {
      webSocketManager.removeWorkerMetrics(workerId);
      logService.info(`Worker removed: ${workerId}`);
    } catch (error) {
      logService.error('Error removing worker:', error);
    }
  }

  /**
   * Get current job status
   * @param {string} documentId - Document ID
   * @returns {Object|null} Job status or null if not found
   */
  getJobStatus(documentId) {
    return this.activeJobs.get(documentId) || null;
  }

  /**
   * Get all active jobs for a user
   * @param {string} userId - User ID
   * @returns {Array} Array of active jobs
   */
  getUserActiveJobs(userId) {
    const userJobs = [];
    for (const [jobId, job] of this.activeJobs) {
      if (job.userId === userId) {
        userJobs.push(job);
      }
    }
    return userJobs;
  }

  /**
   * Determine priority based on user plan
   * @param {string} userPlan - User subscription plan
   * @returns {string} Priority level
   */
  determinePriority(userPlan) {
    const plan = (userPlan || '').toLowerCase();
    
    if (plan.includes('unlimited') || plan.includes('ilimitado')) {
      return 'premium';
    } else if (plan.includes('premium')) {
      return 'premium';
    } else {
      return 'normal';
    }
  }

  /**
   * Get current queue length (mock implementation)
   * @param {string} priority - Queue priority
   * @returns {number} Current queue length
   */
  getCurrentQueueLength(priority) {
    // In a real implementation, this would query the actual queue system
    // For now, return a mock value based on active jobs
    let count = 0;
    for (const job of this.activeJobs.values()) {
      if (job.priority === priority && job.status === 'queued') {
        count++;
      }
    }
    return count;
  }

  /**
   * Get integration statistics
   * @returns {Object} Statistics
   */
  getStatistics() {
    const stats = {
      activeJobs: this.activeJobs.size,
      jobsByStatus: {},
      jobsByPriority: {},
      averageProcessingTime: 0
    };

    let totalProcessingTime = 0;
    let completedJobs = 0;

    for (const job of this.activeJobs.values()) {
      // Count by status
      stats.jobsByStatus[job.status] = (stats.jobsByStatus[job.status] || 0) + 1;
      
      // Count by priority
      stats.jobsByPriority[job.priority] = (stats.jobsByPriority[job.priority] || 0) + 1;
      
      // Calculate average processing time for completed jobs
      if (job.status === 'completed' && job.processingTime) {
        totalProcessingTime += job.processingTime;
        completedJobs++;
      }
    }

    if (completedJobs > 0) {
      stats.averageProcessingTime = Math.round(totalProcessingTime / completedJobs);
    }

    return stats;
  }
}

// Export singleton instance
const webSocketIntegration = new WebSocketIntegration();
export default webSocketIntegration;