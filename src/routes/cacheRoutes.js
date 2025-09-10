import express from 'express';
import cacheController from '../controllers/cacheController.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

/**
 * Cache Management Routes
 * 
 * All routes require authentication and are intended for administrative use
 */

// Get cache statistics
router.get('/stats', authenticateToken, cacheController.getCacheStats);

// Get cache health status
router.get('/health', authenticateToken, cacheController.getCacheHealth);

// Get cache configuration
router.get('/config', authenticateToken, cacheController.getCacheConfig);

// Get cache performance metrics
router.get('/performance', authenticateToken, cacheController.getCachePerformance);

// Optimize cache (remove old/low-value entries)
router.post('/optimize', authenticateToken, cacheController.optimizeCacheEndpoint);

// Clear cache
router.post('/clear', authenticateToken, cacheController.clearCacheEndpoint);

export default router;