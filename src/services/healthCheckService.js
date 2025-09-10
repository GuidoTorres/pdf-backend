/**
 * Health Check Service for Production Monitoring
 * Monitors worker health and implements auto-restart functionality
 * 
 * Requirements: 6.2, 6.3
 */

import EventEmitter from 'events';
import { performance } from 'perf_hooks';

class HealthCheckService extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.checkInterval = options.checkInterval || 30000; // 30 seconds
    this.timeout = options.timeout || 10000; // 10 seconds
    this.maxFailures = options.maxFailures || 3;
    this.retryDelay = options.retryDelay || 5000; // 5 seconds
    
    this.workers = new Map();
    this.healthTimer = null;
    this.isRunning = false;
  }

  start() {
    if (this.isRunning) return;
    
    console.log('🏥 Starting health check service...');
    this.isRunning = true;
    
    // Start periodic health checks
    this.healthTimer = setInterval(() => {
      this.performHealthChecks();
    }, this.checkInterval);
    
    console.log(`✅ Health check service started (interval: ${this.checkInterval}ms)`);
  }

  stop() {
    if (!this.isRunning) return;
    
    console.log('🛑 Stopping health check service...');
    this.isRunning = false;
    
    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }
    
    console.log('✅ Health check service stopped');
  }

  registerWorker(workerId, workerInfo) {
    console.log(`📝 Registering worker for health checks: ${workerId}`);
    
    this.workers.set(workerId, {
      ...workerInfo,
      id: workerId,
      status: 'healthy',
      lastCheck: Date.now(),
      lastResponse: Date.now(),
      failureCount: 0,
      responseTime: 0,
      uptime: Date.now(),
      checks: {
        total: 0,
        successful: 0,
        failed: 0
      }
    });
    
    this.emit('workerRegistered', workerId);
  }

  unregisterWorker(workerId) {
    console.log(`📝 Unregistering worker from health checks: ${workerId}`);
    
    if (this.workers.has(workerId)) {
      this.workers.delete(workerId);
      this.emit('workerUnregistered', workerId);
    }
  }

  async performHealthChecks() {
    if (!this.isRunning || this.workers.size === 0) return;
    
    console.log(`🔍 Performing health checks on ${this.workers.size} workers...`);
    
    const checkPromises = Array.from(this.workers.keys()).map(workerId => 
      this.checkWorkerHealth(workerId)
    );
    
    try {
      await Promise.allSettled(checkPromises);
      
      // Emit overall health status
      const healthSummary = this.getHealthSummary();
      this.emit('healthCheckCompleted', healthSummary);
      
    } catch (error) {
      console.error('Error during health checks:', error);
    }
  }

  async checkWorkerHealth(workerId) {
    const worker = this.workers.get(workerId);
    if (!worker) return;
    
    const startTime = performance.now();
    worker.lastCheck = Date.now();
    worker.checks.total++;
    
    try {
      // Perform health check
      const isHealthy = await this.performWorkerHealthCheck(worker);
      const responseTime = performance.now() - startTime;
      
      if (isHealthy) {
        // Worker is healthy
        worker.status = 'healthy';
        worker.lastResponse = Date.now();
        worker.responseTime = responseTime;
        worker.failureCount = 0;
        worker.checks.successful++;
        
        this.emit('workerHealthy', workerId, {
          responseTime,
          uptime: Date.now() - worker.uptime
        });
        
      } else {
        // Worker failed health check
        await this.handleWorkerFailure(workerId, 'health_check_failed');
      }
      
    } catch (error) {
      console.error(`Health check failed for worker ${workerId}:`, error);
      await this.handleWorkerFailure(workerId, 'health_check_error', error);
    }
  }

  async performWorkerHealthCheck(worker) {
    try {
      // Different health check strategies based on worker type
      switch (worker.type) {
        case 'api':
          return await this.checkApiWorkerHealth(worker);
        case 'pdf-processor':
          return await this.checkPdfProcessorHealth(worker);
        case 'cluster-worker':
          return await this.checkClusterWorkerHealth(worker);
        default:
          return await this.checkGenericWorkerHealth(worker);
      }
    } catch (error) {
      console.error(`Health check error for worker ${worker.id}:`, error);
      return false;
    }
  }

  async checkApiWorkerHealth(worker) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);
      
      const response = await fetch(`http://localhost:${worker.port || 3000}/api/dashboard/status`, {
        signal: controller.signal,
        headers: { 'User-Agent': 'HealthCheck/1.0' }
      });
      
      clearTimeout(timeoutId);
      
      return response.ok;
    } catch (error) {
      if (error.name === 'AbortError') {
        console.warn(`API health check timeout for worker ${worker.id}`);
      }
      return false;
    }
  }

  async checkPdfProcessorHealth(worker) {
    try {
      // Check if worker process is still running
      if (worker.process && worker.process.pid) {
        try {
          process.kill(worker.process.pid, 0); // Signal 0 checks if process exists
          return true;
        } catch (error) {
          return false;
        }
      }
      
      // If no process reference, assume healthy (might be managed externally)
      return true;
    } catch (error) {
      return false;
    }
  }

  async checkClusterWorkerHealth(worker) {
    try {
      // Check worker metrics and responsiveness
      if (worker.lastActivity) {
        const timeSinceActivity = Date.now() - worker.lastActivity;
        const maxInactivity = 5 * 60 * 1000; // 5 minutes
        
        if (timeSinceActivity > maxInactivity) {
          console.warn(`Worker ${worker.id} has been inactive for ${timeSinceActivity}ms`);
          return false;
        }
      }
      
      // Check memory usage
      if (worker.memoryUsage && worker.memoryUsage > 1024 * 1024 * 1024) { // 1GB
        console.warn(`Worker ${worker.id} using excessive memory: ${worker.memoryUsage} bytes`);
        return false;
      }
      
      return true;
    } catch (error) {
      return false;
    }
  }

  async checkGenericWorkerHealth(worker) {
    // Generic health check - just verify worker is registered and responsive
    return worker.status !== 'failed' && worker.status !== 'crashed';
  }

  async handleWorkerFailure(workerId, reason, error = null) {
    const worker = this.workers.get(workerId);
    if (!worker) return;
    
    worker.failureCount++;
    worker.checks.failed++;
    worker.lastFailure = {
      timestamp: Date.now(),
      reason,
      error: error?.message
    };
    
    console.warn(`⚠️  Worker ${workerId} health check failed (${worker.failureCount}/${this.maxFailures}): ${reason}`);
    
    if (worker.failureCount >= this.maxFailures) {
      // Worker has failed too many times
      worker.status = 'failed';
      
      console.error(`❌ Worker ${workerId} marked as failed after ${this.maxFailures} failures`);
      
      this.emit('workerFailed', workerId, {
        reason,
        failureCount: worker.failureCount,
        lastError: error
      });
      
      // Attempt to restart worker
      await this.attemptWorkerRestart(workerId);
      
    } else {
      // Mark as unhealthy but don't restart yet
      worker.status = 'unhealthy';
      
      this.emit('workerUnhealthy', workerId, {
        reason,
        failureCount: worker.failureCount,
        retriesLeft: this.maxFailures - worker.failureCount
      });
    }
  }

  async attemptWorkerRestart(workerId) {
    const worker = this.workers.get(workerId);
    if (!worker) return;
    
    console.log(`🔄 Attempting to restart failed worker: ${workerId}`);
    
    try {
      // Emit restart request
      this.emit('restartWorkerRequested', workerId, worker);
      
      // Wait for restart delay
      await new Promise(resolve => setTimeout(resolve, this.retryDelay));
      
      // Reset failure count after restart attempt
      worker.failureCount = 0;
      worker.status = 'restarting';
      worker.uptime = Date.now();
      
      console.log(`✅ Worker restart initiated: ${workerId}`);
      
    } catch (error) {
      console.error(`Failed to restart worker ${workerId}:`, error);
      
      this.emit('workerRestartFailed', workerId, error);
    }
  }

  updateWorkerActivity(workerId, activityData = {}) {
    const worker = this.workers.get(workerId);
    if (!worker) return;
    
    worker.lastActivity = Date.now();
    
    if (activityData.memoryUsage) {
      worker.memoryUsage = activityData.memoryUsage;
    }
    
    if (activityData.cpuUsage) {
      worker.cpuUsage = activityData.cpuUsage;
    }
    
    if (activityData.jobsProcessed) {
      worker.jobsProcessed = activityData.jobsProcessed;
    }
  }

  getWorkerHealth(workerId) {
    const worker = this.workers.get(workerId);
    if (!worker) return null;
    
    return {
      id: workerId,
      status: worker.status,
      uptime: Date.now() - worker.uptime,
      lastCheck: worker.lastCheck,
      lastResponse: worker.lastResponse,
      responseTime: worker.responseTime,
      failureCount: worker.failureCount,
      checks: { ...worker.checks },
      lastFailure: worker.lastFailure
    };
  }

  getHealthSummary() {
    const workers = Array.from(this.workers.values());
    
    const summary = {
      timestamp: Date.now(),
      totalWorkers: workers.length,
      healthy: workers.filter(w => w.status === 'healthy').length,
      unhealthy: workers.filter(w => w.status === 'unhealthy').length,
      failed: workers.filter(w => w.status === 'failed').length,
      restarting: workers.filter(w => w.status === 'restarting').length,
      
      averageResponseTime: 0,
      totalChecks: 0,
      successfulChecks: 0,
      failedChecks: 0
    };
    
    if (workers.length > 0) {
      summary.averageResponseTime = workers.reduce((sum, w) => sum + (w.responseTime || 0), 0) / workers.length;
      summary.totalChecks = workers.reduce((sum, w) => sum + w.checks.total, 0);
      summary.successfulChecks = workers.reduce((sum, w) => sum + w.checks.successful, 0);
      summary.failedChecks = workers.reduce((sum, w) => sum + w.checks.failed, 0);
    }
    
    // Overall health status
    if (summary.failed > 0) {
      summary.overallStatus = 'critical';
    } else if (summary.unhealthy > 0) {
      summary.overallStatus = 'warning';
    } else if (summary.healthy === summary.totalWorkers && summary.totalWorkers > 0) {
      summary.overallStatus = 'healthy';
    } else {
      summary.overallStatus = 'unknown';
    }
    
    return summary;
  }

  getAllWorkerHealth() {
    const health = {};
    
    for (const workerId of this.workers.keys()) {
      health[workerId] = this.getWorkerHealth(workerId);
    }
    
    return health;
  }

  // Manual health check trigger
  async checkWorker(workerId) {
    if (!this.workers.has(workerId)) {
      throw new Error(`Worker ${workerId} not registered`);
    }
    
    console.log(`🔍 Manual health check for worker: ${workerId}`);
    await this.checkWorkerHealth(workerId);
    
    return this.getWorkerHealth(workerId);
  }

  // Force worker restart
  async forceRestartWorker(workerId) {
    const worker = this.workers.get(workerId);
    if (!worker) {
      throw new Error(`Worker ${workerId} not found`);
    }
    
    console.log(`🔄 Force restarting worker: ${workerId}`);
    
    worker.status = 'restarting';
    worker.failureCount = 0;
    
    this.emit('restartWorkerRequested', workerId, worker);
    
    return { success: true, message: `Restart initiated for worker ${workerId}` };
  }
}

export default HealthCheckService;