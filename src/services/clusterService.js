import ClusterManager from './clusterManager.js';
import LoadBalancer from './loadBalancer.js';
import priorityQueueManager from './priorityQueueManager.js';
import logService from './logService.js';

/**
 * ClusterService - Main service for managing the scalable PDF processing cluster
 * Requirements: 1.1, 1.2, 1.3, 5.1, 5.2, 5.3, 5.4, 5.5
 */
class ClusterService {
  constructor() {
    this.clusterManager = null;
    this.loadBalancer = null;
    this.isInitialized = false;
    this.monitoringInterval = null;
    
    // Configuration
    this.config = {
      minWorkers: 5,
      maxWorkers: 15,
      scaleUpThreshold: 10,
      scaleDownThreshold: 3,
      healthCheckInterval: 30000, // 30 seconds
      scaleCheckInterval: 15000,  // 15 seconds
      monitoringInterval: 60000   // 1 minute
    };
  }

  /**
   * Initialize the cluster service
   * Requirements: 1.1, 5.1
   */
  async initialize(options = {}) {
    try {
      if (this.isInitialized) {
        logService.log('[CLUSTER_SERVICE] Already initialized');
        return;
      }

      // Merge configuration
      this.config = { ...this.config, ...options };

      logService.log('[CLUSTER_SERVICE] Initializing cluster service...', this.config);

      // Initialize cluster manager
      this.clusterManager = new ClusterManager(this.config);
      
      // Initialize load balancer
      this.loadBalancer = new LoadBalancer(this.clusterManager);

      // Start cluster manager
      await this.clusterManager.start();

      // Start monitoring
      this.startMonitoring();

      this.isInitialized = true;
      
      logService.log('[CLUSTER_SERVICE] Cluster service initialized successfully');

    } catch (error) {
      logService.error('[CLUSTER_SERVICE] Failed to initialize cluster service:', error);
      throw error;
    }
  }

  /**
   * Shutdown the cluster service
   * Requirements: 5.5
   */
  async shutdown() {
    try {
      if (!this.isInitialized) {
        return;
      }

      logService.log('[CLUSTER_SERVICE] Shutting down cluster service...');

      // Stop monitoring
      if (this.monitoringInterval) {
        clearInterval(this.monitoringInterval);
        this.monitoringInterval = null;
      }

      // Stop cluster manager
      if (this.clusterManager) {
        await this.clusterManager.stop();
      }

      this.isInitialized = false;
      
      logService.log('[CLUSTER_SERVICE] Cluster service shut down successfully');

    } catch (error) {
      logService.error('[CLUSTER_SERVICE] Error shutting down cluster service:', error);
    }
  }

  /**
   * Add a job to the cluster with intelligent worker selection
   * Requirements: 1.1, 5.3
   */
  async addJob(jobData, userId, fileSize) {
    try {
      if (!this.isInitialized) {
        throw new Error('Cluster service not initialized');
      }

      // Add job to priority queue (existing functionality)
      const job = await priorityQueueManager.addJobByUserId(jobData, userId, fileSize);

      logService.log('[CLUSTER_SERVICE] Job added to cluster', {
        jobId: job.id,
        userId,
        fileSize,
        queueName: job.data.queueName
      });

      return job;

    } catch (error) {
      logService.error('[CLUSTER_SERVICE] Failed to add job to cluster:', error);
      throw error;
    }
  }

  /**
   * Get comprehensive cluster status
   * Requirements: 7.1, 7.2
   */
  async getClusterStatus() {
    try {
      if (!this.isInitialized) {
        return { status: 'not_initialized' };
      }

      const [clusterStats, loadBalancerStats, queueStats] = await Promise.all([
        this.clusterManager.getClusterStats(),
        Promise.resolve(this.loadBalancer.getLoadBalancerStats()),
        priorityQueueManager.getQueueStats()
      ]);

      return {
        status: 'running',
        timestamp: Date.now(),
        cluster: clusterStats,
        loadBalancer: loadBalancerStats,
        queues: queueStats,
        config: this.config
      };

    } catch (error) {
      logService.error('[CLUSTER_SERVICE] Failed to get cluster status:', error);
      return { status: 'error', error: error.message };
    }
  }

  /**
   * Get cluster health information
   * Requirements: 1.3, 7.1
   */
  getClusterHealth() {
    if (!this.isInitialized || !this.clusterManager) {
      return { status: 'not_initialized', healthy: false };
    }

    return this.clusterManager.getClusterHealth();
  }

  /**
   * Manually trigger cluster scaling
   * Requirements: 5.1, 5.2
   */
  async scaleCluster(targetWorkers) {
    try {
      if (!this.isInitialized) {
        throw new Error('Cluster service not initialized');
      }

      if (targetWorkers < this.config.minWorkers || targetWorkers > this.config.maxWorkers) {
        throw new Error(`Target workers must be between ${this.config.minWorkers} and ${this.config.maxWorkers}`);
      }

      logService.log('[CLUSTER_SERVICE] Manual scaling requested', { targetWorkers });

      await this.clusterManager.scaleToTarget(targetWorkers);

      logService.log('[CLUSTER_SERVICE] Manual scaling completed', { targetWorkers });

    } catch (error) {
      logService.error('[CLUSTER_SERVICE] Failed to scale cluster:', error);
      throw error;
    }
  }

  /**
   * Start monitoring and automatic optimization
   * Requirements: 5.4, 7.1, 7.2
   */
  startMonitoring() {
    this.monitoringInterval = setInterval(async () => {
      try {
        await this.performMonitoringCycle();
      } catch (error) {
        logService.error('[CLUSTER_SERVICE] Monitoring cycle failed:', error);
      }
    }, this.config.monitoringInterval);

    logService.log('[CLUSTER_SERVICE] Monitoring started');
  }

  /**
   * Perform a monitoring cycle
   * Requirements: 5.4, 6.1, 7.1
   */
  async performMonitoringCycle() {
    try {
      // Get load balancer recommendations
      const loadRecommendation = await this.loadBalancer.detectAndRedistributeLoad();

      // Act on recommendations
      if (loadRecommendation.action === 'scale_up') {
        const currentWorkers = this.clusterManager.workers.size;
        const targetWorkers = Math.min(
          this.config.maxWorkers,
          currentWorkers + loadRecommendation.count
        );
        
        if (targetWorkers > currentWorkers) {
          logService.log('[CLUSTER_SERVICE] Auto-scaling up based on load balancer recommendation', {
            currentWorkers,
            targetWorkers,
            reason: loadRecommendation.reason
          });
          
          await this.clusterManager.scaleToTarget(targetWorkers);
        }
      } else if (loadRecommendation.action === 'scale_down') {
        const currentWorkers = this.clusterManager.workers.size;
        const targetWorkers = Math.max(
          this.config.minWorkers,
          currentWorkers - loadRecommendation.count
        );
        
        if (targetWorkers < currentWorkers) {
          logService.log('[CLUSTER_SERVICE] Auto-scaling down based on load balancer recommendation', {
            currentWorkers,
            targetWorkers,
            reason: loadRecommendation.reason
          });
          
          await this.clusterManager.scaleToTarget(targetWorkers);
        }
      }

      // Log monitoring summary
      const health = this.getClusterHealth();
      logService.log('[CLUSTER_SERVICE] Monitoring cycle completed', {
        totalWorkers: health.totalWorkers,
        activeWorkers: health.activeWorkers,
        errorWorkers: health.errorWorkers,
        isHealthy: health.isHealthy,
        recommendation: loadRecommendation.action
      });

    } catch (error) {
      logService.error('[CLUSTER_SERVICE] Monitoring cycle error:', error);
    }
  }

  /**
   * Handle worker failure
   * Requirements: 6.1, 6.2, 6.3
   */
  async handleWorkerFailure(workerId) {
    try {
      if (!this.isInitialized) {
        return;
      }

      logService.log('[CLUSTER_SERVICE] Handling worker failure', { workerId });

      // Let load balancer handle the failure
      await this.loadBalancer.handleWorkerFailure(workerId);

      // Cluster manager will handle replacement through health checks

    } catch (error) {
      logService.error('[CLUSTER_SERVICE] Failed to handle worker failure:', error);
    }
  }

  /**
   * Get worker metrics for monitoring
   * Requirements: 7.1, 7.2
   */
  getWorkerMetrics() {
    if (!this.isInitialized || !this.clusterManager) {
      return [];
    }

    return this.clusterManager.getWorkerMetrics();
  }

  /**
   * Update cluster configuration
   * Requirements: 5.1, 5.2
   */
  async updateConfiguration(newConfig) {
    try {
      logService.log('[CLUSTER_SERVICE] Updating configuration', newConfig);

      // Validate configuration
      if (newConfig.minWorkers && newConfig.maxWorkers && newConfig.minWorkers > newConfig.maxWorkers) {
        throw new Error('minWorkers cannot be greater than maxWorkers');
      }

      // Update configuration
      this.config = { ...this.config, ...newConfig };

      // Apply configuration to cluster manager if initialized
      if (this.isInitialized && this.clusterManager) {
        this.clusterManager.minWorkers = this.config.minWorkers;
        this.clusterManager.maxWorkers = this.config.maxWorkers;
        this.clusterManager.scaleUpThreshold = this.config.scaleUpThreshold;
        this.clusterManager.scaleDownThreshold = this.config.scaleDownThreshold;
      }

      logService.log('[CLUSTER_SERVICE] Configuration updated successfully');

    } catch (error) {
      logService.error('[CLUSTER_SERVICE] Failed to update configuration:', error);
      throw error;
    }
  }

  /**
   * Force cleanup of stale jobs and workers
   * Requirements: 6.2, 6.3
   */
  async forceCleanup() {
    try {
      if (!this.isInitialized) {
        return;
      }

      logService.log('[CLUSTER_SERVICE] Performing force cleanup...');

      // Perform health checks to identify and replace failed workers
      await this.clusterManager.performHealthChecks();

      // Clean up old jobs in queues
      await priorityQueueManager.cleanup();

      logService.log('[CLUSTER_SERVICE] Force cleanup completed');

    } catch (error) {
      logService.error('[CLUSTER_SERVICE] Force cleanup failed:', error);
    }
  }
}

// Create singleton instance
const clusterService = new ClusterService();

export default clusterService;