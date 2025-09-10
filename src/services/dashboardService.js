import webSocketManager from './websocketManager.js';
import timeEstimationService from './timeEstimationService.js';
import logService from './logService.js';

class DashboardService {
  constructor() {
    this.metricsHistory = [];
    this.alerts = [];
    this.thresholds = {
      queueLength: 50,
      processingTime: 120, // 2 minutes
      errorRate: 0.1, // 10%
      memoryUsage: 0.85, // 85%
      cpuUsage: 0.8, // 80%
      responseTime: 30 // 30 seconds
    };
    this.isCollecting = false;
  }

  /**
   * Start dashboard metrics collection
   */
  startMetricsCollection() {
    if (this.isCollecting) return;
    
    this.isCollecting = true;
    
    // Collect metrics every 30 seconds
    this.metricsInterval = setInterval(() => {
      this.collectAndStoreMetrics();
    }, 30000);
    
    // Generate alerts every minute
    this.alertsInterval = setInterval(() => {
      this.checkAndGenerateAlerts();
    }, 60000);
    
    // Clean up old data every hour
    this.cleanupInterval = setInterval(() => {
      this.cleanupOldData();
    }, 3600000);
    
    logService.info('Dashboard metrics collection started');
  }

  /**
   * Stop dashboard metrics collection
   */
  stopMetricsCollection() {
    if (!this.isCollecting) return;
    
    this.isCollecting = false;
    
    if (this.metricsInterval) clearInterval(this.metricsInterval);
    if (this.alertsInterval) clearInterval(this.alertsInterval);
    if (this.cleanupInterval) clearInterval(this.cleanupInterval);
    
    logService.info('Dashboard metrics collection stopped');
  }

  /**
   * Collect current system metrics
   * @returns {Object} Current metrics snapshot
   */
  async collectCurrentMetrics() {
    const timestamp = new Date().toISOString();
    const adminMetrics = webSocketManager.getAdminMetrics();
    const estimationStats = timeEstimationService.getEstimationStatistics();
    
    // Get system metrics (would be enhanced with actual system monitoring)
    const systemMetrics = await this.getSystemMetrics();
    
    return {
      timestamp,
      queues: adminMetrics.queues,
      workers: adminMetrics.workers,
      performance: {
        ...adminMetrics.performance,
        estimationAccuracy: estimationStats.averageAccuracy
      },
      system: {
        ...adminMetrics.system,
        ...systemMetrics
      },
      estimation: estimationStats,
      alerts: this.getActiveAlerts()
    };
  }

  /**
   * Collect and store metrics for historical analysis
   */
  async collectAndStoreMetrics() {
    try {
      const metrics = await this.collectCurrentMetrics();
      
      this.metricsHistory.push(metrics);
      
      // Keep only last 24 hours of data (2880 entries at 30-second intervals)
      if (this.metricsHistory.length > 2880) {
        this.metricsHistory = this.metricsHistory.slice(-2880);
      }
      
      // Broadcast to connected admins
      webSocketManager.getIO()?.emit('dashboard-metrics-update', metrics);
      
    } catch (error) {
      logService.error('Error collecting dashboard metrics:', error);
    }
  }

  /**
   * Get system metrics (CPU, memory, etc.)
   * @returns {Object} System metrics
   */
  async getSystemMetrics() {
    try {
      // In a real implementation, you'd use libraries like 'os' or 'systeminformation'
      const memoryUsage = process.memoryUsage();
      const cpuUsage = process.cpuUsage();
      
      return {
        memory: {
          used: memoryUsage.heapUsed,
          total: memoryUsage.heapTotal,
          external: memoryUsage.external,
          percentage: (memoryUsage.heapUsed / memoryUsage.heapTotal) * 100
        },
        cpu: {
          user: cpuUsage.user,
          system: cpuUsage.system,
          percentage: 0 // Would calculate actual CPU percentage
        },
        uptime: process.uptime(),
        nodeVersion: process.version,
        platform: process.platform
      };
    } catch (error) {
      logService.error('Error getting system metrics:', error);
      return {};
    }
  }

  /**
   * Check metrics against thresholds and generate alerts
   */
  async checkAndGenerateAlerts() {
    try {
      const currentMetrics = await this.collectCurrentMetrics();
      const newAlerts = [];
      
      // Check queue length
      const totalWaiting = currentMetrics.performance.totalWaitingJobs;
      if (totalWaiting > this.thresholds.queueLength) {
        newAlerts.push({
          id: `queue-length-${Date.now()}`,
          type: 'HIGH_QUEUE_LENGTH',
          severity: totalWaiting > this.thresholds.queueLength * 2 ? 'critical' : 'warning',
          message: `High queue length detected: ${totalWaiting} jobs waiting`,
          value: totalWaiting,
          threshold: this.thresholds.queueLength,
          timestamp: new Date().toISOString()
        });
      }
      
      // Check processing time
      const avgProcessingTime = currentMetrics.performance.averageProcessingTime;
      if (avgProcessingTime > this.thresholds.processingTime) {
        newAlerts.push({
          id: `processing-time-${Date.now()}`,
          type: 'SLOW_PROCESSING',
          severity: avgProcessingTime > this.thresholds.processingTime * 2 ? 'critical' : 'warning',
          message: `Slow processing detected: ${avgProcessingTime}s average`,
          value: avgProcessingTime,
          threshold: this.thresholds.processingTime,
          timestamp: new Date().toISOString()
        });
      }
      
      // Check error rate
      const errorRate = 1 - (currentMetrics.performance.successRate / 100);
      if (errorRate > this.thresholds.errorRate) {
        newAlerts.push({
          id: `error-rate-${Date.now()}`,
          type: 'HIGH_ERROR_RATE',
          severity: errorRate > this.thresholds.errorRate * 2 ? 'critical' : 'warning',
          message: `High error rate detected: ${(errorRate * 100).toFixed(1)}%`,
          value: errorRate,
          threshold: this.thresholds.errorRate,
          timestamp: new Date().toISOString()
        });
      }
      
      // Check memory usage
      if (currentMetrics.system.memory?.percentage > this.thresholds.memoryUsage * 100) {
        newAlerts.push({
          id: `memory-usage-${Date.now()}`,
          type: 'HIGH_MEMORY_USAGE',
          severity: 'warning',
          message: `High memory usage: ${currentMetrics.system.memory.percentage.toFixed(1)}%`,
          value: currentMetrics.system.memory.percentage / 100,
          threshold: this.thresholds.memoryUsage,
          timestamp: new Date().toISOString()
        });
      }
      
      // Check worker availability
      const activeWorkers = currentMetrics.workers.length;
      if (activeWorkers === 0) {
        newAlerts.push({
          id: `no-workers-${Date.now()}`,
          type: 'NO_ACTIVE_WORKERS',
          severity: 'critical',
          message: 'No active workers available',
          value: 0,
          threshold: 1,
          timestamp: new Date().toISOString()
        });
      }
      
      // Add new alerts and remove duplicates
      newAlerts.forEach(alert => {
        const existingAlert = this.alerts.find(a => a.type === alert.type && a.severity === alert.severity);
        if (!existingAlert) {
          this.alerts.push(alert);
          this.broadcastAlert(alert);
        }
      });
      
      // Remove resolved alerts
      this.removeResolvedAlerts(currentMetrics);
      
    } catch (error) {
      logService.error('Error checking alerts:', error);
    }
  }

  /**
   * Remove alerts that are no longer active
   * @param {Object} currentMetrics - Current system metrics
   */
  removeResolvedAlerts(currentMetrics) {
    const resolvedAlerts = [];
    
    this.alerts.forEach(alert => {
      let isResolved = false;
      
      switch (alert.type) {
        case 'HIGH_QUEUE_LENGTH':
          isResolved = currentMetrics.performance.totalWaitingJobs <= this.thresholds.queueLength;
          break;
        case 'SLOW_PROCESSING':
          isResolved = currentMetrics.performance.averageProcessingTime <= this.thresholds.processingTime;
          break;
        case 'HIGH_ERROR_RATE':
          const errorRate = 1 - (currentMetrics.performance.successRate / 100);
          isResolved = errorRate <= this.thresholds.errorRate;
          break;
        case 'HIGH_MEMORY_USAGE':
          isResolved = (currentMetrics.system.memory?.percentage || 0) <= this.thresholds.memoryUsage * 100;
          break;
        case 'NO_ACTIVE_WORKERS':
          isResolved = currentMetrics.workers.length > 0;
          break;
      }
      
      if (isResolved) {
        resolvedAlerts.push(alert);
      }
    });
    
    // Remove resolved alerts
    resolvedAlerts.forEach(resolvedAlert => {
      this.alerts = this.alerts.filter(alert => alert.id !== resolvedAlert.id);
      this.broadcastAlertResolved(resolvedAlert);
    });
  }

  /**
   * Broadcast new alert to admins
   * @param {Object} alert - Alert object
   */
  broadcastAlert(alert) {
    webSocketManager.getIO()?.emit('dashboard-alert', alert);
    logService.warn(`Dashboard Alert [${alert.severity.toUpperCase()}]: ${alert.message}`);
  }

  /**
   * Broadcast alert resolution to admins
   * @param {Object} alert - Resolved alert object
   */
  broadcastAlertResolved(alert) {
    webSocketManager.getIO()?.emit('dashboard-alert-resolved', alert);
    logService.info(`Dashboard Alert Resolved: ${alert.message}`);
  }

  /**
   * Get active alerts
   * @returns {Array} Array of active alerts
   */
  getActiveAlerts() {
    return this.alerts.filter(alert => {
      // Remove alerts older than 1 hour
      const alertTime = new Date(alert.timestamp);
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      return alertTime > oneHourAgo;
    });
  }

  /**
   * Get historical metrics for a time range
   * @param {string} timeRange - Time range (1h, 6h, 24h)
   * @returns {Array} Historical metrics
   */
  getHistoricalMetrics(timeRange = '1h') {
    const now = Date.now();
    let cutoffTime;
    
    switch (timeRange) {
      case '1h':
        cutoffTime = now - (60 * 60 * 1000);
        break;
      case '6h':
        cutoffTime = now - (6 * 60 * 60 * 1000);
        break;
      case '24h':
        cutoffTime = now - (24 * 60 * 60 * 1000);
        break;
      default:
        cutoffTime = now - (60 * 60 * 1000);
    }
    
    return this.metricsHistory.filter(metric => 
      new Date(metric.timestamp).getTime() > cutoffTime
    );
  }

  /**
   * Get performance summary for a time period
   * @param {string} timeRange - Time range
   * @returns {Object} Performance summary
   */
  getPerformanceSummary(timeRange = '1h') {
    const metrics = this.getHistoricalMetrics(timeRange);
    
    if (metrics.length === 0) {
      return {
        totalJobs: 0,
        averageProcessingTime: 0,
        successRate: 0,
        peakQueueLength: 0,
        averageWorkers: 0
      };
    }
    
    const totalJobs = metrics.reduce((sum, m) => sum + (m.performance.totalJobsLastHour || 0), 0);
    const avgProcessingTime = metrics.reduce((sum, m) => sum + (m.performance.averageProcessingTime || 0), 0) / metrics.length;
    const avgSuccessRate = metrics.reduce((sum, m) => sum + (m.performance.successRate || 0), 0) / metrics.length;
    const peakQueueLength = Math.max(...metrics.map(m => m.performance.totalWaitingJobs || 0));
    const avgWorkers = metrics.reduce((sum, m) => sum + (m.workers?.length || 0), 0) / metrics.length;
    
    return {
      totalJobs,
      averageProcessingTime: Math.round(avgProcessingTime),
      successRate: Math.round(avgSuccessRate * 100) / 100,
      peakQueueLength,
      averageWorkers: Math.round(avgWorkers * 10) / 10
    };
  }

  /**
   * Get queue analytics
   * @returns {Object} Queue analytics
   */
  getQueueAnalytics() {
    const recentMetrics = this.getHistoricalMetrics('6h');
    
    if (recentMetrics.length === 0) {
      return {
        queueTrends: {},
        processingTrends: {},
        workerUtilization: {}
      };
    }
    
    const queueTrends = {};
    const processingTrends = {};
    const workerUtilization = {};
    
    // Analyze queue trends
    ['premium', 'normal', 'large'].forEach(queueType => {
      const queueData = recentMetrics.map(m => ({
        timestamp: m.timestamp,
        waiting: m.queues[queueType]?.waiting || 0,
        active: m.queues[queueType]?.active || 0,
        completed: m.queues[queueType]?.completed || 0
      }));
      
      queueTrends[queueType] = queueData;
    });
    
    // Analyze processing trends
    processingTrends.averageTime = recentMetrics.map(m => ({
      timestamp: m.timestamp,
      value: m.performance.averageProcessingTime || 0
    }));
    
    processingTrends.successRate = recentMetrics.map(m => ({
      timestamp: m.timestamp,
      value: m.performance.successRate || 0
    }));
    
    // Analyze worker utilization
    const workerIds = new Set();
    recentMetrics.forEach(m => {
      m.workers?.forEach(w => workerIds.add(w.workerId));
    });
    
    workerIds.forEach(workerId => {
      const workerData = recentMetrics.map(m => {
        const worker = m.workers?.find(w => w.workerId === workerId);
        return {
          timestamp: m.timestamp,
          active: worker ? 1 : 0,
          jobsInProgress: worker?.jobsInProgress || 0,
          memoryUsage: worker?.memoryUsage || 0,
          cpuUsage: worker?.cpuUsage || 0
        };
      });
      
      workerUtilization[workerId] = workerData;
    });
    
    return {
      queueTrends,
      processingTrends,
      workerUtilization
    };
  }

  /**
   * Update alert thresholds
   * @param {Object} newThresholds - New threshold values
   */
  updateThresholds(newThresholds) {
    this.thresholds = {
      ...this.thresholds,
      ...newThresholds
    };
    
    logService.info('Dashboard thresholds updated:', newThresholds);
  }

  /**
   * Clean up old data to prevent memory issues
   */
  cleanupOldData() {
    const twentyFourHoursAgo = Date.now() - (24 * 60 * 60 * 1000);
    
    // Clean up metrics history
    this.metricsHistory = this.metricsHistory.filter(metric => 
      new Date(metric.timestamp).getTime() > twentyFourHoursAgo
    );
    
    // Clean up old alerts
    this.alerts = this.alerts.filter(alert => 
      new Date(alert.timestamp).getTime() > twentyFourHoursAgo
    );
    
    logService.debug('Dashboard data cleanup completed');
  }

  /**
   * Get dashboard status
   * @returns {Object} Dashboard status
   */
  getStatus() {
    return {
      isCollecting: this.isCollecting,
      metricsCount: this.metricsHistory.length,
      activeAlerts: this.getActiveAlerts().length,
      thresholds: this.thresholds,
      uptime: process.uptime()
    };
  }
}

// Export singleton instance
const dashboardService = new DashboardService();
export default dashboardService;