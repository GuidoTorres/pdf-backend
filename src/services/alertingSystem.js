import { EventEmitter } from 'events';
import { WorkerMetrics, QueueStats, JobMetrics } from '../models/index.js';

/**
 * AlertingSystem - Automated alert generation and notification system
 * 
 * This service monitors system metrics and generates alerts when thresholds are exceeded.
 * It supports multiple alert channels and severity levels.
 */
class AlertingSystem extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.options = {
      checkInterval: options.checkInterval || 60000, // 1 minute
      enableEmailAlerts: options.enableEmailAlerts || false,
      enableWebhookAlerts: options.enableWebhookAlerts || false,
      enableLogAlerts: options.enableLogAlerts !== false, // Default true
      maxAlertsPerHour: options.maxAlertsPerHour || 10,
      ...options
    };
    
    // Alert thresholds
    this.thresholds = {
      // Performance thresholds
      avgProcessingTime: options.thresholds?.avgProcessingTime || 60, // seconds
      avgWaitTime: options.thresholds?.avgWaitTime || 30, // seconds
      successRate: options.thresholds?.successRate || 95, // percentage
      
      // Resource thresholds
      memoryUsage: options.thresholds?.memoryUsage || 85, // percentage
      cpuUsage: options.thresholds?.cpuUsage || 80, // percentage
      diskUsage: options.thresholds?.diskUsage || 90, // percentage
      
      // Queue thresholds
      queueLength: options.thresholds?.queueLength || 50, // jobs
      queueWaitTime: options.thresholds?.queueWaitTime || 300, // seconds
      
      // Worker thresholds
      workerFailureRate: options.thresholds?.workerFailureRate || 10, // percentage
      inactiveWorkerTime: options.thresholds?.inactiveWorkerTime || 300, // seconds
      
      // Error thresholds
      errorRate: options.thresholds?.errorRate || 5, // percentage
      errorSpike: options.thresholds?.errorSpike || 20, // errors per hour
      
      ...options.thresholds
    };
    
    this.isMonitoring = false;
    this.monitoringInterval = null;
    this.alertHistory = new Map(); // Track recent alerts to prevent spam
    this.alertCounts = new Map(); // Track alert counts per hour
    
    this.logger = this.setupLogger();
    
    // Start monitoring if enabled
    if (this.options.enableMonitoring !== false) {
      this.startMonitoring();
    }
  }
  
  setupLogger() {
    return {
      info: (msg) => console.log(`[AlertingSystem] ${msg}`),
      error: (msg) => console.error(`[AlertingSystem] ${msg}`),
      debug: (msg) => this.options.debug && console.log(`[AlertingSystem] ${msg}`),
      warn: (msg) => console.warn(`[AlertingSystem] ${msg}`)
    };
  }
  
  /**
   * Start monitoring and alert checking
   */
  startMonitoring() {
    if (this.isMonitoring) {
      return;
    }
    
    this.isMonitoring = true;
    this.monitoringInterval = setInterval(() => {
      this.checkAllAlerts().catch(error => {
        this.logger.error(`Error checking alerts: ${error.message}`);
      });
    }, this.options.checkInterval);
    
    this.logger.info('Started alert monitoring');
    this.emit('monitoring-started');
  }
  
  /**
   * Stop monitoring
   */
  stopMonitoring() {
    if (!this.isMonitoring) {
      return;
    }
    
    this.isMonitoring = false;
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
    
    this.logger.info('Stopped alert monitoring');
    this.emit('monitoring-stopped');
  }
  
  /**
   * Check all alert conditions
   */
  async checkAllAlerts() {
    try {
      const [
        performanceAlerts,
        resourceAlerts,
        queueAlerts,
        workerAlerts,
        errorAlerts
      ] = await Promise.all([
        this.checkPerformanceAlerts(),
        this.checkResourceAlerts(),
        this.checkQueueAlerts(),
        this.checkWorkerAlerts(),
        this.checkErrorAlerts()
      ]);
      
      const allAlerts = [
        ...performanceAlerts,
        ...resourceAlerts,
        ...queueAlerts,
        ...workerAlerts,
        ...errorAlerts
      ];
      
      // Process and send alerts
      for (const alert of allAlerts) {
        await this.processAlert(alert);
      }
      
      this.emit('alerts-checked', { alertCount: allAlerts.length });
      
    } catch (error) {
      this.logger.error(`Error in checkAllAlerts: ${error.message}`);
    }
  }
  
  /**
   * Check performance-related alerts
   */
  async checkPerformanceAlerts() {
    const alerts = [];
    
    try {
      const stats = await JobMetrics.getPerformanceStats(1); // Last hour
      
      // Check average processing time
      if (stats.avgProcessingTime > this.thresholds.avgProcessingTime) {
        alerts.push({
          type: 'performance',
          severity: 'medium',
          title: 'High Average Processing Time',
          message: `Average processing time is ${stats.avgProcessingTime.toFixed(1)}s (threshold: ${this.thresholds.avgProcessingTime}s)`,
          value: stats.avgProcessingTime,
          threshold: this.thresholds.avgProcessingTime,
          metric: 'avg_processing_time',
          timestamp: new Date()
        });
      }
      
      // Check average wait time
      if (stats.avgWaitTime > this.thresholds.avgWaitTime) {
        alerts.push({
          type: 'performance',
          severity: 'medium',
          title: 'High Average Wait Time',
          message: `Average wait time is ${stats.avgWaitTime.toFixed(1)}s (threshold: ${this.thresholds.avgWaitTime}s)`,
          value: stats.avgWaitTime,
          threshold: this.thresholds.avgWaitTime,
          metric: 'avg_wait_time',
          timestamp: new Date()
        });
      }
      
      // Check success rate
      if (stats.successRate < this.thresholds.successRate) {
        alerts.push({
          type: 'performance',
          severity: 'high',
          title: 'Low Success Rate',
          message: `Success rate is ${stats.successRate.toFixed(1)}% (threshold: ${this.thresholds.successRate}%)`,
          value: stats.successRate,
          threshold: this.thresholds.successRate,
          metric: 'success_rate',
          timestamp: new Date()
        });
      }
      
    } catch (error) {
      this.logger.error(`Error checking performance alerts: ${error.message}`);
    }
    
    return alerts;
  }
  
  /**
   * Check resource-related alerts
   */
  async checkResourceAlerts() {
    const alerts = [];
    
    try {
      const systemOverview = await WorkerMetrics.getSystemOverview();
      
      // Check memory usage
      if (systemOverview.avgMemoryUsage > (this.thresholds.memoryUsage * 20)) { // Convert % to MB estimate
        alerts.push({
          type: 'resource',
          severity: 'high',
          title: 'High Memory Usage',
          message: `Average memory usage is ${systemOverview.avgMemoryUsage.toFixed(0)}MB`,
          value: systemOverview.avgMemoryUsage,
          threshold: this.thresholds.memoryUsage * 20,
          metric: 'memory_usage',
          timestamp: new Date()
        });
      }
      
      // Check CPU usage
      if (systemOverview.avgCpuUsage > this.thresholds.cpuUsage) {
        alerts.push({
          type: 'resource',
          severity: 'medium',
          title: 'High CPU Usage',
          message: `Average CPU usage is ${systemOverview.avgCpuUsage.toFixed(1)}% (threshold: ${this.thresholds.cpuUsage}%)`,
          value: systemOverview.avgCpuUsage,
          threshold: this.thresholds.cpuUsage,
          metric: 'cpu_usage',
          timestamp: new Date()
        });
      }
      
    } catch (error) {
      this.logger.error(`Error checking resource alerts: ${error.message}`);
    }
    
    return alerts;
  }
  
  /**
   * Check queue-related alerts
   */
  async checkQueueAlerts() {
    const alerts = [];
    
    try {
      const queueOverview = await QueueStats.getAllQueuesOverview();
      
      // Check total queue length
      if (queueOverview.totals.totalWaiting > this.thresholds.queueLength) {
        alerts.push({
          type: 'queue',
          severity: 'medium',
          title: 'High Queue Length',
          message: `Total jobs waiting: ${queueOverview.totals.totalWaiting} (threshold: ${this.thresholds.queueLength})`,
          value: queueOverview.totals.totalWaiting,
          threshold: this.thresholds.queueLength,
          metric: 'queue_length',
          timestamp: new Date()
        });
      }
      
      // Check individual queue wait times
      for (const queue of queueOverview.queues) {
        if (queue.avgWaitTime && queue.avgWaitTime > this.thresholds.queueWaitTime) {
          alerts.push({
            type: 'queue',
            severity: 'medium',
            title: 'High Queue Wait Time',
            message: `Queue "${queue.name}" average wait time: ${queue.avgWaitTime.toFixed(1)}s (threshold: ${this.thresholds.queueWaitTime}s)`,
            value: queue.avgWaitTime,
            threshold: this.thresholds.queueWaitTime,
            metric: 'queue_wait_time',
            queueName: queue.name,
            timestamp: new Date()
          });
        }
      }
      
    } catch (error) {
      this.logger.error(`Error checking queue alerts: ${error.message}`);
    }
    
    return alerts;
  }
  
  /**
   * Check worker-related alerts
   */
  async checkWorkerAlerts() {
    const alerts = [];
    
    try {
      const activeWorkers = await WorkerMetrics.getActiveWorkers();
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
      
      // Check for inactive workers
      const inactiveWorkers = activeWorkers.filter(worker => 
        worker.last_heartbeat < fiveMinutesAgo
      );
      
      if (inactiveWorkers.length > 0) {
        alerts.push({
          type: 'worker',
          severity: 'high',
          title: 'Inactive Workers Detected',
          message: `${inactiveWorkers.length} workers have not sent heartbeat in 5+ minutes`,
          value: inactiveWorkers.length,
          threshold: 0,
          metric: 'inactive_workers',
          workerIds: inactiveWorkers.map(w => w.worker_id),
          timestamp: new Date()
        });
      }
      
      // Check worker failure rates
      for (const worker of activeWorkers) {
        const totalJobs = worker.total_jobs_processed;
        const errorRate = totalJobs > 0 ? (worker.error_count / totalJobs) * 100 : 0;
        
        if (errorRate > this.thresholds.workerFailureRate && totalJobs > 10) {
          alerts.push({
            type: 'worker',
            severity: 'medium',
            title: 'High Worker Failure Rate',
            message: `Worker "${worker.worker_id}" has ${errorRate.toFixed(1)}% failure rate (threshold: ${this.thresholds.workerFailureRate}%)`,
            value: errorRate,
            threshold: this.thresholds.workerFailureRate,
            metric: 'worker_failure_rate',
            workerId: worker.worker_id,
            timestamp: new Date()
          });
        }
      }
      
      // Check if we have enough active workers
      const systemOverview = await WorkerMetrics.getSystemOverview();
      if (systemOverview.activeWorkerCount === 0) {
        alerts.push({
          type: 'worker',
          severity: 'critical',
          title: 'No Active Workers',
          message: 'No active workers detected - system cannot process jobs',
          value: 0,
          threshold: 1,
          metric: 'active_workers',
          timestamp: new Date()
        });
      }
      
    } catch (error) {
      this.logger.error(`Error checking worker alerts: ${error.message}`);
    }
    
    return alerts;
  }
  
  /**
   * Check error-related alerts
   */
  async checkErrorAlerts() {
    const alerts = [];
    
    try {
      const errorAnalysis = await JobMetrics.getErrorAnalysis(1); // Last hour
      
      // Check overall error rate
      const stats = await JobMetrics.getPerformanceStats(1);
      const errorRate = 100 - stats.successRate;
      
      if (errorRate > this.thresholds.errorRate) {
        alerts.push({
          type: 'error',
          severity: 'high',
          title: 'High Error Rate',
          message: `System error rate is ${errorRate.toFixed(1)}% (threshold: ${this.thresholds.errorRate}%)`,
          value: errorRate,
          threshold: this.thresholds.errorRate,
          metric: 'error_rate',
          timestamp: new Date()
        });
      }
      
      // Check for error spikes
      if (errorAnalysis.totalErrors > this.thresholds.errorSpike) {
        alerts.push({
          type: 'error',
          severity: 'medium',
          title: 'Error Spike Detected',
          message: `${errorAnalysis.totalErrors} errors in the last hour (threshold: ${this.thresholds.errorSpike})`,
          value: errorAnalysis.totalErrors,
          threshold: this.thresholds.errorSpike,
          metric: 'error_spike',
          timestamp: new Date()
        });
      }
      
      // Check for dominant error types
      if (errorAnalysis.errorTypes.length > 0) {
        const topError = errorAnalysis.errorTypes[0];
        if (topError.percentage > 50 && topError.count > 5) {
          alerts.push({
            type: 'error',
            severity: 'medium',
            title: 'Dominant Error Type',
            message: `Error type "${topError.errorType}" accounts for ${topError.percentage.toFixed(1)}% of all errors (${topError.count} occurrences)`,
            value: topError.percentage,
            threshold: 50,
            metric: 'dominant_error',
            errorType: topError.errorType,
            timestamp: new Date()
          });
        }
      }
      
    } catch (error) {
      this.logger.error(`Error checking error alerts: ${error.message}`);
    }
    
    return alerts;
  }
  
  /**
   * Process and send an alert
   */
  async processAlert(alert) {
    try {
      // Check if we should suppress this alert (rate limiting)
      if (this.shouldSuppressAlert(alert)) {
        return;
      }
      
      // Record alert
      this.recordAlert(alert);
      
      // Send alert through configured channels
      await this.sendAlert(alert);
      
      this.emit('alert-generated', alert);
      
    } catch (error) {
      this.logger.error(`Error processing alert: ${error.message}`);
    }
  }
  
  /**
   * Check if alert should be suppressed to prevent spam
   */
  shouldSuppressAlert(alert) {
    const alertKey = `${alert.type}_${alert.metric}`;
    const now = Date.now();
    const oneHour = 60 * 60 * 1000;
    
    // Check if we've sent too many alerts of this type recently
    const recentAlerts = this.alertHistory.get(alertKey) || [];
    const recentCount = recentAlerts.filter(timestamp => now - timestamp < oneHour).length;
    
    if (recentCount >= this.options.maxAlertsPerHour) {
      this.logger.debug(`Suppressing alert ${alertKey} - rate limit exceeded`);
      return true;
    }
    
    // Check if we sent the same alert very recently (within 10 minutes)
    const tenMinutes = 10 * 60 * 1000;
    const veryRecentAlerts = recentAlerts.filter(timestamp => now - timestamp < tenMinutes);
    
    if (veryRecentAlerts.length > 0) {
      this.logger.debug(`Suppressing alert ${alertKey} - sent recently`);
      return true;
    }
    
    return false;
  }
  
  /**
   * Record alert in history
   */
  recordAlert(alert) {
    const alertKey = `${alert.type}_${alert.metric}`;
    const now = Date.now();
    
    if (!this.alertHistory.has(alertKey)) {
      this.alertHistory.set(alertKey, []);
    }
    
    this.alertHistory.get(alertKey).push(now);
    
    // Clean up old entries (older than 24 hours)
    const oneDayAgo = now - 24 * 60 * 60 * 1000;
    this.alertHistory.set(
      alertKey,
      this.alertHistory.get(alertKey).filter(timestamp => timestamp > oneDayAgo)
    );
  }
  
  /**
   * Send alert through configured channels
   */
  async sendAlert(alert) {
    const promises = [];
    
    // Log alert (always enabled unless explicitly disabled)
    if (this.options.enableLogAlerts) {
      promises.push(this.sendLogAlert(alert));
    }
    
    // Email alert
    if (this.options.enableEmailAlerts) {
      promises.push(this.sendEmailAlert(alert));
    }
    
    // Webhook alert
    if (this.options.enableWebhookAlerts) {
      promises.push(this.sendWebhookAlert(alert));
    }
    
    await Promise.allSettled(promises);
  }
  
  /**
   * Send log alert
   */
  async sendLogAlert(alert) {
    const logLevel = alert.severity === 'critical' ? 'error' : 
                    alert.severity === 'high' ? 'error' : 
                    alert.severity === 'medium' ? 'warn' : 'info';
    
    const message = `[${alert.severity.toUpperCase()}] ${alert.title}: ${alert.message}`;
    
    this.logger[logLevel](message);
  }
  
  /**
   * Send email alert (placeholder - implement with your email service)
   */
  async sendEmailAlert(alert) {
    try {
      // Implement email sending logic here
      // This could use nodemailer, SendGrid, AWS SES, etc.
      
      this.logger.debug(`Email alert would be sent: ${alert.title}`);
      
      // Example implementation:
      /*
      const emailService = require('./emailService');
      await emailService.sendAlert({
        to: this.options.alertEmail,
        subject: `[${alert.severity.toUpperCase()}] ${alert.title}`,
        body: alert.message,
        alert: alert
      });
      */
      
    } catch (error) {
      this.logger.error(`Error sending email alert: ${error.message}`);
    }
  }
  
  /**
   * Send webhook alert (placeholder - implement with your webhook service)
   */
  async sendWebhookAlert(alert) {
    try {
      // Implement webhook sending logic here
      // This could use axios, fetch, etc.
      
      this.logger.debug(`Webhook alert would be sent: ${alert.title}`);
      
      // Example implementation:
      /*
      const axios = require('axios');
      await axios.post(this.options.webhookUrl, {
        alert: alert,
        timestamp: new Date().toISOString(),
        system: 'pdf-processing'
      });
      */
      
    } catch (error) {
      this.logger.error(`Error sending webhook alert: ${error.message}`);
    }
  }
  
  /**
   * Get alert history
   */
  getAlertHistory(hours = 24) {
    const cutoff = Date.now() - hours * 60 * 60 * 1000;
    const history = {};
    
    for (const [alertKey, timestamps] of this.alertHistory.entries()) {
      const recentTimestamps = timestamps.filter(ts => ts > cutoff);
      if (recentTimestamps.length > 0) {
        history[alertKey] = recentTimestamps.map(ts => new Date(ts));
      }
    }
    
    return history;
  }
  
  /**
   * Update alert thresholds
   */
  updateThresholds(newThresholds) {
    this.thresholds = { ...this.thresholds, ...newThresholds };
    this.logger.info('Alert thresholds updated');
    this.emit('thresholds-updated', this.thresholds);
  }
  
  /**
   * Get current thresholds
   */
  getThresholds() {
    return { ...this.thresholds };
  }
  
  /**
   * Test alert system by generating a test alert
   */
  async testAlert(alertType = 'test') {
    const testAlert = {
      type: 'test',
      severity: 'low',
      title: 'Test Alert',
      message: 'This is a test alert to verify the alerting system is working',
      value: 0,
      threshold: 0,
      metric: 'test_metric',
      timestamp: new Date()
    };
    
    await this.processAlert(testAlert);
    this.logger.info('Test alert sent');
  }
  
  /**
   * Get alert statistics
   */
  getAlertStats(hours = 24) {
    const cutoff = Date.now() - hours * 60 * 60 * 1000;
    const stats = {
      totalAlerts: 0,
      alertsByType: {},
      alertsBySeverity: {},
      alertsByMetric: {}
    };
    
    for (const [alertKey, timestamps] of this.alertHistory.entries()) {
      const recentTimestamps = timestamps.filter(ts => ts > cutoff);
      const count = recentTimestamps.length;
      
      if (count > 0) {
        stats.totalAlerts += count;
        
        const [type, metric] = alertKey.split('_');
        stats.alertsByType[type] = (stats.alertsByType[type] || 0) + count;
        stats.alertsByMetric[metric] = (stats.alertsByMetric[metric] || 0) + count;
      }
    }
    
    return stats;
  }
  
  /**
   * Shutdown the alerting system
   */
  async shutdown() {
    this.stopMonitoring();
    
    // Clear alert history
    this.alertHistory.clear();
    this.alertCounts.clear();
    
    this.logger.info('AlertingSystem shutdown complete');
    this.emit('shutdown');
  }
}

export default AlertingSystem;