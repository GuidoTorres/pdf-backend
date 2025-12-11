import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/adminAuth.js';
import adminController from '../controllers/adminController.js';
import logService from '../services/logService.js';

const router = express.Router();

// Middleware para todas las rutas de admin
router.use(authenticateToken);
router.use(requireAdmin);

/**
 * Get admin dashboard overview
 * GET /api/admin/dashboard
 */
router.get('/dashboard', adminController.getDashboardOverview);

/**
 * Get user statistics
 * GET /api/admin/users/stats
 */
router.get('/users/stats', adminController.getUserStats);

/**
 * Get all users with pagination
 * GET /api/admin/users?page=1&limit=10&search=email
 */
router.get('/users', adminController.getUsers);

/**
 * Get specific user details
 * GET /api/admin/users/:userId
 */
router.get('/users/:userId', adminController.getUserDetails);

/**
 * Update user status (activate/deactivate)
 * PUT /api/admin/users/:userId/status
 */
router.put('/users/:userId/status', adminController.updateUserStatus);

/**
 * Delete user
 * DELETE /api/admin/users/:userId
 */
router.delete('/users/:userId', adminController.deleteUser);

/**
 * Get document processing statistics
 * GET /api/admin/documents/stats
 */
router.get('/documents/stats', adminController.getDocumentStats);

/**
 * Get all documents with pagination and filters
 * GET /api/admin/documents?page=1&limit=10&status=completed&userId=123
 */
router.get('/documents', adminController.getDocuments);

/**
 * Get specific document details
 * GET /api/admin/documents/:documentId
 */
router.get('/documents/:documentId', adminController.getDocumentDetails);

/**
 * Delete document
 * DELETE /api/admin/documents/:documentId
 */
router.delete('/documents/:documentId', adminController.deleteDocument);

/**
 * Get system analytics
 * GET /api/admin/analytics?timeRange=7d&metric=usage
 */
router.get('/analytics', adminController.getSystemAnalytics);

/**
 * Get revenue and subscription statistics
 * GET /api/admin/revenue/stats
 */
router.get('/revenue/stats', adminController.getRevenueStats);

/**
 * Get subscription analytics
 * GET /api/admin/subscriptions/stats
 */
router.get('/subscriptions/stats', adminController.getSubscriptionStats);

/**
 * Get system health and performance
 * GET /api/admin/system/health
 */
router.get('/system/health', adminController.getSystemHealth);
router.get('/system/metrics-processing', adminController.getProcessingMetrics);

/**
 * Get error logs and system issues
 * GET /api/admin/system/logs?level=error&limit=50
 */
router.get('/system/logs', adminController.getSystemLogs);

/**
 * Get API usage statistics
 * GET /api/admin/api/usage
 */
router.get('/api/usage', adminController.getApiUsage);

/**
 * Export data (users, documents, analytics)
 * POST /api/admin/export
 */
router.post('/export', adminController.exportData);

/**
 * Send system notification to users
 * POST /api/admin/notifications
 */
router.post('/notifications', adminController.sendNotification);

/**
 * Get admin activity log
 * GET /api/admin/activity
 */
router.get('/activity', adminController.getAdminActivity);

export default router;
