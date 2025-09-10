import logService from './logService.js';

/**
 * LoadBalancer - Intelligent job distribution among workers
 * Requirements: 5.1, 5.2, 5.3, 6.1, 6.2, 6.3
 */
class LoadBalancer {
  constructor(clusterManager) {
    this.clusterManager = clusterManager;
    this.distributionAlgorithm = 'weighted-round-robin'; // Default algorithm
    this.lastWorkerIndex = new Map(); // Track last used worker per queue
    
    logService.log('[LOAD_BALANCER] Initialized with algorithm:', this.distributionAlgorithm);
  }

  /**
   * Select the best worker for a job based on current metrics
   * Requirements: 5.1, 5.2, 5.3
   */
  async selectWorker(queueName, jobData = {}) {
    try {
      const workerMetrics = this.clusterManager.getWorkerMetrics();
      const availableWorkers = workerMetrics.filter(worker => 
        worker.queueName === queueName && 
        (worker.status === 'idle' || worker.status === 'processing')
      );

      if (availableWorkers.length === 0) {
        logService.warn('[LOAD_BALANCER] No available workers for queue:', queueName);
        return null;
      }

      let selectedWorker;

      switch (this.distributionAlgorithm) {
        case 'weighted-round-robin':
          selectedWorker = this.selectByWeightedRoundRobin(availableWorkers, queueName);
          break;
        case 'least-loaded':
          selectedWorker = this.selectByLeastLoaded(availableWorkers);
          break;
        case 'fastest-response':
          selectedWorker = this.selectByFastestResponse(availableWorkers);
          break;
        default:
          selectedWorker = this.selectByRoundRobin(availableWorkers, queueName);
      }

      logService.log('[LOAD_BALANCER] Worker selected', {
        workerId: selectedWorker.workerId,
        queueName,
        algorithm: this.distributionAlgorithm,
        workerStatus: selectedWorker.status,
        currentJobs: selectedWorker.currentJob ? 1 : 0
      });

      return selectedWorker;

    } catch (error) {
      logService.error('[LOAD_BALANCER] Error selecting worker:', error);
      return null;
    }
  }

  /**
   * Weighted Round Robin selection based on worker performance
   * Requirements: 5.2, 5.3
   */
  selectByWeightedRoundRobin(workers, queueName) {
    // Calculate weights based on worker performance
    const weightedWorkers = workers.map(worker => {
      let weight = 100; // Base weight

      // Reduce weight for workers with current jobs
      if (worker.currentJob) {
        weight -= 30;
      }

      // Reduce weight based on average processing time
      if (worker.avgProcessingTime > 0) {
        const avgTimeSeconds = worker.avgProcessingTime / 1000;
        weight -= Math.min(40, avgTimeSeconds * 2); // Penalize slow workers
      }

      // Reduce weight for workers with recent errors
      if (worker.lastErrorAt && (Date.now() - worker.lastErrorAt < 300000)) { // 5 minutes
        weight -= 50; // Increased penalty for recent errors
      }

      // Boost weight for idle workers
      if (worker.status === 'idle') {
        weight += 20;
      }

      return {
        worker: worker,
        weight: Math.max(1, weight) // Minimum weight of 1
      };
    });

    // Sort by weight (highest first)
    weightedWorkers.sort((a, b) => b.weight - a.weight);

    // Use round-robin among top-weighted workers
    const topWorkers = weightedWorkers.filter(w => w.weight >= weightedWorkers[0].weight * 0.8);
    
    const lastIndex = this.lastWorkerIndex.get(queueName) || 0;
    const nextIndex = (lastIndex + 1) % topWorkers.length;
    this.lastWorkerIndex.set(queueName, nextIndex);

    // Return the original worker object without the weight property
    return topWorkers[nextIndex].worker;
  }

  /**
   * Select worker with least current load
   * Requirements: 5.2
   */
  selectByLeastLoaded(workers) {
    return workers.reduce((least, current) => {
      const leastLoad = least.currentJob ? 1 : 0;
      const currentLoad = current.currentJob ? 1 : 0;
      
      if (currentLoad < leastLoad) {
        return current;
      }
      
      if (currentLoad === leastLoad) {
        // If same load, prefer worker with better performance
        const leastAvgTime = least.avgProcessingTime || Infinity;
        const currentAvgTime = current.avgProcessingTime || Infinity;
        return currentAvgTime < leastAvgTime ? current : least;
      }
      
      return least;
    });
  }

  /**
   * Select worker with fastest average response time
   * Requirements: 5.3
   */
  selectByFastestResponse(workers) {
    // Filter out workers that are currently processing
    const idleWorkers = workers.filter(w => w.status === 'idle');
    
    if (idleWorkers.length > 0) {
      return idleWorkers.reduce((fastest, current) => {
        const fastestTime = fastest.avgProcessingTime || Infinity;
        const currentTime = current.avgProcessingTime || Infinity;
        return currentTime < fastestTime ? current : fastest;
      });
    }

    // If no idle workers, return least loaded
    return this.selectByLeastLoaded(workers);
  }

  /**
   * Simple round-robin selection
   */
  selectByRoundRobin(workers, queueName) {
    const lastIndex = this.lastWorkerIndex.get(queueName) || 0;
    const nextIndex = (lastIndex + 1) % workers.length;
    this.lastWorkerIndex.set(queueName, nextIndex);
    
    return workers[nextIndex];
  }

  /**
   * Detect overloaded workers and redistribute load
   * Requirements: 6.1, 6.2
   */
  async detectAndRedistributeLoad() {
    try {
      const workerMetrics = this.clusterManager.getWorkerMetrics();
      const overloadedWorkers = [];
      const underloadedWorkers = [];

      // Analyze worker load
      for (const worker of workerMetrics) {
        const isOverloaded = this.isWorkerOverloaded(worker);
        const isUnderloaded = this.isWorkerUnderloaded(worker);

        if (isOverloaded) {
          overloadedWorkers.push(worker);
        } else if (isUnderloaded) {
          underloadedWorkers.push(worker);
        }
      }

      // Log load distribution status
      if (overloadedWorkers.length > 0 || underloadedWorkers.length > 0) {
        logService.log('[LOAD_BALANCER] Load distribution analysis', {
          overloadedWorkers: overloadedWorkers.length,
          underloadedWorkers: underloadedWorkers.length,
          totalWorkers: workerMetrics.length
        });
      }

      // Recommend scaling actions to cluster manager
      if (overloadedWorkers.length > underloadedWorkers.length) {
        logService.log('[LOAD_BALANCER] Recommending scale up due to overloaded workers');
        return { action: 'scale_up', reason: 'overloaded_workers', count: overloadedWorkers.length };
      }

      if (underloadedWorkers.length > 2 && overloadedWorkers.length === 0) {
        logService.log('[LOAD_BALANCER] Recommending scale down due to underloaded workers');
        return { action: 'scale_down', reason: 'underloaded_workers', count: Math.floor(underloadedWorkers.length / 2) };
      }

      return { action: 'maintain', reason: 'balanced_load' };

    } catch (error) {
      logService.error('[LOAD_BALANCER] Error in load redistribution:', error);
      return { action: 'maintain', reason: 'error' };
    }
  }

  /**
   * Check if a worker is overloaded
   * Requirements: 6.1
   */
  isWorkerOverloaded(worker) {
    // Worker is overloaded if:
    // 1. Has a job running for more than 2 minutes
    // 2. Average processing time is more than 60 seconds
    // 3. Has recent errors
    
    const now = Date.now();
    const twoMinutes = 2 * 60 * 1000;
    const oneMinute = 60 * 1000;

    // Check for long-running job
    if (worker.currentJob && worker.lastHeartbeat && (now - worker.lastHeartbeat > twoMinutes)) {
      return true;
    }

    // Check average processing time
    if (worker.avgProcessingTime > oneMinute) {
      return true;
    }

    // Check for recent errors
    if (worker.lastErrorAt && (now - worker.lastErrorAt < 300000)) { // 5 minutes
      return true;
    }

    return false;
  }

  /**
   * Check if a worker is underloaded
   * Requirements: 5.2
   */
  isWorkerUnderloaded(worker) {
    // Worker is underloaded if:
    // 1. Has been idle for more than 5 minutes
    // 2. Has very fast processing times
    // 3. No recent activity

    const now = Date.now();
    const fiveMinutes = 5 * 60 * 1000;

    // Check if idle for too long
    if (worker.status === 'idle' && 
        worker.lastCompletedAt && 
        (now - worker.lastCompletedAt > fiveMinutes) &&
        worker.jobsCompleted < 3) { // And hasn't done much work
      return true;
    }

    return false;
  }

  /**
   * Get load balancer statistics
   * Requirements: 7.1, 7.2
   */
  getLoadBalancerStats() {
    const workerMetrics = this.clusterManager.getWorkerMetrics();
    
    const stats = {
      algorithm: this.distributionAlgorithm,
      totalWorkers: workerMetrics.length,
      idleWorkers: workerMetrics.filter(w => w.status === 'idle').length,
      processingWorkers: workerMetrics.filter(w => w.status === 'processing').length,
      errorWorkers: workerMetrics.filter(w => w.status === 'error').length,
      overloadedWorkers: workerMetrics.filter(w => this.isWorkerOverloaded(w)).length,
      underloadedWorkers: workerMetrics.filter(w => this.isWorkerUnderloaded(w)).length,
      avgProcessingTime: this.calculateAverageProcessingTime(workerMetrics),
      lastDistributionCheck: Date.now()
    };

    return stats;
  }

  /**
   * Calculate average processing time across all workers
   */
  calculateAverageProcessingTime(workerMetrics) {
    const workersWithTimes = workerMetrics.filter(w => w.avgProcessingTime > 0);
    
    if (workersWithTimes.length === 0) {
      return 0;
    }

    const totalTime = workersWithTimes.reduce((sum, w) => sum + w.avgProcessingTime, 0);
    return totalTime / workersWithTimes.length;
  }

  /**
   * Set distribution algorithm
   * Requirements: 5.3
   */
  setDistributionAlgorithm(algorithm) {
    const validAlgorithms = ['weighted-round-robin', 'least-loaded', 'fastest-response', 'round-robin'];
    
    if (validAlgorithms.includes(algorithm)) {
      this.distributionAlgorithm = algorithm;
      logService.log('[LOAD_BALANCER] Distribution algorithm changed to:', algorithm);
    } else {
      logService.warn('[LOAD_BALANCER] Invalid algorithm specified:', algorithm);
    }
  }

  /**
   * Handle worker failure by redistributing its load
   * Requirements: 6.1, 6.2, 6.3
   */
  async handleWorkerFailure(failedWorkerId) {
    try {
      logService.log('[LOAD_BALANCER] Handling worker failure', { failedWorkerId });

      // Get the failed worker's queue
      const failedWorker = this.clusterManager.workerMetrics.get(failedWorkerId);
      if (!failedWorker) {
        logService.warn('[LOAD_BALANCER] Failed worker not found in metrics');
        return;
      }

      const queueName = failedWorker.queueName;

      // Check if we need to create a replacement worker
      const remainingWorkers = this.clusterManager.getWorkerMetrics()
        .filter(w => w.queueName === queueName && w.workerId !== failedWorkerId);

      if (remainingWorkers.length === 0) {
        logService.log('[LOAD_BALANCER] No remaining workers for queue, requesting replacement');
        await this.clusterManager.createWorker(queueName);
      }

      // Reset round-robin index for this queue
      this.lastWorkerIndex.delete(queueName);

      logService.log('[LOAD_BALANCER] Worker failure handled', { 
        failedWorkerId, 
        queueName, 
        remainingWorkers: remainingWorkers.length 
      });

    } catch (error) {
      logService.error('[LOAD_BALANCER] Error handling worker failure:', error);
    }
  }
}

export default LoadBalancer;