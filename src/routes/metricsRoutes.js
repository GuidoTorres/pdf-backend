import express from 'express';
import MetricsController from '../controllers/metricsController.js';
import { authenticateToken } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/adminAuth.js';

const router = express.Router();

/**
 * Metrics API Routes
 * 
 * All routes require authentication, and most require admin privileges
 * for security and to prevent unauthorized access to system metrics.
 */

// Initialize controller (will be set by the main app)
let metricsController = null;

export const initializeMetricsRoutes = (metricsService) => {
  metricsController = new MetricsController(metricsService);
};

// Middleware to ensure controller is initialized
const ensureControllerInitialized = (req, res, next) => {
  if (!metricsController) {
    return res.status(503).json({
      success: false,
      error: 'Metrics service not initialized'
    });
  }
  next();
};

// Apply authentication to all routes
router.use(authenticateToken);
router.use(ensureControllerInitialized);

/**
 * Real-time Metrics Routes
 */

// Get real-time system metrics
// GET /api/metrics/realtime
router.get('/realtime', requireAdmin, async (req, res) => {
  await metricsController.getRealTimeMetrics(req, res);
});

// Get system health overview
// GET /api/metrics/health
router.get('/health', requireAdmin, async (req, res) => {
  await metricsController.getSystemHealth(req, res);
});

// Get service status
// GET /api/metrics/status
router.get('/status', requireAdmin, async (req, res) => {
  await metricsController.getServiceStatus(req, res);
});

/**
 * Performance Report Routes
 */

// Get performance report
// GET /api/metrics/performance?hours=24
router.get('/performance', requireAdmin, async (req, res) => {
  await metricsController.getPerformanceReport(req, res);
});

// Get performance trends
// GET /api/metrics/trends?hours=24
router.get('/trends', requireAdmin, async (req, res) => {
  await metricsController.getPerformanceTrends(req, res);
});

/**
 * Worker Metrics Routes
 */

// Get worker performance metrics
// GET /api/metrics/workers?hours=24
router.get('/workers', requireAdmin, async (req, res) => {
  await metricsController.getWorkerMetrics(req, res);
});

/**
 * Queue Metrics Routes
 */

// Get queue performance metrics
// GET /api/metrics/queues?hours=24
router.get('/queues', requireAdmin, async (req, res) => {
  await metricsController.getQueueMetrics(req, res);
});

/**
 * Alert Management Routes
 */

// Get alert statistics
// GET /api/metrics/alerts/stats?hours=24
router.get('/alerts/stats', requireAdmin, async (req, res) => {
  await metricsController.getAlertStats(req, res);
});

// Get alert thresholds
// GET /api/metrics/alerts/thresholds
router.get('/alerts/thresholds', requireAdmin, async (req, res) => {
  await metricsController.getAlertThresholds(req, res);
});

// Update alert thresholds
// PUT /api/metrics/alerts/thresholds
router.put('/alerts/thresholds', requireAdmin, async (req, res) => {
  await metricsController.updateAlertThresholds(req, res);
});

// Test alert system
// POST /api/metrics/alerts/test
router.post('/alerts/test', requireAdmin, async (req, res) => {
  await metricsController.testAlert(req, res);
});

/**
 * Daily Report Routes
 */

// Get available daily reports
// GET /api/metrics/reports
router.get('/reports', requireAdmin, async (req, res) => {
  await metricsController.getAvailableReports(req, res);
});

// Get specific daily report
// GET /api/metrics/reports/:filename
router.get('/reports/:filename', requireAdmin, async (req, res) => {
  await metricsController.getReport(req, res);
});

// Generate daily report manually
// POST /api/metrics/reports/generate
router.post('/reports/generate', requireAdmin, async (req, res) => {
  await metricsController.generateDailyReport(req, res);
});

/**
 * Data Management Routes
 */

// Export metrics data
// GET /api/metrics/export?format=json&hours=24
router.get('/export', requireAdmin, async (req, res) => {
  await metricsController.exportMetrics(req, res);
});

// Clean up old metrics data
// POST /api/metrics/cleanup
router.post('/cleanup', requireAdmin, async (req, res) => {
  await metricsController.cleanupOldMetrics(req, res);
});

/**
 * Public/Limited Access Routes (for dashboard widgets)
 */

// Basic system status (limited info for non-admin users)
// GET /api/metrics/dashboard/status
router.get('/dashboard/status', async (req, res) => {
  try {
    // Provide limited status information for dashboard widgets
    const realTimeMetrics = metricsController.metricsService.getRealTimeMetrics();
    
    const limitedStatus = {
      activeJobs: realTimeMetrics.activeJobs.length,
      activeWorkers: realTimeMetrics.workerStates.length,
      totalQueued: realTimeMetrics.queueStates.reduce((sum, q) => sum + q.waiting, 0),
      systemLoad: realTimeMetrics.systemMetrics.loadAverage[0],
      timestamp: new Date()
    };
    
    res.json({
      success: true,
      data: limitedStatus
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve dashboard status'
    });
  }
});

// Basic performance summary (limited info for non-admin users)
// GET /api/metrics/dashboard/summary
router.get('/dashboard/summary', async (req, res) => {
  try {
    const report = await metricsController.metricsService.getPerformanceReport(1); // Last hour
    
    const summary = {
      jobsProcessed: report.summary.totalJobs,
      successRate: report.summary.successRate,
      avgProcessingTime: report.summary.avgProcessingTime,
      timestamp: new Date()
    };
    
    res.json({
      success: true,
      data: summary
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve dashboard summary'
    });
  }
});

/**
 * Error Handling Middleware
 */
router.use((error, req, res, next) => {
  console.error(`[MetricsRoutes] Error: ${error.message}`);
  
  res.status(500).json({
    success: false,
    error: 'Internal server error in metrics API',
    message: process.env.NODE_ENV === 'development' ? error.message : 'An error occurred'
  });
});

export { router as metricsRoutes };
export default router;