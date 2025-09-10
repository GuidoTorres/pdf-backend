import express from 'express';
import dashboardService from '../services/dashboardService.js';
import webSocketManager from '../services/websocketManager.js';
import timeEstimationService from '../services/timeEstimationService.js';
import { authenticateToken } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/adminAuth.js';
import logService from '../services/logService.js';

const router = express.Router();

/**
 * Get current dashboard metrics
 * GET /api/dashboard/metrics
 */
router.get('/metrics', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const metrics = await dashboardService.collectCurrentMetrics();
    res.json({
      success: true,
      data: metrics
    });
  } catch (error) {
    logService.error('Error getting dashboard metrics:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get dashboard metrics'
    });
  }
});

/**
 * Get historical metrics
 * GET /api/dashboard/metrics/history?timeRange=1h|6h|24h
 */
router.get('/metrics/history', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { timeRange = '1h' } = req.query;
    const metrics = dashboardService.getHistoricalMetrics(timeRange);
    
    res.json({
      success: true,
      data: {
        metrics,
        timeRange,
        count: metrics.length
      }
    });
  } catch (error) {
    logService.error('Error getting historical metrics:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get historical metrics'
    });
  }
});

/**
 * Get performance summary
 * GET /api/dashboard/performance?timeRange=1h|6h|24h
 */
router.get('/performance', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { timeRange = '1h' } = req.query;
    const summary = dashboardService.getPerformanceSummary(timeRange);
    
    res.json({
      success: true,
      data: summary
    });
  } catch (error) {
    logService.error('Error getting performance summary:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get performance summary'
    });
  }
});

/**
 * Get queue analytics
 * GET /api/dashboard/analytics/queues
 */
router.get('/analytics/queues', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const analytics = dashboardService.getQueueAnalytics();
    
    res.json({
      success: true,
      data: analytics
    });
  } catch (error) {
    logService.error('Error getting queue analytics:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get queue analytics'
    });
  }
});

/**
 * Get active alerts
 * GET /api/dashboard/alerts
 */
router.get('/alerts', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const alerts = dashboardService.getActiveAlerts();
    
    res.json({
      success: true,
      data: alerts
    });
  } catch (error) {
    logService.error('Error getting alerts:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get alerts'
    });
  }
});

/**
 * Update alert thresholds
 * PUT /api/dashboard/thresholds
 */
router.put('/thresholds', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { thresholds } = req.body;
    
    if (!thresholds || typeof thresholds !== 'object') {
      return res.status(400).json({
        success: false,
        error: 'Invalid thresholds data'
      });
    }
    
    dashboardService.updateThresholds(thresholds);
    
    res.json({
      success: true,
      message: 'Thresholds updated successfully'
    });
  } catch (error) {
    logService.error('Error updating thresholds:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update thresholds'
    });
  }
});

/**
 * Get WebSocket connection status
 * GET /api/dashboard/websocket/status
 */
router.get('/websocket/status', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const status = {
      connectedUsers: webSocketManager.getConnectedUsersCount(),
      connectedAdmins: webSocketManager.getConnectedAdminsCount(),
      isActive: webSocketManager.getIO() !== null
    };
    
    res.json({
      success: true,
      data: status
    });
  } catch (error) {
    logService.error('Error getting WebSocket status:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get WebSocket status'
    });
  }
});

/**
 * Get time estimation statistics
 * GET /api/dashboard/estimation/stats
 */
router.get('/estimation/stats', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const stats = timeEstimationService.getEstimationStatistics();
    
    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    logService.error('Error getting estimation stats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get estimation statistics'
    });
  }
});

/**
 * Test time estimation for given parameters
 * POST /api/dashboard/estimation/test
 */
router.post('/estimation/test', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { fileSize, priority, currentQueueLength } = req.body;
    
    if (!fileSize || !priority) {
      return res.status(400).json({
        success: false,
        error: 'fileSize and priority are required'
      });
    }
    
    const estimation = timeEstimationService.estimateProcessingTime({
      fileSize: parseInt(fileSize),
      priority,
      currentQueueLength: parseInt(currentQueueLength) || 0
    });
    
    res.json({
      success: true,
      data: estimation
    });
  } catch (error) {
    logService.error('Error testing time estimation:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to test time estimation'
    });
  }
});

/**
 * Get dashboard service status
 * GET /api/dashboard/status
 */
router.get('/status', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const status = dashboardService.getStatus();
    
    res.json({
      success: true,
      data: status
    });
  } catch (error) {
    logService.error('Error getting dashboard status:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get dashboard status'
    });
  }
});

/**
 * Start dashboard metrics collection
 * POST /api/dashboard/start
 */
router.post('/start', authenticateToken, requireAdmin, async (req, res) => {
  try {
    dashboardService.startMetricsCollection();
    
    res.json({
      success: true,
      message: 'Dashboard metrics collection started'
    });
  } catch (error) {
    logService.error('Error starting dashboard:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to start dashboard metrics collection'
    });
  }
});

/**
 * Stop dashboard metrics collection
 * POST /api/dashboard/stop
 */
router.post('/stop', authenticateToken, requireAdmin, async (req, res) => {
  try {
    dashboardService.stopMetricsCollection();
    
    res.json({
      success: true,
      message: 'Dashboard metrics collection stopped'
    });
  } catch (error) {
    logService.error('Error stopping dashboard:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to stop dashboard metrics collection'
    });
  }
});

/**
 * Broadcast test message to WebSocket clients
 * POST /api/dashboard/websocket/test
 */
router.post('/websocket/test', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { message, targetType = 'all' } = req.body;
    
    const testData = {
      type: 'test-message',
      message: message || 'Test message from dashboard',
      timestamp: new Date().toISOString()
    };
    
    if (targetType === 'admins') {
      webSocketManager.getIO()?.emit('admin-test', testData);
    } else {
      webSocketManager.getIO()?.emit('test-message', testData);
    }
    
    res.json({
      success: true,
      message: 'Test message broadcasted',
      data: testData
    });
  } catch (error) {
    logService.error('Error broadcasting test message:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to broadcast test message'
    });
  }
});

export default router;