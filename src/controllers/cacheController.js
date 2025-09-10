import { getCacheStatistics, optimizeCache, clearCache } from '../workers/cachedPdfProcessor.js';
import logService from '../services/logService.js';

/**
 * Cache Controller
 * 
 * Provides API endpoints for cache management and monitoring
 */

/**
 * Get cache statistics
 */
async function getCacheStats(req, res) {
  try {
    const stats = await getCacheStatistics();
    
    logService.log('[CACHE_CONTROLLER] Cache statistics requested', {
      userId: req.user?.id,
      hitRatio: stats.integration.hitRatio,
      totalEntries: stats.cache.cacheStats.totalEntries
    });
    
    res.json({
      success: true,
      data: stats
    });
    
  } catch (error) {
    logService.error('[CACHE_CONTROLLER] Failed to get cache statistics:', error);
    res.status(500).json({
      error: 'Failed to retrieve cache statistics',
      details: error.message
    });
  }
}

/**
 * Optimize cache (remove old/low-value entries)
 */
async function optimizeCacheEndpoint(req, res) {
  try {
    await optimizeCache();
    
    logService.log('[CACHE_CONTROLLER] Cache optimization triggered', {
      userId: req.user?.id
    });
    
    res.json({
      success: true,
      message: 'Cache optimization completed successfully'
    });
    
  } catch (error) {
    logService.error('[CACHE_CONTROLLER] Failed to optimize cache:', error);
    res.status(500).json({
      error: 'Failed to optimize cache',
      details: error.message
    });
  }
}

/**
 * Clear cache
 */
async function clearCacheEndpoint(req, res) {
  try {
    const { memoryOnly = false } = req.body;
    
    await clearCache(memoryOnly);
    
    logService.log('[CACHE_CONTROLLER] Cache cleared', {
      userId: req.user?.id,
      memoryOnly
    });
    
    res.json({
      success: true,
      message: `Cache cleared successfully (${memoryOnly ? 'memory only' : 'memory and disk'})`
    });
    
  } catch (error) {
    logService.error('[CACHE_CONTROLLER] Failed to clear cache:', error);
    res.status(500).json({
      error: 'Failed to clear cache',
      details: error.message
    });
  }
}

/**
 * Get cache health status
 */
async function getCacheHealth(req, res) {
  try {
    const stats = await getCacheStatistics();
    
    // Determine cache health based on various metrics
    const health = {
      status: 'healthy',
      issues: [],
      recommendations: []
    };
    
    // Check hit ratio
    if (stats.integration.hitRatio < 0.1) {
      health.issues.push('Low cache hit ratio');
      health.recommendations.push('Consider adjusting cache configuration or processing patterns');
    }
    
    // Check memory usage
    if (stats.cache.cacheStats.memoryUsageMB > 500) {
      health.issues.push('High memory usage');
      health.recommendations.push('Consider reducing max memory entries or optimizing cache');
    }
    
    // Check disk usage
    if (stats.cache.cacheStats.diskUsageMB > 1000) {
      health.issues.push('High disk usage');
      health.recommendations.push('Consider reducing max disk entries or clearing old cache');
    }
    
    // Check entry age
    const maxAgeHours = 24 * 7; // 7 days
    if (stats.cache.cacheStats.oldestEntryAge > maxAgeHours * 60 * 60 * 1000) {
      health.issues.push('Very old cache entries detected');
      health.recommendations.push('Run cache optimization to remove stale entries');
    }
    
    // Determine overall status
    if (health.issues.length > 2) {
      health.status = 'unhealthy';
    } else if (health.issues.length > 0) {
      health.status = 'warning';
    }
    
    res.json({
      success: true,
      data: {
        health,
        stats: stats.cache.cacheStats,
        lastCheck: new Date().toISOString()
      }
    });
    
  } catch (error) {
    logService.error('[CACHE_CONTROLLER] Failed to get cache health:', error);
    res.status(500).json({
      error: 'Failed to retrieve cache health',
      details: error.message
    });
  }
}

/**
 * Get cache configuration
 */
async function getCacheConfig(req, res) {
  try {
    const stats = await getCacheStatistics();
    
    res.json({
      success: true,
      data: {
        config: stats.cache.config,
        limits: {
          maxMemoryEntries: stats.cache.config.maxMemoryEntries,
          maxDiskEntries: stats.cache.config.maxDiskEntries,
          maxCacheAge: stats.cache.config.maxCacheAge,
          minProcessingTimeForCache: stats.cache.config.minProcessingTimeForCache,
          minConfidenceForCache: stats.cache.config.minConfidenceForCache
        },
        currentUsage: {
          memoryEntries: stats.cache.memoryCacheSize,
          diskEntries: stats.cache.diskCacheSize,
          memoryUsageMB: stats.cache.cacheStats.memoryUsageMB,
          diskUsageMB: stats.cache.cacheStats.diskUsageMB
        }
      }
    });
    
  } catch (error) {
    logService.error('[CACHE_CONTROLLER] Failed to get cache configuration:', error);
    res.status(500).json({
      error: 'Failed to retrieve cache configuration',
      details: error.message
    });
  }
}

/**
 * Get cache performance metrics
 */
async function getCachePerformance(req, res) {
  try {
    const stats = await getCacheStatistics();
    
    const performance = {
      hitRatio: stats.integration.hitRatio,
      missRatio: 1 - stats.integration.hitRatio,
      skipRatio: stats.integration.skipRatio,
      totalRequests: stats.integration.totalRequests,
      cacheHits: stats.integration.cacheHits,
      cacheMisses: stats.integration.cacheMisses,
      cacheSkips: stats.integration.cacheSkips,
      processingTimeSaved: stats.integration.processingTimeSaved,
      averageAccessTime: stats.cache.cacheStats.averageAccessTime,
      efficiency: {
        timeEfficiency: stats.integration.processingTimeSaved / Math.max(1, stats.integration.totalRequests),
        storageEfficiency: stats.cache.cacheStats.totalEntries / Math.max(1, stats.cache.config.maxMemoryEntries + stats.cache.config.maxDiskEntries),
        hitEfficiency: stats.integration.cacheHits / Math.max(1, stats.integration.totalRequests)
      }
    };
    
    res.json({
      success: true,
      data: performance
    });
    
  } catch (error) {
    logService.error('[CACHE_CONTROLLER] Failed to get cache performance:', error);
    res.status(500).json({
      error: 'Failed to retrieve cache performance metrics',
      details: error.message
    });
  }
}

export {
  getCacheStats,
  optimizeCacheEndpoint,
  clearCacheEndpoint,
  getCacheHealth,
  getCacheConfig,
  getCachePerformance
};

export default {
  getCacheStats,
  optimizeCacheEndpoint,
  clearCacheEndpoint,
  getCacheHealth,
  getCacheConfig,
  getCachePerformance
};