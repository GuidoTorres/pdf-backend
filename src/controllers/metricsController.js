import MetricsIntegrationService from '../services/metricsIntegrationService.js';

/**
 * MetricsController - API endpoints for metrics and performance data
 * 
 * Provides REST API endpoints for:
 * - Real-time metrics
 * - Performance reports
 * - Alert management
 * - System health monitoring
 */
class MetricsController {
  constructor(metricsService) {
    this.metricsService = metricsService;
    this.logger = this.setupLogger();
  }
  
  setupLogger() {
    return {
      info: (msg) => console.log(`[MetricsController] ${msg}`),
      error: (msg) => console.error(`[MetricsController] ${msg}`),
      debug: (msg) => console.log(`[MetricsController] ${msg}`),
      warn: (msg) => console.warn(`[MetricsController] ${msg}`)
    };
  }
  
  /**
   * Get real-time system metrics
   * GET /api/metrics/realtime
   */
  async getRealTimeMetrics(req, res) {
    try {
      const metrics = this.metricsService.getRealTimeMetrics();
      
      res.json({
        success: true,
        data: metrics,
        timestamp: new Date()
      });
      
    } catch (error) {
      this.logger.error(`Error getting real-time metrics: ${error.message}`);
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve real-time metrics',
        message: error.message
      });
    }
  }
  
  /**
   * Get performance report
   * GET /api/metrics/performance?hours=24
   */
  async getPerformanceReport(req, res) {
    try {
      const hours = parseInt(req.query.hours) || 24;
      
      if (hours < 1 || hours > 168) { // Max 1 week
        return res.status(400).json({
          success: false,
          error: 'Invalid hours parameter. Must be between 1 and 168.'
        });
      }
      
      const report = await this.metricsService.getPerformanceReport(hours);
      
      res.json({
        success: true,
        data: report,
        timeRange: `${hours} hours`
      });
      
    } catch (error) {
      this.logger.error(`Error getting performance report: ${error.message}`);
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve performance report',
        message: error.message
      });
    }
  }
  
  /**
   * Get system health overview
   * GET /api/metrics/health
   */
  async getSystemHealth(req, res) {
    try {
      const health = await this.metricsService.getSystemHealth();
      
      res.json({
        success: true,
        data: health
      });
      
    } catch (error) {
      this.logger.error(`Error getting system health: ${error.message}`);
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve system health',
        message: error.message
      });
    }
  }
  
  /**
   * Get service status
   * GET /api/metrics/status
   */
  async getServiceStatus(req, res) {
    try {
      const status = this.metricsService.getStatus();
      
      res.json({
        success: true,
        data: status
      });
      
    } catch (error) {
      this.logger.error(`Error getting service status: ${error.message}`);
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve service status',
        message: error.message
      });
    }
  }
  
  /**
   * Get alert statistics
   * GET /api/metrics/alerts/stats?hours=24
   */
  async getAlertStats(req, res) {
    try {
      const hours = parseInt(req.query.hours) || 24;
      
      if (hours < 1 || hours > 168) {
        return res.status(400).json({
          success: false,
          error: 'Invalid hours parameter. Must be between 1 and 168.'
        });
      }
      
      const stats = this.metricsService.getAlertStats(hours);
      
      res.json({
        success: true,
        data: stats,
        timeRange: `${hours} hours`
      });
      
    } catch (error) {
      this.logger.error(`Error getting alert stats: ${error.message}`);
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve alert statistics',
        message: error.message
      });
    }
  }
  
  /**
   * Get alert thresholds
   * GET /api/metrics/alerts/thresholds
   */
  async getAlertThresholds(req, res) {
    try {
      const thresholds = this.metricsService.getAlertThresholds();
      
      res.json({
        success: true,
        data: thresholds
      });
      
    } catch (error) {
      this.logger.error(`Error getting alert thresholds: ${error.message}`);
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve alert thresholds',
        message: error.message
      });
    }
  }
  
  /**
   * Update alert thresholds
   * PUT /api/metrics/alerts/thresholds
   */
  async updateAlertThresholds(req, res) {
    try {
      const newThresholds = req.body;
      
      // Validate thresholds
      const validThresholds = this.validateThresholds(newThresholds);
      if (!validThresholds.isValid) {
        return res.status(400).json({
          success: false,
          error: 'Invalid threshold values',
          details: validThresholds.errors
        });
      }
      
      this.metricsService.updateAlertThresholds(newThresholds);
      
      res.json({
        success: true,
        message: 'Alert thresholds updated successfully',
        data: this.metricsService.getAlertThresholds()
      });
      
    } catch (error) {
      this.logger.error(`Error updating alert thresholds: ${error.message}`);
      res.status(500).json({
        success: false,
        error: 'Failed to update alert thresholds',
        message: error.message
      });
    }
  }
  
  /**
   * Test alert system
   * POST /api/metrics/alerts/test
   */
  async testAlert(req, res) {
    try {
      const alertType = req.body.type || 'test';
      
      await this.metricsService.testAlert(alertType);
      
      res.json({
        success: true,
        message: 'Test alert sent successfully'
      });
      
    } catch (error) {
      this.logger.error(`Error testing alert: ${error.message}`);
      res.status(500).json({
        success: false,
        error: 'Failed to send test alert',
        message: error.message
      });
    }
  }
  
  /**
   * Get available daily reports
   * GET /api/metrics/reports
   */
  async getAvailableReports(req, res) {
    try {
      const reports = await this.metricsService.getAvailableReports();
      
      res.json({
        success: true,
        data: reports
      });
      
    } catch (error) {
      this.logger.error(`Error getting available reports: ${error.message}`);
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve available reports',
        message: error.message
      });
    }
  }
  
  /**
   * Get specific daily report
   * GET /api/metrics/reports/:filename
   */
  async getReport(req, res) {
    try {
      const { filename } = req.params;
      
      // Validate filename
      if (!filename.match(/^daily-report-\d{4}-\d{2}-\d{2}\.json$/)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid report filename format'
        });
      }
      
      const report = await this.metricsService.loadReport(filename);
      
      res.json({
        success: true,
        data: report
      });
      
    } catch (error) {
      this.logger.error(`Error getting report: ${error.message}`);
      res.status(404).json({
        success: false,
        error: 'Report not found',
        message: error.message
      });
    }
  }
  
  /**
   * Generate daily report manually
   * POST /api/metrics/reports/generate
   */
  async generateDailyReport(req, res) {
    try {
      const dateStr = req.body.date;
      let date = null;
      
      if (dateStr) {
        date = new Date(dateStr);
        if (isNaN(date.getTime())) {
          return res.status(400).json({
            success: false,
            error: 'Invalid date format. Use YYYY-MM-DD.'
          });
        }
      }
      
      const report = await this.metricsService.generateDailyReport(date);
      
      res.json({
        success: true,
        message: 'Daily report generated successfully',
        data: {
          reportDate: report.metadata.reportDate,
          generatedAt: report.metadata.generatedAt,
          summary: report.executive_summary
        }
      });
      
    } catch (error) {
      this.logger.error(`Error generating daily report: ${error.message}`);
      res.status(500).json({
        success: false,
        error: 'Failed to generate daily report',
        message: error.message
      });
    }
  }
  
  /**
   * Export metrics data
   * GET /api/metrics/export?format=json&hours=24
   */
  async exportMetrics(req, res) {
    try {
      const format = req.query.format || 'json';
      const hours = parseInt(req.query.hours) || 24;
      
      if (!['json', 'csv'].includes(format)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid format. Supported formats: json, csv'
        });
      }
      
      if (hours < 1 || hours > 168) {
        return res.status(400).json({
          success: false,
          error: 'Invalid hours parameter. Must be between 1 and 168.'
        });
      }
      
      const exportData = await this.metricsService.exportMetrics(format, hours);
      
      // Set appropriate headers
      const timestamp = new Date().toISOString().split('T')[0];
      const filename = `metrics-export-${timestamp}.${format}`;
      
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Type', format === 'json' ? 'application/json' : 'text/csv');
      
      res.send(exportData);
      
    } catch (error) {
      this.logger.error(`Error exporting metrics: ${error.message}`);
      res.status(500).json({
        success: false,
        error: 'Failed to export metrics',
        message: error.message
      });
    }
  }
  
  /**
   * Clean up old metrics data
   * POST /api/metrics/cleanup
   */
  async cleanupOldMetrics(req, res) {
    try {
      await this.metricsService.cleanupOldMetrics();
      
      res.json({
        success: true,
        message: 'Old metrics data cleanup completed successfully'
      });
      
    } catch (error) {
      this.logger.error(`Error cleaning up metrics: ${error.message}`);
      res.status(500).json({
        success: false,
        error: 'Failed to cleanup old metrics',
        message: error.message
      });
    }
  }
  
  /**
   * Get worker performance metrics
   * GET /api/metrics/workers?hours=24
   */
  async getWorkerMetrics(req, res) {
    try {
      const hours = parseInt(req.query.hours) || 24;
      
      if (hours < 1 || hours > 168) {
        return res.status(400).json({
          success: false,
          error: 'Invalid hours parameter. Must be between 1 and 168.'
        });
      }
      
      const report = await this.metricsService.getPerformanceReport(hours);
      
      res.json({
        success: true,
        data: {
          workers: report.performance.workers,
          system: report.system,
          timeRange: `${hours} hours`
        }
      });
      
    } catch (error) {
      this.logger.error(`Error getting worker metrics: ${error.message}`);
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve worker metrics',
        message: error.message
      });
    }
  }
  
  /**
   * Get queue performance metrics
   * GET /api/metrics/queues?hours=24
   */
  async getQueueMetrics(req, res) {
    try {
      const hours = parseInt(req.query.hours) || 24;
      
      if (hours < 1 || hours > 168) {
        return res.status(400).json({
          success: false,
          error: 'Invalid hours parameter. Must be between 1 and 168.'
        });
      }
      
      const report = await this.metricsService.getPerformanceReport(hours);
      
      res.json({
        success: true,
        data: {
          queues: report.queues,
          timeRange: `${hours} hours`
        }
      });
      
    } catch (error) {
      this.logger.error(`Error getting queue metrics: ${error.message}`);
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve queue metrics',
        message: error.message
      });
    }
  }
  
  /**
   * Get job performance trends
   * GET /api/metrics/trends?hours=24
   */
  async getPerformanceTrends(req, res) {
    try {
      const hours = parseInt(req.query.hours) || 24;
      
      if (hours < 1 || hours > 168) {
        return res.status(400).json({
          success: false,
          error: 'Invalid hours parameter. Must be between 1 and 168.'
        });
      }
      
      const report = await this.metricsService.getPerformanceReport(hours);
      
      res.json({
        success: true,
        data: {
          hourlyTrends: report.performance.hourlyTrends,
          summary: report.summary,
          timeRange: `${hours} hours`
        }
      });
      
    } catch (error) {
      this.logger.error(`Error getting performance trends: ${error.message}`);
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve performance trends',
        message: error.message
      });
    }
  }
  
  /**
   * Validate threshold values
   */
  validateThresholds(thresholds) {
    const errors = [];
    
    // Define valid threshold ranges
    const validRanges = {
      avgProcessingTime: { min: 1, max: 600 }, // 1 second to 10 minutes
      avgWaitTime: { min: 1, max: 300 }, // 1 second to 5 minutes
      successRate: { min: 50, max: 100 }, // 50% to 100%
      memoryUsage: { min: 10, max: 100 }, // 10% to 100%
      cpuUsage: { min: 10, max: 100 }, // 10% to 100%
      queueLength: { min: 1, max: 1000 }, // 1 to 1000 jobs
      errorRate: { min: 0, max: 50 }, // 0% to 50%
      errorSpike: { min: 1, max: 100 } // 1 to 100 errors
    };
    
    for (const [key, value] of Object.entries(thresholds)) {
      if (validRanges[key]) {
        const range = validRanges[key];
        if (typeof value !== 'number' || value < range.min || value > range.max) {
          errors.push(`${key} must be a number between ${range.min} and ${range.max}`);
        }
      }
    }
    
    return {
      isValid: errors.length === 0,
      errors
    };
  }
}

export default MetricsController;