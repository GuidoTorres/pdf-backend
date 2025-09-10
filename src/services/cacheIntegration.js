import IntelligentCache from './intelligentCache.js';
import path from 'path';
import fs from 'fs/promises';

/**
 * Cache Integration Service
 * 
 * This service integrates the intelligent cache with the PDF processing workflow
 * to avoid redundant processing of identical documents.
 */
class CacheIntegration {
  constructor(options = {}) {
    this.config = {
      // Cache configuration
      maxMemoryEntries: options.maxMemoryEntries || 50,
      maxDiskEntries: options.maxDiskEntries || 100,
      cacheDir: options.cacheDir || path.join(process.cwd(), 'temp', 'pdf-cache'),
      enableDiskCache: options.enableDiskCache !== false,
      debug: options.debug || false,
      
      // Processing configuration
      enableCaching: options.enableCaching !== false,
      minProcessingTimeForCache: options.minProcessingTimeForCache || 5000, // 5 seconds
      minConfidenceForCache: options.minConfidenceForCache || 0.7,
      
      ...options
    };

    // Initialize cache
    this.cache = new IntelligentCache({
      maxMemoryEntries: this.config.maxMemoryEntries,
      maxDiskEntries: this.config.maxDiskEntries,
      cacheDir: this.config.cacheDir,
      enableDiskCache: this.config.enableDiskCache,
      debug: this.config.debug
    });

    // Statistics
    this.stats = {
      totalRequests: 0,
      cacheHits: 0,
      cacheMisses: 0,
      cacheSkips: 0,
      processingTimeSaved: 0,
      lastOptimization: null
    };

    this.isInitialized = false;
    this.setupEventHandlers();
  }

  /**
   * Initialize the cache integration service
   */
  async initialize() {
    if (this.isInitialized) {
      return;
    }

    try {
      await this.cache.initialize();
      this.isInitialized = true;
      
      if (this.config.debug) {
        console.log('[CACHE_INTEGRATION] Initialized successfully');
      }
      
    } catch (error) {
      console.error('[CACHE_INTEGRATION] Failed to initialize:', error);
      throw error;
    }
  }

  /**
   * Process a PDF with cache integration
   * @param {string} filePath - Path to the PDF file
   * @param {Function} processingFunction - Function to process the PDF if not cached
   * @param {Object} options - Processing options
   * @returns {Promise<Object>} Processing result
   */
  async processWithCache(filePath, processingFunction, options = {}) {
    if (!this.isInitialized) {
      throw new Error('CacheIntegration not initialized');
    }

    if (!this.config.enableCaching) {
      // Cache disabled, process directly
      return await this.processDirectly(filePath, processingFunction, options);
    }

    const startTime = Date.now();
    this.stats.totalRequests++;

    try {
      // Check if file exists
      await fs.access(filePath);
      
      // Try to get cached result
      const cachedResult = await this.cache.get(filePath);
      
      if (cachedResult) {
        // Cache hit
        this.stats.cacheHits++;
        const processingTime = cachedResult.processingTime || 0;
        this.stats.processingTimeSaved += processingTime;
        
        if (this.config.debug) {
          console.log(`[CACHE_INTEGRATION] Cache hit for ${path.basename(filePath)}, saved ${processingTime}ms`);
        }
        
        return {
          ...cachedResult,
          fromCache: true,
          cacheHit: true,
          originalProcessingTime: processingTime,
          cacheAccessTime: Date.now() - startTime
        };
      }
      
      // Cache miss, process the document
      this.stats.cacheMisses++;
      
      if (this.config.debug) {
        console.log(`[CACHE_INTEGRATION] Cache miss for ${path.basename(filePath)}, processing...`);
      }
      
      const processingStartTime = Date.now();
      const result = await processingFunction(filePath, options);
      const processingTime = Date.now() - processingStartTime;
      
      // Determine if result should be cached
      const shouldCache = this.shouldCacheResult(result, processingTime, options);
      
      if (shouldCache) {
        // Cache the result
        const confidenceScore = this.calculateConfidenceScore(result, processingTime);
        const metadata = this.extractMetadata(result, options);
        
        await this.cache.put(
          filePath,
          result,
          processingTime,
          confidenceScore,
          metadata
        );
        
        if (this.config.debug) {
          console.log(`[CACHE_INTEGRATION] Cached result for ${path.basename(filePath)} (confidence: ${confidenceScore.toFixed(2)})`);
        }
      } else {
        this.stats.cacheSkips++;
        
        if (this.config.debug) {
          console.log(`[CACHE_INTEGRATION] Skipped caching for ${path.basename(filePath)} (low confidence or fast processing)`);
        }
      }
      
      return {
        ...result,
        fromCache: false,
        cacheHit: false,
        processingTime,
        cached: shouldCache
      };
      
    } catch (error) {
      console.error(`[CACHE_INTEGRATION] Error processing ${filePath}:`, error);
      throw error;
    }
  }

  /**
   * Process directly without cache (fallback)
   * @param {string} filePath - Path to the PDF file
   * @param {Function} processingFunction - Function to process the PDF
   * @param {Object} options - Processing options
   * @returns {Promise<Object>} Processing result
   */
  async processDirectly(filePath, processingFunction, options = {}) {
    const startTime = Date.now();
    const result = await processingFunction(filePath, options);
    const processingTime = Date.now() - startTime;
    
    return {
      ...result,
      fromCache: false,
      cacheHit: false,
      processingTime,
      cached: false
    };
  }

  /**
   * Determine if a result should be cached
   * @param {Object} result - Processing result
   * @param {number} processingTime - Time taken to process
   * @param {Object} options - Processing options
   * @returns {boolean} True if result should be cached
   */
  shouldCacheResult(result, processingTime, options = {}) {
    // Don't cache if processing was too fast (likely an error or simple document)
    if (processingTime < this.config.minProcessingTimeForCache) {
      return false;
    }
    
    // Don't cache if result indicates failure
    if (result.success === false || result.error) {
      return false;
    }
    
    // Don't cache if no meaningful content was extracted
    if (!result.transactions || !Array.isArray(result.transactions) || result.transactions.length === 0) {
      return false;
    }
    
    // Calculate confidence score
    const confidenceScore = this.calculateConfidenceScore(result, processingTime);
    
    // Don't cache if confidence is too low
    if (confidenceScore < this.config.minConfidenceForCache) {
      return false;
    }
    
    // Cache if all conditions are met
    return true;
  }

  /**
   * Calculate confidence score for a processing result
   * @param {Object} result - Processing result
   * @param {number} processingTime - Time taken to process
   * @returns {number} Confidence score between 0 and 1
   */
  calculateConfidenceScore(result, processingTime) {
    let confidence = 0.5; // Base confidence
    
    // Increase confidence based on successful processing
    if (result.success !== false && !result.error) {
      confidence += 0.2;
    }
    
    // Increase confidence based on extracted transactions
    if (result.transactions && Array.isArray(result.transactions)) {
      const transactionCount = result.transactions.length;
      if (transactionCount > 0) {
        confidence += Math.min(0.2, transactionCount * 0.05); // Up to 0.2 for many transactions
      }
    }
    
    // Increase confidence based on processing time (longer = more thorough)
    if (processingTime > 10000) { // 10 seconds
      confidence += 0.1;
    }
    
    // Increase confidence based on metadata quality
    if (result.meta || result.metadata) {
      const metadata = result.meta || result.metadata;
      if (metadata.page_count && metadata.page_count > 1) {
        confidence += 0.05;
      }
      if (metadata.file_size && metadata.file_size > 1024 * 1024) { // > 1MB
        confidence += 0.05;
      }
    }
    
    // Increase confidence if individual transaction confidence is available
    if (result.transactions && Array.isArray(result.transactions)) {
      const transactionConfidences = result.transactions
        .map(t => t.confidence)
        .filter(c => typeof c === 'number' && c >= 0 && c <= 1);
      
      if (transactionConfidences.length > 0) {
        const avgTransactionConfidence = transactionConfidences.reduce((a, b) => a + b, 0) / transactionConfidences.length;
        confidence += avgTransactionConfidence * 0.1; // Up to 0.1 boost
      }
    }
    
    // Ensure confidence is between 0 and 1
    return Math.max(0, Math.min(1, confidence));
  }

  /**
   * Extract metadata from processing result
   * @param {Object} result - Processing result
   * @param {Object} options - Processing options
   * @returns {Object} Metadata object
   */
  extractMetadata(result, options = {}) {
    const metadata = {
      processingOptions: options,
      extractedAt: new Date().toISOString(),
      transactionCount: 0,
      hasMetadata: false
    };
    
    // Extract transaction information
    if (result.transactions && Array.isArray(result.transactions)) {
      metadata.transactionCount = result.transactions.length;
      
      // Extract transaction types if available
      const transactionTypes = result.transactions
        .map(t => t.type)
        .filter(type => type)
        .reduce((acc, type) => {
          acc[type] = (acc[type] || 0) + 1;
          return acc;
        }, {});
      
      if (Object.keys(transactionTypes).length > 0) {
        metadata.transactionTypes = transactionTypes;
      }
    }
    
    // Extract document metadata
    if (result.meta || result.metadata) {
      metadata.hasMetadata = true;
      const docMetadata = result.meta || result.metadata;
      
      if (docMetadata.page_count) {
        metadata.pageCount = docMetadata.page_count;
      }
      if (docMetadata.file_size) {
        metadata.fileSize = docMetadata.file_size;
      }
      if (docMetadata.processing_method) {
        metadata.processingMethod = docMetadata.processing_method;
      }
    }
    
    return metadata;
  }

  /**
   * Get cache statistics
   * @returns {Object} Cache statistics
   */
  async getStatistics() {
    const cacheStats = await this.cache.getCacheStats();
    
    return {
      integration: {
        ...this.stats,
        hitRatio: this.stats.totalRequests > 0 ? this.stats.cacheHits / this.stats.totalRequests : 0,
        skipRatio: this.stats.totalRequests > 0 ? this.stats.cacheSkips / this.stats.totalRequests : 0
      },
      cache: cacheStats
    };
  }

  /**
   * Force cache optimization
   */
  async optimizeCache() {
    try {
      await this.cache.optimizeCache();
      this.stats.lastOptimization = new Date().toISOString();
      
      if (this.config.debug) {
        console.log('[CACHE_INTEGRATION] Cache optimization completed');
      }
      
    } catch (error) {
      console.error('[CACHE_INTEGRATION] Cache optimization failed:', error);
    }
  }

  /**
   * Clear cache
   * @param {boolean} memoryOnly - If true, only clear memory cache
   */
  async clearCache(memoryOnly = false) {
    await this.cache.clearCache(memoryOnly);
    
    // Reset integration statistics
    this.stats = {
      totalRequests: 0,
      cacheHits: 0,
      cacheMisses: 0,
      cacheSkips: 0,
      processingTimeSaved: 0,
      lastOptimization: null
    };
    
    if (this.config.debug) {
      console.log('[CACHE_INTEGRATION] Cache and statistics cleared');
    }
  }

  /**
   * Check if a file would be a cache hit (without accessing the cache)
   * @param {string} filePath - Path to the PDF file
   * @returns {Promise<boolean>} True if file would be a cache hit
   */
  async wouldBeCacheHit(filePath) {
    try {
      const cachedResult = await this.cache.get(filePath);
      return cachedResult !== null;
    } catch (error) {
      return false;
    }
  }

  /**
   * Setup event handlers for cache events
   */
  setupEventHandlers() {
    this.cache.on('cache-hit', (data) => {
      if (this.config.debug) {
        console.log(`[CACHE_INTEGRATION] Cache hit: ${data.type} cache for ${path.basename(data.filePath)}`);
      }
    });

    this.cache.on('cache-miss', (data) => {
      if (this.config.debug) {
        console.log(`[CACHE_INTEGRATION] Cache miss for ${path.basename(data.filePath)}`);
      }
    });

    this.cache.on('cache-put', (data) => {
      if (this.config.debug) {
        console.log(`[CACHE_INTEGRATION] Cached result for ${path.basename(data.filePath)} (${data.size} bytes)`);
      }
    });

    this.cache.on('cache-optimized', (data) => {
      if (this.config.debug) {
        console.log(`[CACHE_INTEGRATION] Cache optimized: ${data.removedEntries} entries removed`);
      }
    });
  }

  /**
   * Shutdown the cache integration service
   */
  async shutdown() {
    await this.cache.shutdown();
    
    if (this.config.debug) {
      console.log('[CACHE_INTEGRATION] Shutdown complete');
    }
  }
}

/**
 * Convenience function for creating cache integration instance
 * @param {Object} options - Configuration options
 * @returns {CacheIntegration} Cache integration instance
 */
export function createCacheIntegration(options = {}) {
  return new CacheIntegration(options);
}

export default CacheIntegration;