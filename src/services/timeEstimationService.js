import logService from './logService.js';

class TimeEstimationService {
  constructor() {
    this.historicalData = new Map(); // fileSize range -> processing times
    this.queueMetrics = new Map(); // queue -> current metrics
    this.workerPerformance = new Map(); // workerId -> performance metrics
    this.systemLoad = {
      cpu: 0,
      memory: 0,
      activeJobs: 0
    };
  }

  /**
   * Record processing time for a completed job
   * @param {Object} jobData - Job completion data
   */
  recordProcessingTime(jobData) {
    const { fileSize, processingTime, queue, workerId, success } = jobData;
    
    if (!success) return; // Only record successful jobs
    
    // Categorize file size
    const sizeCategory = this.getFileSizeCategory(fileSize);
    
    if (!this.historicalData.has(sizeCategory)) {
      this.historicalData.set(sizeCategory, []);
    }
    
    const categoryData = this.historicalData.get(sizeCategory);
    categoryData.push({
      processingTime,
      timestamp: Date.now(),
      queue,
      workerId,
      fileSize
    });
    
    // Keep only last 100 records per category
    if (categoryData.length > 100) {
      categoryData.splice(0, categoryData.length - 100);
    }
    
    // Update worker performance
    this.updateWorkerPerformance(workerId, processingTime, fileSize);
    
    logService.debug(`Recorded processing time: ${processingTime}ms for file size ${fileSize} bytes`);
  }

  /**
   * Estimate processing time for a new job
   * @param {Object} jobParams - Job parameters
   * @returns {Object} Time estimation with confidence
   */
  estimateProcessingTime(jobParams) {
    const { fileSize, priority, currentQueueLength = 0 } = jobParams;
    
    const sizeCategory = this.getFileSizeCategory(fileSize);
    const baseEstimate = this.getBaseProcessingTime(sizeCategory, fileSize);
    const queueWaitTime = this.calculateQueueWaitTime(priority, currentQueueLength);
    const systemLoadFactor = this.getSystemLoadFactor();
    
    // Apply priority multiplier
    const priorityMultiplier = this.getPriorityMultiplier(priority);
    
    const adjustedProcessingTime = baseEstimate * priorityMultiplier * systemLoadFactor;
    const totalEstimatedTime = queueWaitTime + adjustedProcessingTime;
    
    const confidence = this.calculateConfidence(sizeCategory);
    
    return {
      estimatedTime: Math.round(totalEstimatedTime),
      queueWaitTime: Math.round(queueWaitTime),
      processingTime: Math.round(adjustedProcessingTime),
      confidence,
      factors: {
        baseTime: baseEstimate,
        priorityMultiplier,
        systemLoadFactor,
        queueLength: currentQueueLength
      }
    };
  }

  /**
   * Get file size category for historical data lookup
   * @param {number} fileSize - File size in bytes
   * @returns {string} Size category
   */
  getFileSizeCategory(fileSize) {
    const sizeMB = fileSize / (1024 * 1024);
    
    if (sizeMB < 1) return 'small';
    if (sizeMB < 5) return 'medium';
    if (sizeMB < 20) return 'large';
    if (sizeMB < 50) return 'xlarge';
    return 'xxlarge';
  }

  /**
   * Get base processing time from historical data
   * @param {string} sizeCategory - File size category
   * @param {number} fileSize - Actual file size
   * @returns {number} Base processing time in seconds
   */
  getBaseProcessingTime(sizeCategory, fileSize) {
    const historicalTimes = this.historicalData.get(sizeCategory);
    
    if (!historicalTimes || historicalTimes.length === 0) {
      // Fallback to size-based estimation
      return this.getFallbackEstimate(fileSize);
    }
    
    // Use recent data (last 30 days)
    const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
    const recentTimes = historicalTimes.filter(record => record.timestamp > thirtyDaysAgo);
    
    if (recentTimes.length === 0) {
      return this.getFallbackEstimate(fileSize);
    }
    
    // Calculate weighted average (more recent = higher weight)
    const now = Date.now();
    let weightedSum = 0;
    let totalWeight = 0;
    
    recentTimes.forEach(record => {
      const age = now - record.timestamp;
      const weight = Math.exp(-age / (7 * 24 * 60 * 60 * 1000)); // Exponential decay over 7 days
      weightedSum += (record.processingTime / 1000) * weight; // Convert to seconds
      totalWeight += weight;
    });
    
    return totalWeight > 0 ? weightedSum / totalWeight : this.getFallbackEstimate(fileSize);
  }

  /**
   * Get fallback estimate when no historical data is available
   * @param {number} fileSize - File size in bytes
   * @returns {number} Estimated time in seconds
   */
  getFallbackEstimate(fileSize) {
    const sizeMB = fileSize / (1024 * 1024);
    
    // Base estimates per MB for different size ranges
    if (sizeMB < 1) return 10; // Small files: 10 seconds
    if (sizeMB < 5) return 5 + (sizeMB * 3); // Medium files: 5-20 seconds
    if (sizeMB < 20) return 20 + (sizeMB * 2); // Large files: 20-60 seconds
    if (sizeMB < 50) return 60 + (sizeMB * 1.5); // XLarge files: 60-135 seconds
    
    return 135 + (sizeMB * 1); // XXLarge files: 135+ seconds
  }

  /**
   * Calculate queue wait time based on current queue state
   * @param {string} priority - Job priority
   * @param {number} queueLength - Current queue length
   * @returns {number} Estimated wait time in seconds
   */
  calculateQueueWaitTime(priority, queueLength) {
    if (queueLength === 0) return 0;
    
    // Get average processing time for this priority
    const avgProcessingTime = this.getAverageProcessingTimeByPriority(priority);
    
    // Estimate based on queue position and processing capacity
    const estimatedPosition = this.getEstimatedQueuePosition(priority, queueLength);
    const processingCapacity = this.getCurrentProcessingCapacity();
    
    return (estimatedPosition / processingCapacity) * avgProcessingTime;
  }

  /**
   * Get priority multiplier for processing time
   * @param {string} priority - Job priority
   * @returns {number} Multiplier factor
   */
  getPriorityMultiplier(priority) {
    const multipliers = {
      'unlimited': 0.4,  // 60% faster
      'premium': 0.6,    // 40% faster
      'normal': 1.0,     // Normal speed
      'large': 1.3       // 30% slower (resource intensive)
    };
    
    return multipliers[priority] || 1.0;
  }

  /**
   * Get system load factor that affects processing time
   * @returns {number} Load factor (1.0 = normal, >1.0 = slower)
   */
  getSystemLoadFactor() {
    const { cpu, memory, activeJobs } = this.systemLoad;
    
    // Calculate load factor based on system metrics
    let loadFactor = 1.0;
    
    // CPU load impact
    if (cpu > 80) loadFactor *= 1.5;
    else if (cpu > 60) loadFactor *= 1.2;
    
    // Memory load impact
    if (memory > 85) loadFactor *= 1.4;
    else if (memory > 70) loadFactor *= 1.1;
    
    // Active jobs impact
    if (activeJobs > 10) loadFactor *= 1.3;
    else if (activeJobs > 5) loadFactor *= 1.1;
    
    return Math.min(loadFactor, 2.0); // Cap at 2x slower
  }

  /**
   * Calculate confidence level for the estimate
   * @param {string} sizeCategory - File size category
   * @returns {number} Confidence percentage (0-100)
   */
  calculateConfidence(sizeCategory) {
    const historicalTimes = this.historicalData.get(sizeCategory);
    
    if (!historicalTimes || historicalTimes.length === 0) {
      return 30; // Low confidence without historical data
    }
    
    const recentCount = historicalTimes.filter(
      record => record.timestamp > Date.now() - (7 * 24 * 60 * 60 * 1000)
    ).length;
    
    // Confidence based on amount of recent data
    if (recentCount >= 20) return 90;
    if (recentCount >= 10) return 75;
    if (recentCount >= 5) return 60;
    if (recentCount >= 2) return 45;
    
    return 30;
  }

  /**
   * Update system load metrics
   * @param {Object} loadMetrics - Current system load
   */
  updateSystemLoad(loadMetrics) {
    this.systemLoad = {
      ...this.systemLoad,
      ...loadMetrics,
      lastUpdate: Date.now()
    };
  }

  /**
   * Update worker performance metrics
   * @param {string} workerId - Worker ID
   * @param {number} processingTime - Processing time in ms
   * @param {number} fileSize - File size in bytes
   */
  updateWorkerPerformance(workerId, processingTime, fileSize) {
    if (!this.workerPerformance.has(workerId)) {
      this.workerPerformance.set(workerId, {
        totalJobs: 0,
        totalTime: 0,
        averageTime: 0,
        lastUpdate: Date.now()
      });
    }
    
    const performance = this.workerPerformance.get(workerId);
    performance.totalJobs++;
    performance.totalTime += processingTime;
    performance.averageTime = performance.totalTime / performance.totalJobs;
    performance.lastUpdate = Date.now();
  }

  /**
   * Get average processing time by priority
   * @param {string} priority - Job priority
   * @returns {number} Average time in seconds
   */
  getAverageProcessingTimeByPriority(priority) {
    let totalTime = 0;
    let count = 0;
    
    for (const [category, records] of this.historicalData) {
      const priorityRecords = records.filter(r => r.queue === priority);
      priorityRecords.forEach(record => {
        totalTime += record.processingTime / 1000; // Convert to seconds
        count++;
      });
    }
    
    return count > 0 ? totalTime / count : 30; // Default 30 seconds
  }

  /**
   * Get estimated queue position based on priority
   * @param {string} priority - Job priority
   * @param {number} totalQueueLength - Total queue length
   * @returns {number} Estimated position
   */
  getEstimatedQueuePosition(priority, totalQueueLength) {
    const priorityWeights = {
      'unlimited': 0.1,  // Jump to front
      'premium': 0.3,    // Near front
      'normal': 0.7,     // Normal position
      'large': 1.0       // Back of queue
    };
    
    const weight = priorityWeights[priority] || 0.7;
    return Math.ceil(totalQueueLength * weight);
  }

  /**
   * Get current processing capacity (workers available)
   * @returns {number} Processing capacity
   */
  getCurrentProcessingCapacity() {
    // This would be updated by the cluster manager
    return Math.max(1, this.workerPerformance.size || 5);
  }

  /**
   * Get estimation statistics for monitoring
   * @returns {Object} Statistics
   */
  getEstimationStatistics() {
    const stats = {
      totalHistoricalRecords: 0,
      categoryCounts: {},
      averageAccuracy: 0,
      systemLoad: this.systemLoad,
      activeWorkers: this.workerPerformance.size
    };
    
    for (const [category, records] of this.historicalData) {
      stats.totalHistoricalRecords += records.length;
      stats.categoryCounts[category] = records.length;
    }
    
    return stats;
  }

  /**
   * Clear old historical data to prevent memory issues
   */
  cleanupOldData() {
    const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
    
    for (const [category, records] of this.historicalData) {
      const filteredRecords = records.filter(record => record.timestamp > thirtyDaysAgo);
      this.historicalData.set(category, filteredRecords);
    }
    
    // Clean up inactive workers (no activity in last hour)
    const oneHourAgo = Date.now() - (60 * 60 * 1000);
    for (const [workerId, performance] of this.workerPerformance) {
      if (performance.lastUpdate < oneHourAgo) {
        this.workerPerformance.delete(workerId);
      }
    }
    
    logService.debug('Cleaned up old estimation data');
  }
}

// Export singleton instance
const timeEstimationService = new TimeEstimationService();

// Clean up old data every hour
setInterval(() => {
  timeEstimationService.cleanupOldData();
}, 60 * 60 * 1000);

export default timeEstimationService;