import MetricsCollector from './metricsCollector.js';
import AlertingSystem from './alertingSystem.js';
import PerformanceReportGenerator from './performanceReportGenerator.js';
import { EventEmitter } from 'events';

/**
 * MetricsIntegrationService - Central service that coordinates all metrics components
 * 
 * This service integrates:
 * - MetricsCollector for real-time metrics collection
 * - AlertingSystem for automated alert generation
 * - PerformanceReportGenerator for daily reports
 * - WebSocket integration for real-time dashboard updates
 */
class MetricsIntegrationService extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.options = {
      enableMetricsCollection: options.enableMetricsCollection !== false,
      enableAlerting: options.enableAlerting !== false,
      enableReporting: options.enableReporting !== false,
      enableWebSocketUpdates: options.enableWebSocketUpdates !== false,
      metricsCollectorOptions: options.metricsCollectorOptions || {},
      alertingOptions: options.alertingOptions || {},
      reportingOptions: options.reportingOptions || {},
      ...options
    };
    
    this.isInitialized = false;
    this.isRunning = false;
    
    // Component instances
    this.metricsCollector = null;
    this.alertingSystem = null;
    this.reportGenerator = null;
    this.websocketManager = null;
    
    this.logger = this.setupLogger();
  }
  
  setupLogger() {
    return {
      info: (msg) => console.log(`[MetricsIntegrationService] ${msg}`),
      error: (msg) => console.error(`[MetricsIntegrationService] ${msg}`),
      debug: (msg) => this.options.debug && console.log(`[MetricsIntegrationService] ${msg}`),
      warn: (msg) => console.warn(`[MetricsIntegrationService] ${msg}`)
    };
  }
  
  /**
   * Initialize all metrics components
   */
  async initialize(websocketManager = null) {
    if (this.isInitialized) {
      return;
    }
    
    try {
      this.logger.info('Initializing metrics integration service...');
      
      // Store WebSocket manager reference
      this.websocketManager = websocketManager;
      
      // Initialize MetricsCollector
      if (this.options.enableMetricsCollection) {
        this.metricsCollector = new MetricsCollector(this.options.metricsCollectorOptions);
        this.setupMetricsCollectorEvents();
        this.logger.info('MetricsCollector initialized');
      }
      
      // Initialize AlertingSystem
      if (this.options.enableAlerting) {
        this.alertingSystem = new AlertingSystem(this.options.alertingOptions);
        this.setupAlertingSystemEvents();
        this.logger.info('AlertingSystem initialized');
      }
      
      // Initialize PerformanceReportGenerator
      if (this.options.enableReporting) {
        this.reportGenerator = new PerformanceReportGenerator(this.options.reportingOptions);
        this.setupReportGeneratorEvents();
        this.logger.info('PerformanceReportGenerator initialized');
      }
      
      // Set up cross-component integration
      this.setupComponentIntegration();
      
      this.isInitialized = true;
      this.logger.info('Metrics integration service initialized successfully');
      this.emit('initialized');
      
    } catch (error) {
      this.logger.error(`Error initializing metrics integration service: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Start all metrics services
   */
  async start() {
    if (!this.isInitialized) {
      throw new Error('MetricsIntegrationService must be initialized before starting');
    }
    
    if (this.isRunning) {
      return;
    }
    
    try {
      this.logger.info('Starting metrics integration service...');
      
      // Start MetricsCollector
      if (this.metricsCollector) {
        this.metricsCollector.startCollection();
      }
      
      // Start AlertingSystem
      if (this.alertingSystem) {
        this.alertingSystem.startMonitoring();
      }
      
      // PerformanceReportGenerator starts automatically if configured
      
      this.isRunning = true;
      this.logger.info('Metrics integration service started successfully');
      this.emit('started');
      
    } catch (error) {
      this.logger.error(`Error starting metrics integration service: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Stop all metrics services
   */
  async stop() {
    if (!this.isRunning) {
      return;
    }
    
    try {
      this.logger.info('Stopping metrics integration service...');
      
      // Stop MetricsCollector
      if (this.metricsCollector) {
        this.metricsCollector.stopCollection();
      }
      
      // Stop AlertingSystem
      if (this.alertingSystem) {
        this.alertingSystem.stopMonitoring();
      }
      
      // Stop PerformanceReportGenerator
      if (this.reportGenerator) {
        this.reportGenerator.stopScheduledReports();
      }
      
      this.isRunning = false;
      this.logger.info('Metrics integration service stopped successfully');
      this.emit('stopped');
      
    } catch (error) {
      this.logger.error(`Error stopping metrics integration service: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Setup MetricsCollector event handlers
   */
  setupMetricsCollectorEvents() {
    if (!this.metricsCollector) return;
    
    // Forward job events
    this.metricsCollector.on('job-started', (data) => {
      this.emit('job-started', data);
      this.broadcastToWebSocket('job-started', data);
    });
    
    this.metricsCollector.on('job-completed', (data) => {
      this.emit('job-completed', data);
      this.broadcastToWebSocket('job-completed', data);
    });
    
    this.metricsCollector.on('job-failed', (data) => {
      this.emit('job-failed', data);
      this.broadcastToWebSocket('job-failed', data);
    });
    
    // Forward worker events
    this.metricsCollector.on('worker-updated', (data) => {
      this.emit('worker-updated', data);
      this.broadcastToWebSocket('worker-updated', data);
    });
    
    // Forward system metrics
    this.metricsCollector.on('system-metrics-collected', (data) => {
      this.emit('system-metrics-collected', data);
      this.broadcastToWebSocket('system-metrics', data);
    });
    
    // Forward report generation
    this.metricsCollector.on('report-generated', (data) => {
      this.emit('metrics-report-generated', data);
    });
  }
  
  /**
   * Setup AlertingSystem event handlers
   */
  setupAlertingSystemEvents() {
    if (!this.alertingSystem) return;
    
    // Forward alert events
    this.alertingSystem.on('alert-generated', (alert) => {
      this.emit('alert-generated', alert);
      this.broadcastToWebSocket('alert', alert);
      this.logger.warn(`Alert generated: ${alert.title} - ${alert.message}`);
    });
    
    // Forward monitoring events
    this.alertingSystem.on('monitoring-started', () => {
      this.logger.info('Alert monitoring started');
    });
    
    this.alertingSystem.on('monitoring-stopped', () => {
      this.logger.info('Alert monitoring stopped');
    });
  }
  
  /**
   * Setup PerformanceReportGenerator event handlers
   */
  setupReportGeneratorEvents() {
    if (!this.reportGenerator) return;
    
    // Forward report events
    this.reportGenerator.on('report-generated', (report) => {
      this.emit('daily-report-generated', report);
      this.broadcastToWebSocket('daily-report', { 
        generated: true, 
        date: report.metadata.reportDate 
      });
      this.logger.info(`Daily report generated for ${report.metadata.reportDate.toDateString()}`);
    });
  }
  
  /**
   * Setup cross-component integration
   */
  setupComponentIntegration() {
    // When metrics collector generates a report, trigger alerting check
    if (this.metricsCollector && this.alertingSystem) {
      this.metricsCollector.on('report-generated', async (report) => {
        try {
          // Trigger immediate alert check after report generation
          await this.alertingSystem.checkAllAlerts();
        } catch (error) {
          this.logger.error(`Error triggering alert check after report: ${error.message}`);
        }
      });
    }
    
    // When alerts are generated, include them in daily reports
    if (this.alertingSystem && this.reportGenerator) {
      // This integration happens naturally through the database
      // as alerts are stored and retrieved during report generation
    }
  }
  
  /**
   * Broadcast data to WebSocket clients
   */
  broadcastToWebSocket(event, data) {
    if (this.websocketManager && this.options.enableWebSocketUpdates) {
      try {
        this.websocketManager.broadcast(event, data);
      } catch (error) {
        this.logger.error(`Error broadcasting to WebSocket: ${error.message}`);
      }
    }
  }
  
  /**
   * Record job start - unified interface
   */
  async recordJobStart(jobData) {
    if (!this.metricsCollector) {
      throw new Error('MetricsCollector not initialized');
    }
    
    return await this.metricsCollector.recordJobStart(jobData);
  }
  
  /**
   * Record job completion - unified interface
   */
  async recordJobCompletion(jobId, completionData) {
    if (!this.metricsCollector) {
      throw new Error('MetricsCollector not initialized');
    }
    
    return await this.metricsCollector.recordJobCompletion(jobId, completionData);
  }
  
  /**
   * Record job failure - unified interface
   */
  async recordJobFailure(jobId, failureData) {
    if (!this.metricsCollector) {
      throw new Error('MetricsCollector not initialized');
    }
    
    return await this.metricsCollector.recordJobFailure(jobId, failureData);
  }
  
  /**
   * Update worker metrics - unified interface
   */
  async updateWorkerMetrics(workerId, updateData) {
    if (!this.metricsCollector) {
      throw new Error('MetricsCollector not initialized');
    }
    
    return await this.metricsCollector.updateWorkerMetrics(workerId, updateData);
  }
  
  /**
   * Update queue statistics - unified interface
   */
  async updateQueueStats(queueName, queueData) {
    if (!this.metricsCollector) {
      throw new Error('MetricsCollector not initialized');
    }
    
    return await this.metricsCollector.updateQueueStats(queueName, queueData);
  }
  
  /**
   * Get comprehensive performance report
   */
  async getPerformanceReport(hours = 24) {
    if (!this.metricsCollector) {
      throw new Error('MetricsCollector not initialized');
    }
    
    return await this.metricsCollector.getPerformanceReport(hours);
  }
  
  /**
   * Get real-time metrics
   */
  getRealTimeMetrics() {
    if (!this.metricsCollector) {
      throw new Error('MetricsCollector not initialized');
    }
    
    const metrics = this.metricsCollector.getRealTimeMetrics();
    
    // Add alert information if available
    if (this.alertingSystem) {
      metrics.alerts = {
        recentAlerts: this.alertingSystem.getAlertHistory(1), // Last hour
        alertStats: this.alertingSystem.getAlertStats(24) // Last 24 hours
      };
    }
    
    return metrics;
  }
  
  /**
   * Generate daily report manually
   */
  async generateDailyReport(date = null) {
    if (!this.reportGenerator) {
      throw new Error('PerformanceReportGenerator not initialized');
    }
    
    return await this.reportGenerator.generateDailyReport(date);
  }
  
  /**
   * Get available reports
   */
  async getAvailableReports() {
    if (!this.reportGenerator) {
      throw new Error('PerformanceReportGenerator not initialized');
    }
    
    return await this.reportGenerator.getAvailableReports();
  }
  
  /**
   * Load specific report
   */
  async loadReport(filename) {
    if (!this.reportGenerator) {
      throw new Error('PerformanceReportGenerator not initialized');
    }
    
    return await this.reportGenerator.loadReport(filename);
  }
  
  /**
   * Test alert system
   */
  async testAlert(alertType = 'test') {
    if (!this.alertingSystem) {
      throw new Error('AlertingSystem not initialized');
    }
    
    return await this.alertingSystem.testAlert(alertType);
  }
  
  /**
   * Update alert thresholds
   */
  updateAlertThresholds(newThresholds) {
    if (!this.alertingSystem) {
      throw new Error('AlertingSystem not initialized');
    }
    
    return this.alertingSystem.updateThresholds(newThresholds);
  }
  
  /**
   * Get alert thresholds
   */
  getAlertThresholds() {
    if (!this.alertingSystem) {
      throw new Error('AlertingSystem not initialized');
    }
    
    return this.alertingSystem.getThresholds();
  }
  
  /**
   * Get alert statistics
   */
  getAlertStats(hours = 24) {
    if (!this.alertingSystem) {
      throw new Error('AlertingSystem not initialized');
    }
    
    return this.alertingSystem.getAlertStats(hours);
  }
  
  /**
   * Export metrics data
   */
  async exportMetrics(format = 'json', hours = 24) {
    if (!this.metricsCollector) {
      throw new Error('MetricsCollector not initialized');
    }
    
    return await this.metricsCollector.exportMetrics(format, hours);
  }
  
  /**
   * Clean up old metrics data
   */
  async cleanupOldMetrics() {
    const promises = [];
    
    if (this.metricsCollector) {
      promises.push(this.metricsCollector.cleanupOldMetrics());
    }
    
    if (this.reportGenerator) {
      promises.push(this.reportGenerator.cleanupOldReports());
    }
    
    await Promise.allSettled(promises);
    this.logger.info('Old metrics data cleanup completed');
  }
  
  /**
   * Get service status
   */
  getStatus() {
    return {
      initialized: this.isInitialized,
      running: this.isRunning,
      components: {
        metricsCollector: {
          enabled: this.options.enableMetricsCollection,
          initialized: !!this.metricsCollector,
          collecting: this.metricsCollector?.isCollecting || false
        },
        alertingSystem: {
          enabled: this.options.enableAlerting,
          initialized: !!this.alertingSystem,
          monitoring: this.alertingSystem?.isMonitoring || false
        },
        reportGenerator: {
          enabled: this.options.enableReporting,
          initialized: !!this.reportGenerator,
          scheduled: this.reportGenerator?.isScheduled || false
        }
      },
      websocketIntegration: {
        enabled: this.options.enableWebSocketUpdates,
        connected: !!this.websocketManager
      }
    };
  }
  
  /**
   * Get comprehensive system health
   */
  async getSystemHealth() {
    try {
      const [
        realTimeMetrics,
        performanceReport,
        alertStats
      ] = await Promise.all([
        this.getRealTimeMetrics(),
        this.getPerformanceReport(1), // Last hour
        this.alertingSystem ? this.getAlertStats(1) : null
      ]);
      
      return {
        timestamp: new Date(),
        status: this.getStatus(),
        realTimeMetrics,
        recentPerformance: performanceReport,
        alerts: alertStats,
        systemLoad: {
          activeJobs: realTimeMetrics.activeJobs.length,
          activeWorkers: realTimeMetrics.workerStates.length,
          queueLength: realTimeMetrics.queueStates.reduce((sum, q) => sum + q.waiting, 0)
        }
      };
      
    } catch (error) {
      this.logger.error(`Error getting system health: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Shutdown all services
   */
  async shutdown() {
    try {
      this.logger.info('Shutting down metrics integration service...');
      
      await this.stop();
      
      // Shutdown individual components
      const shutdownPromises = [];
      
      if (this.metricsCollector) {
        shutdownPromises.push(this.metricsCollector.shutdown());
      }
      
      if (this.alertingSystem) {
        shutdownPromises.push(this.alertingSystem.shutdown());
      }
      
      if (this.reportGenerator) {
        shutdownPromises.push(this.reportGenerator.shutdown());
      }
      
      await Promise.allSettled(shutdownPromises);
      
      // Clear references
      this.metricsCollector = null;
      this.alertingSystem = null;
      this.reportGenerator = null;
      this.websocketManager = null;
      
      this.isInitialized = false;
      this.isRunning = false;
      
      this.logger.info('Metrics integration service shutdown complete');
      this.emit('shutdown');
      
    } catch (error) {
      this.logger.error(`Error during shutdown: ${error.message}`);
      throw error;
    }
  }
}

export default MetricsIntegrationService;