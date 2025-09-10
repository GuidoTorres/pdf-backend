import express from 'express';
import { getQueueStats, getQueueDetails, getSystemHealth } from '../controllers/queueController.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

/**
 * @route GET /api/queue/stats
 * @desc Get statistics for all queues
 * @access Private (requires authentication)
 */
router.get('/stats', authenticateToken, getQueueStats);

/**
 * @route GET /api/queue/details/:queueName
 * @desc Get detailed information for a specific queue
 * @access Private (requires authentication)
 * @param {string} queueName - Name of the queue (premium, normal, large)
 */
router.get('/details/:queueName', authenticateToken, getQueueDetails);

/**
 * @route GET /api/queue/health
 * @desc Get system health status and recommendations
 * @access Private (requires authentication)
 */
router.get('/health', authenticateToken, getSystemHealth);

export default router;