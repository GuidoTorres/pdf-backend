import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { EventEmitter } from 'events';

/**
 * Cache entry structure
 */
class CacheEntry {
  constructor(key, data, fileHash, fileSize, processingTime = 0, confidenceScore = 1.0, metadata = {}) {
    this.key = key;
    this.data = data;
    this.createdAt = Date.now();
    this.lastAccessed = Date.now();
    this.accessCount = 1;
    this.fileHash = fileHash;
    this.fileSize = fileSize;
    this.processingTime = processingTime;
    this.confidenceScore = confidenceScore;
    this.metadata = metadata;
  }

  toJSON() {
    return {
      key: this.key,
      data: this.data,
      createdAt: this.createdAt,
      lastAccessed: this.lastAccessed,
      accessCount: this.accessCount,
      fileHash: this.fileHash,
      fileSize: this.fileSize,
      processingTime: this.processingTime,
      confidenceScore: this.confidenceScore,
      metadata: this.metadata
    };
  }

  static fromJSON(obj) {
    const entry = new CacheEntry(
      obj.key,
      obj.data,
      obj.fileHash,
      obj.fileSize,
      obj.processingTime,
      obj.confidenceScore,
      obj.metadata
    );
    entry.createdAt = obj.createdAt;
    entry.lastAccessed = obj.lastAccessed;
    entry.accessCount = obj.accessCount;
    return entry;
  }
}

/**
 * Cache statistics
 */
class CacheStats {
  constructor() {
    this.totalRequests = 0;
    this.cacheHits = 0;
    this.cacheMisses = 0;
    this.hitRatio = 0.0;
    this.totalEntries = 0;
    this.memoryUsageMB = 0.0;
    this.diskUsageMB = 0.0;
    this.averageAccessTime = 0.0;
    this.evictions = 0;
    this.oldestEntryAge = 0.0;
    this.newestEntryAge = 0.0;
  }
}

/**
 * Intelligent Cache System for PDF Processing Results
 * 
 * Features:
 * - Hash-based document identification
 * - LRU eviction policy
 * - Memory and disk storage options
 * - Performance monitoring
 * - Automatic cache validation
 * - Configurable size limits (max 100 entries as per requirements)
 */
class IntelligentCache extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.config = {
      maxMemoryEntries: Math.min(options.maxMemoryEntries || 50, 100), // Limit to 100 as per requirements
      maxDiskEntries: Math.min(options.maxDiskEntries || 100, 100), // Limit to 100 as per requirements
      cacheDir: options.cacheDir || path.join(os.tmpdir(), 'intelligent_cache'),
      enableDiskCache: options.enableDiskCache !== false,
      debug: options.debug || false,
      maxCacheAge: options.maxCacheAge || 24 * 60 * 60 * 1000, // 24 hours default
      cleanupInterval: options.cleanupInterval || 60 * 60 * 1000 // 1 hour cleanup interval
    };

    // Memory cache using Map for LRU behavior
    this.memoryCache = new Map();
    
    // Disk cache index
    this.diskCacheIndex = new Map();
    
    // Statistics
    this.stats = new CacheStats();
    
    // Initialization flag
    this.isInitialized = false;
    
    // Cleanup timer
    this.cleanupTimer = null;
  }

  /**
   * Initialize the cache system
   */
  async initialize() {
    if (this.isInitialized) {
      return;
    }

    try {
      // Create cache directory if it doesn't exist
      await fs.mkdir(this.config.cacheDir, { recursive: true });
      
      // Load existing disk cache index if enabled
      if (this.config.enableDiskCache) {
        await this.loadDiskCacheIndex();
      }
      
      // Start cleanup timer
      this.startCleanupTimer();
      
      this.isInitialized = true;
      
      if (this.config.debug) {
        console.log(`[INTELLIGENT_CACHE] Initialized: memory=${this.config.maxMemoryEntries}, disk=${this.config.maxDiskEntries}`);
      }
      
      this.emit('initialized');
      
    } catch (error) {
      console.error('[INTELLIGENT_CACHE] Failed to initialize:', error);
      throw error;
    }
  }

  /**
   * Generate a unique hash for a document based on content and metadata
   * @param {string} filePath - Path to the document file
   * @returns {Promise<string>} SHA-256 hash string
   */
  async generateDocumentHash(filePath) {
    try {
      const hasher = crypto.createHash('sha256');
      
      // Hash file content
      const fileBuffer = await fs.readFile(filePath);
      hasher.update(fileBuffer);
      
      // Include file metadata for additional uniqueness
      const stats = await fs.stat(filePath);
      const metadata = `${stats.size}_${stats.mtime.getTime()}_${path.basename(filePath)}`;
      hasher.update(metadata, 'utf8');
      
      return hasher.digest('hex');
      
    } catch (error) {
      console.error(`[INTELLIGENT_CACHE] Failed to generate hash for ${filePath}:`, error);
      // Fallback to filename + timestamp
      const fallback = crypto.createHash('sha256')
        .update(`${filePath}_${Date.now()}`, 'utf8')
        .digest('hex');
      return fallback;
    }
  }

  /**
   * Retrieve cached result for a document
   * @param {string} filePath - Path to the document file
   * @returns {Promise<any|null>} Cached result or null if not found
   */
  async get(filePath) {
    const startTime = Date.now();
    
    try {
      this.stats.totalRequests++;
      
      // Generate cache key
      const cacheKey = await this.generateDocumentHash(filePath);
      
      // Check memory cache first
      if (this.memoryCache.has(cacheKey)) {
        const entry = this.memoryCache.get(cacheKey);
        
        // Validate cache entry
        if (await this.isCacheValid(filePath, entry)) {
          // Update access statistics
          entry.lastAccessed = Date.now();
          entry.accessCount++;
          
          // Move to end (most recently used) by deleting and re-adding
          this.memoryCache.delete(cacheKey);
          this.memoryCache.set(cacheKey, entry);
          
          this.stats.cacheHits++;
          this.updateHitRatio();
          
          const accessTime = Date.now() - startTime;
          this.updateAverageAccessTime(accessTime);
          
          if (this.config.debug) {
            console.log(`[INTELLIGENT_CACHE] Memory cache hit for ${path.basename(filePath)}`);
          }
          
          this.emit('cache-hit', { type: 'memory', filePath, cacheKey });
          return entry.data;
        } else {
          // Invalid cache entry, remove it
          this.memoryCache.delete(cacheKey);
          if (this.config.debug) {
            console.log(`[INTELLIGENT_CACHE] Removed invalid memory cache entry for ${path.basename(filePath)}`);
          }
        }
      }
      
      // Check disk cache if enabled
      if (this.config.enableDiskCache && this.diskCacheIndex.has(cacheKey)) {
        const diskFile = this.diskCacheIndex.get(cacheKey);
        
        try {
          const entry = await this.loadFromDisk(diskFile);
          
          if (entry && await this.isCacheValid(filePath, entry)) {
            // Update access statistics
            entry.lastAccessed = Date.now();
            entry.accessCount++;
            
            // Promote to memory cache
            this.addToMemoryCache(cacheKey, entry);
            
            this.stats.cacheHits++;
            this.updateHitRatio();
            
            const accessTime = Date.now() - startTime;
            this.updateAverageAccessTime(accessTime);
            
            if (this.config.debug) {
              console.log(`[INTELLIGENT_CACHE] Disk cache hit for ${path.basename(filePath)}`);
            }
            
            this.emit('cache-hit', { type: 'disk', filePath, cacheKey });
            return entry.data;
          } else {
            // Invalid disk cache entry, remove it
            await this.removeFromDiskCache(cacheKey);
            if (this.config.debug) {
              console.log(`[INTELLIGENT_CACHE] Removed invalid disk cache entry for ${path.basename(filePath)}`);
            }
          }
        } catch (error) {
          console.error(`[INTELLIGENT_CACHE] Failed to load from disk cache:`, error);
          await this.removeFromDiskCache(cacheKey);
        }
      }
      
      // Cache miss
      this.stats.cacheMisses++;
      this.updateHitRatio();
      
      const accessTime = Date.now() - startTime;
      this.updateAverageAccessTime(accessTime);
      
      if (this.config.debug) {
        console.log(`[INTELLIGENT_CACHE] Cache miss for ${path.basename(filePath)}`);
      }
      
      this.emit('cache-miss', { filePath, cacheKey });
      return null;
      
    } catch (error) {
      console.error(`[INTELLIGENT_CACHE] Error during cache get:`, error);
      return null;
    }
  }

  /**
   * Store processing result in cache
   * @param {string} filePath - Path to the document file
   * @param {any} data - Processing result to cache
   * @param {number} processingTime - Time taken to process the document
   * @param {number} confidenceScore - Confidence score of the result
   * @param {Object} metadata - Additional metadata
   */
  async put(filePath, data, processingTime = 0, confidenceScore = 1.0, metadata = {}) {
    try {
      // Generate cache key and file info
      const cacheKey = await this.generateDocumentHash(filePath);
      const stats = await fs.stat(filePath);
      
      // Create cache entry
      const entry = new CacheEntry(
        cacheKey,
        data,
        cacheKey,
        stats.size,
        processingTime,
        confidenceScore,
        metadata
      );
      
      // Add to memory cache
      this.addToMemoryCache(cacheKey, entry);
      
      // Add to disk cache if enabled
      if (this.config.enableDiskCache) {
        await this.addToDiskCache(cacheKey, entry);
      }
      
      if (this.config.debug) {
        console.log(`[INTELLIGENT_CACHE] Cached result for ${path.basename(filePath)} (key: ${cacheKey.substring(0, 8)}...)`);
      }
      
      this.emit('cache-put', { filePath, cacheKey, size: stats.size });
      
    } catch (error) {
      console.error(`[INTELLIGENT_CACHE] Failed to cache result for ${filePath}:`, error);
    }
  }

  /**
   * Add entry to memory cache with LRU eviction
   * @param {string} cacheKey - Cache key
   * @param {CacheEntry} entry - Cache entry
   */
  addToMemoryCache(cacheKey, entry) {
    // Add/update entry
    this.memoryCache.set(cacheKey, entry);
    
    // Evict oldest entries if over limit
    while (this.memoryCache.size > this.config.maxMemoryEntries) {
      const firstKey = this.memoryCache.keys().next().value;
      this.memoryCache.delete(firstKey);
      this.stats.evictions++;
      
      if (this.config.debug) {
        console.log(`[INTELLIGENT_CACHE] Evicted memory cache entry: ${firstKey.substring(0, 8)}...`);
      }
    }
  }

  /**
   * Add entry to disk cache
   * @param {string} cacheKey - Cache key
   * @param {CacheEntry} entry - Cache entry
   */
  async addToDiskCache(cacheKey, entry) {
    try {
      // Create disk file path
      const diskFile = path.join(this.config.cacheDir, `${cacheKey}.cache`);
      
      // Save entry to disk
      await fs.writeFile(diskFile, JSON.stringify(entry.toJSON()), 'utf8');
      
      // Update disk cache index
      this.diskCacheIndex.set(cacheKey, diskFile);
      
      // Evict oldest disk entries if over limit
      if (this.diskCacheIndex.size > this.config.maxDiskEntries) {
        await this.evictOldestDiskEntries();
      }
      
      // Save updated index
      await this.saveDiskCacheIndex();
      
    } catch (error) {
      console.error(`[INTELLIGENT_CACHE] Failed to add to disk cache:`, error);
    }
  }

  /**
   * Evict oldest disk cache entries
   */
  async evictOldestDiskEntries() {
    try {
      // Get entries with creation times
      const entriesWithTime = [];
      
      for (const [cacheKey, diskFile] of this.diskCacheIndex) {
        try {
          const entry = await this.loadFromDisk(diskFile);
          if (entry) {
            entriesWithTime.push([cacheKey, entry.createdAt]);
          }
        } catch (error) {
          // Remove invalid entries
          await this.removeFromDiskCache(cacheKey);
        }
      }
      
      // Sort by creation time (oldest first)
      entriesWithTime.sort((a, b) => a[1] - b[1]);
      
      // Remove oldest entries until under limit
      const entriesToRemove = entriesWithTime.length - this.config.maxDiskEntries + 1;
      
      for (let i = 0; i < Math.min(entriesToRemove, entriesWithTime.length); i++) {
        const cacheKey = entriesWithTime[i][0];
        await this.removeFromDiskCache(cacheKey);
        this.stats.evictions++;
        
        if (this.config.debug) {
          console.log(`[INTELLIGENT_CACHE] Evicted disk cache entry: ${cacheKey.substring(0, 8)}...`);
        }
      }
    } catch (error) {
      console.error(`[INTELLIGENT_CACHE] Failed to evict disk cache entries:`, error);
    }
  }

  /**
   * Remove entry from disk cache
   * @param {string} cacheKey - Cache key
   */
  async removeFromDiskCache(cacheKey) {
    if (this.diskCacheIndex.has(cacheKey)) {
      const diskFile = this.diskCacheIndex.get(cacheKey);
      
      try {
        await fs.unlink(diskFile);
      } catch (error) {
        // File might not exist, which is okay
        if (error.code !== 'ENOENT') {
          console.error(`[INTELLIGENT_CACHE] Failed to remove disk cache file ${diskFile}:`, error);
        }
      }
      
      this.diskCacheIndex.delete(cacheKey);
    }
  }

  /**
   * Load cache entry from disk
   * @param {string} diskFile - Path to disk cache file
   * @returns {Promise<CacheEntry|null>} Cache entry or null
   */
  async loadFromDisk(diskFile) {
    try {
      const data = await fs.readFile(diskFile, 'utf8');
      const obj = JSON.parse(data);
      return CacheEntry.fromJSON(obj);
    } catch (error) {
      console.error(`[INTELLIGENT_CACHE] Failed to load from disk cache ${diskFile}:`, error);
      return null;
    }
  }

  /**
   * Validate if cache entry is still valid for the file
   * @param {string} filePath - Path to the document file
   * @param {CacheEntry} entry - Cache entry to validate
   * @returns {Promise<boolean>} True if cache entry is valid
   */
  async isCacheValid(filePath, entry) {
    try {
      // Check if file still exists
      await fs.access(filePath);
      
      // Check if file hash matches
      const currentHash = await this.generateDocumentHash(filePath);
      if (currentHash !== entry.fileHash) {
        return false;
      }
      
      // Check file size
      const stats = await fs.stat(filePath);
      if (stats.size !== entry.fileSize) {
        return false;
      }
      
      // Check age
      const age = Date.now() - entry.createdAt;
      if (age > this.config.maxCacheAge) {
        return false;
      }
      
      return true;
      
    } catch (error) {
      // File doesn't exist or other error
      return false;
    }
  }

  /**
   * Load disk cache index from file
   */
  async loadDiskCacheIndex() {
    const indexFile = path.join(this.config.cacheDir, 'cache_index.json');
    
    try {
      const data = await fs.readFile(indexFile, 'utf8');
      const index = JSON.parse(data);
      
      // Validate index entries
      const validEntries = new Map();
      
      for (const [cacheKey, diskFile] of Object.entries(index)) {
        try {
          await fs.access(diskFile);
          validEntries.set(cacheKey, diskFile);
        } catch (error) {
          // File doesn't exist, skip
        }
      }
      
      this.diskCacheIndex = validEntries;
      
      if (this.config.debug) {
        console.log(`[INTELLIGENT_CACHE] Loaded disk cache index: ${this.diskCacheIndex.size} entries`);
      }
      
    } catch (error) {
      // Index file doesn't exist or is invalid, start fresh
      this.diskCacheIndex = new Map();
    }
  }

  /**
   * Save disk cache index to file
   */
  async saveDiskCacheIndex() {
    const indexFile = path.join(this.config.cacheDir, 'cache_index.json');
    
    try {
      const index = Object.fromEntries(this.diskCacheIndex);
      await fs.writeFile(indexFile, JSON.stringify(index, null, 2), 'utf8');
    } catch (error) {
      console.error(`[INTELLIGENT_CACHE] Failed to save disk cache index:`, error);
    }
  }

  /**
   * Update cache hit ratio
   */
  updateHitRatio() {
    if (this.stats.totalRequests > 0) {
      this.stats.hitRatio = this.stats.cacheHits / this.stats.totalRequests;
    }
  }

  /**
   * Update average access time
   * @param {number} accessTime - Access time in milliseconds
   */
  updateAverageAccessTime(accessTime) {
    if (this.stats.totalRequests === 1) {
      this.stats.averageAccessTime = accessTime;
    } else {
      // Running average
      this.stats.averageAccessTime = 
        (this.stats.averageAccessTime * (this.stats.totalRequests - 1) + accessTime) / 
        this.stats.totalRequests;
    }
  }

  /**
   * Get comprehensive cache statistics
   * @returns {Object} Cache statistics
   */
  async getCacheStats() {
    // Update current statistics
    this.stats.totalEntries = this.memoryCache.size + this.diskCacheIndex.size;
    
    // Calculate memory usage (approximate)
    let memoryUsage = 0;
    for (const entry of this.memoryCache.values()) {
      memoryUsage += JSON.stringify(entry.toJSON()).length;
    }
    this.stats.memoryUsageMB = memoryUsage / (1024 * 1024);
    
    // Calculate disk usage
    let diskUsage = 0;
    for (const diskFile of this.diskCacheIndex.values()) {
      try {
        const stats = await fs.stat(diskFile);
        diskUsage += stats.size;
      } catch (error) {
        // File might not exist
      }
    }
    this.stats.diskUsageMB = diskUsage / (1024 * 1024);
    
    // Calculate entry ages
    const currentTime = Date.now();
    const entryAges = [];
    
    for (const entry of this.memoryCache.values()) {
      entryAges.push(currentTime - entry.createdAt);
    }
    
    if (entryAges.length > 0) {
      this.stats.oldestEntryAge = Math.max(...entryAges);
      this.stats.newestEntryAge = Math.min(...entryAges);
    }
    
    return {
      cacheStats: { ...this.stats },
      memoryCacheSize: this.memoryCache.size,
      diskCacheSize: this.diskCacheIndex.size,
      cacheDirectory: this.config.cacheDir,
      config: { ...this.config }
    };
  }

  /**
   * Clear cache entries
   * @param {boolean} memoryOnly - If true, only clear memory cache
   */
  async clearCache(memoryOnly = false) {
    // Clear memory cache
    const memoryCleared = this.memoryCache.size;
    this.memoryCache.clear();
    
    let diskCleared = 0;
    if (!memoryOnly && this.config.enableDiskCache) {
      // Clear disk cache
      for (const cacheKey of this.diskCacheIndex.keys()) {
        await this.removeFromDiskCache(cacheKey);
        diskCleared++;
      }
      
      // Save empty index
      await this.saveDiskCacheIndex();
    }
    
    console.log(`[INTELLIGENT_CACHE] Cache cleared: ${memoryCleared} memory entries, ${diskCleared} disk entries`);
    this.emit('cache-cleared', { memoryCleared, diskCleared });
  }

  /**
   * Optimize cache by removing low-value entries
   */
  async optimizeCache() {
    const currentTime = Date.now();
    
    // Remove old, rarely accessed entries from memory
    const toRemove = [];
    for (const [cacheKey, entry] of this.memoryCache) {
      const ageHours = (currentTime - entry.lastAccessed) / (1000 * 60 * 60);
      
      // Remove entries older than 24 hours with low access count
      if (ageHours > 24 && entry.accessCount < 2) {
        toRemove.push(cacheKey);
      }
      // Remove entries older than 7 days regardless of access
      else if (ageHours > 168) {
        toRemove.push(cacheKey);
      }
    }
    
    for (const cacheKey of toRemove) {
      this.memoryCache.delete(cacheKey);
    }
    
    // Optimize disk cache
    if (this.config.enableDiskCache) {
      const diskToRemove = [];
      for (const [cacheKey, diskFile] of this.diskCacheIndex) {
        try {
          const entry = await this.loadFromDisk(diskFile);
          if (entry) {
            const ageHours = (currentTime - entry.lastAccessed) / (1000 * 60 * 60);
            
            // Remove old disk entries with low confidence or access
            if ((ageHours > 168 && entry.confidenceScore < 0.7) || ageHours > 720) { // 30 days
              diskToRemove.push(cacheKey);
            }
          }
        } catch (error) {
          // Remove corrupted entries
          diskToRemove.push(cacheKey);
        }
      }
      
      for (const cacheKey of diskToRemove) {
        await this.removeFromDiskCache(cacheKey);
      }
      
      if (diskToRemove.length > 0) {
        await this.saveDiskCacheIndex();
      }
    }
    
    const removedTotal = toRemove.length + (this.config.enableDiskCache ? 0 : 0);
    
    if (removedTotal > 0) {
      console.log(`[INTELLIGENT_CACHE] Cache optimization removed ${removedTotal} entries`);
      this.emit('cache-optimized', { removedEntries: removedTotal });
    }
  }

  /**
   * Start cleanup timer
   */
  startCleanupTimer() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
    
    this.cleanupTimer = setInterval(async () => {
      try {
        await this.optimizeCache();
      } catch (error) {
        console.error('[INTELLIGENT_CACHE] Cleanup error:', error);
      }
    }, this.config.cleanupInterval);
  }

  /**
   * Stop cleanup timer
   */
  stopCleanupTimer() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /**
   * Shutdown the cache system
   */
  async shutdown() {
    this.stopCleanupTimer();
    
    if (this.config.enableDiskCache) {
      await this.saveDiskCacheIndex();
    }
    
    console.log('[INTELLIGENT_CACHE] Shutdown complete');
    this.emit('shutdown');
  }
}

/**
 * Convenience function for creating cache instance
 * @param {Object} options - Cache configuration options
 * @returns {IntelligentCache} Cache instance
 */
export function createIntelligentCache(options = {}) {
  return new IntelligentCache(options);
}

export default IntelligentCache;