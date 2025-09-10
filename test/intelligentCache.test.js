import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import IntelligentCache from '../src/services/intelligentCache.js';
import CacheIntegration from '../src/services/cacheIntegration.js';

describe('Intelligent Cache System', () => {
  let cache;
  let testDir;
  let testFile;

  beforeEach(async () => {
    // Create temporary directory for testing
    testDir = path.join(os.tmpdir(), `cache-test-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });

    // Create test file
    testFile = path.join(testDir, 'test.pdf');
    await fs.writeFile(testFile, 'test content for PDF processing');

    // Initialize cache
    cache = new IntelligentCache({
      maxMemoryEntries: 5,
      maxDiskEntries: 10,
      cacheDir: path.join(testDir, 'cache'),
      enableDiskCache: true,
      debug: false
    });

    await cache.initialize();
  });

  afterEach(async () => {
    // Cleanup
    if (cache) {
      await cache.shutdown();
    }
    
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('Hash Generation', () => {
    test('should generate consistent hash for same file', async () => {
      const hash1 = await cache.generateDocumentHash(testFile);
      const hash2 = await cache.generateDocumentHash(testFile);
      
      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^[a-f0-9]{64}$/); // SHA-256 hex format
    });

    test('should generate different hash for different files', async () => {
      const testFile2 = path.join(testDir, 'test2.pdf');
      await fs.writeFile(testFile2, 'different content');

      const hash1 = await cache.generateDocumentHash(testFile);
      const hash2 = await cache.generateDocumentHash(testFile2);
      
      expect(hash1).not.toBe(hash2);
    });

    test('should generate different hash when file content changes', async () => {
      const hash1 = await cache.generateDocumentHash(testFile);
      
      // Modify file
      await fs.writeFile(testFile, 'modified content');
      
      const hash2 = await cache.generateDocumentHash(testFile);
      
      expect(hash1).not.toBe(hash2);
    });
  });

  describe('Cache Operations', () => {
    test('should store and retrieve data from memory cache', async () => {
      const testData = { transactions: [{ id: 1, amount: 100 }], meta: { pages: 1 } };
      
      // Store data
      await cache.put(testFile, testData, 1000, 0.9, { test: true });
      
      // Retrieve data
      const retrieved = await cache.get(testFile);
      
      expect(retrieved).toEqual(testData);
    });

    test('should return null for cache miss', async () => {
      const nonExistentFile = path.join(testDir, 'nonexistent.pdf');
      
      const result = await cache.get(nonExistentFile);
      
      expect(result).toBeNull();
    });

    test('should handle disk cache when memory cache is full', async () => {
      const testData = { transactions: [], meta: {} };
      
      // Fill memory cache beyond limit
      for (let i = 0; i < 7; i++) {
        const tempFile = path.join(testDir, `temp${i}.pdf`);
        await fs.writeFile(tempFile, `content ${i}`);
        await cache.put(tempFile, { ...testData, id: i }, 1000, 0.9);
      }
      
      // First file should be evicted from memory but available on disk
      const firstFile = path.join(testDir, 'temp0.pdf');
      const retrieved = await cache.get(firstFile);
      
      expect(retrieved).toBeTruthy();
      expect(retrieved.id).toBe(0);
    });

    test('should invalidate cache when file changes', async () => {
      const testData = { transactions: [{ id: 1 }] };
      
      // Store data
      await cache.put(testFile, testData, 1000, 0.9);
      
      // Verify cache hit
      let retrieved = await cache.get(testFile);
      expect(retrieved).toEqual(testData);
      
      // Modify file
      await fs.writeFile(testFile, 'modified content');
      
      // Should be cache miss now
      retrieved = await cache.get(testFile);
      expect(retrieved).toBeNull();
    });
  });

  describe('Cache Statistics', () => {
    test('should track cache hits and misses', async () => {
      const testData = { transactions: [] };
      
      // Cache miss
      await cache.get(testFile);
      
      // Store data
      await cache.put(testFile, testData, 1000, 0.9);
      
      // Cache hit
      await cache.get(testFile);
      
      const stats = await cache.getCacheStats();
      
      expect(stats.cacheStats.totalRequests).toBe(2);
      expect(stats.cacheStats.cacheHits).toBe(1);
      expect(stats.cacheStats.cacheMisses).toBe(1);
      expect(stats.cacheStats.hitRatio).toBe(0.5);
    });

    test('should track memory and disk usage', async () => {
      const testData = { transactions: [{ id: 1, amount: 100 }] };
      
      await cache.put(testFile, testData, 1000, 0.9);
      
      const stats = await cache.getCacheStats();
      
      expect(stats.memoryCacheSize).toBe(1);
      expect(stats.cacheStats.memoryUsageMB).toBeGreaterThan(0);
    });
  });

  describe('Cache Limits', () => {
    test('should respect maximum memory entries limit', async () => {
      const testData = { transactions: [] };
      
      // Add more entries than the limit (5)
      for (let i = 0; i < 8; i++) {
        const tempFile = path.join(testDir, `temp${i}.pdf`);
        await fs.writeFile(tempFile, `content ${i}`);
        await cache.put(tempFile, { ...testData, id: i }, 1000, 0.9);
      }
      
      const stats = await cache.getCacheStats();
      
      // Memory cache should not exceed limit
      expect(stats.memoryCacheSize).toBeLessThanOrEqual(5);
    });

    test('should respect maximum disk entries limit', async () => {
      const testData = { transactions: [] };
      
      // Add more entries than the disk limit (10)
      for (let i = 0; i < 15; i++) {
        const tempFile = path.join(testDir, `temp${i}.pdf`);
        await fs.writeFile(tempFile, `content ${i}`);
        await cache.put(tempFile, { ...testData, id: i }, 1000, 0.9);
      }
      
      const stats = await cache.getCacheStats();
      
      // Total entries should not exceed memory + disk limits
      expect(stats.cacheStats.totalEntries).toBeLessThanOrEqual(15);
    });
  });

  describe('Cache Optimization', () => {
    test('should remove old entries during optimization', async () => {
      const testData = { transactions: [] };
      
      // Add entry with old timestamp
      await cache.put(testFile, testData, 1000, 0.9);
      
      // Verify entry exists before optimization
      const cacheKey = await cache.generateDocumentHash(testFile);
      expect(cache.memoryCache.has(cacheKey)).toBe(true);
      
      // Manually set old timestamp to make it eligible for removal
      const entry = cache.memoryCache.get(cacheKey);
      if (entry) {
        entry.lastAccessed = Date.now() - (169 * 60 * 60 * 1000); // 169 hours ago (> 7 days)
        entry.accessCount = 1; // This will be removed regardless of access count due to age > 168 hours
      }
      
      await cache.optimizeCache();
      
      // Entry should be removed from memory cache due to age > 7 days
      expect(cache.memoryCache.has(cacheKey)).toBe(false);
    });
  });

  describe('Cache Clearing', () => {
    test('should clear memory cache only', async () => {
      const testData = { transactions: [] };
      
      await cache.put(testFile, testData, 1000, 0.9);
      
      await cache.clearCache(true); // Memory only
      
      const stats = await cache.getCacheStats();
      expect(stats.memoryCacheSize).toBe(0);
    });

    test('should clear both memory and disk cache', async () => {
      const testData = { transactions: [] };
      
      await cache.put(testFile, testData, 1000, 0.9);
      
      await cache.clearCache(false); // Both memory and disk
      
      const stats = await cache.getCacheStats();
      expect(stats.memoryCacheSize).toBe(0);
      expect(stats.diskCacheSize).toBe(0);
    });
  });
});

describe('Cache Integration', () => {
  let cacheIntegration;
  let testDir;
  let testFile;

  beforeEach(async () => {
    // Create temporary directory for testing
    testDir = path.join(os.tmpdir(), `cache-integration-test-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });

    // Create test file
    testFile = path.join(testDir, 'test.pdf');
    await fs.writeFile(testFile, 'test content for PDF processing');

    // Initialize cache integration
    cacheIntegration = new CacheIntegration({
      maxMemoryEntries: 5,
      maxDiskEntries: 10,
      cacheDir: path.join(testDir, 'cache'),
      enableDiskCache: true,
      debug: false,
      minProcessingTimeForCache: 1000, // 1 second
      minConfidenceForCache: 0.7
    });

    await cacheIntegration.initialize();
  });

  afterEach(async () => {
    // Cleanup
    if (cacheIntegration) {
      await cacheIntegration.shutdown();
    }
    
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('Processing with Cache', () => {
    test('should process and cache result on first call', async () => {
      const mockProcessor = async (filePath, options) => {
        // Simulate processing time
        await new Promise(resolve => setTimeout(resolve, 1100)); // 1.1 seconds
        
        return {
          success: true,
          transactions: [{ id: 1, amount: 100 }],
          meta: { pages: 1 }
        };
      };

      const result = await cacheIntegration.processWithCache(testFile, mockProcessor);
      
      expect(result.fromCache).toBe(false);
      expect(result.cached).toBe(true);
      expect(result.transactions).toHaveLength(1);
    });

    test('should return cached result on second call', async () => {
      const mockProcessor = async (filePath, options) => {
        await new Promise(resolve => setTimeout(resolve, 1100));
        return {
          success: true,
          transactions: [{ id: 1, amount: 100 }],
          meta: { pages: 1 }
        };
      };

      // First call - should process and cache
      await cacheIntegration.processWithCache(testFile, mockProcessor);
      
      // Second call - should return from cache
      const result = await cacheIntegration.processWithCache(testFile, mockProcessor);
      
      expect(result.fromCache).toBe(true);
      expect(result.cacheHit).toBe(true);
    });

    test('should not cache results with low confidence', async () => {
      const mockProcessor = async (filePath, options) => {
        await new Promise(resolve => setTimeout(resolve, 1100));
        return {
          success: true,
          transactions: [], // No transactions = low confidence
          meta: { pages: 1 }
        };
      };

      const result = await cacheIntegration.processWithCache(testFile, mockProcessor);
      
      expect(result.fromCache).toBe(false);
      expect(result.cached).toBe(false);
    });

    test('should not cache results with fast processing time', async () => {
      const mockProcessor = async (filePath, options) => {
        // Fast processing (under threshold)
        await new Promise(resolve => setTimeout(resolve, 500)); // 0.5 seconds
        return {
          success: true,
          transactions: [{ id: 1, amount: 100 }],
          meta: { pages: 1 }
        };
      };

      const result = await cacheIntegration.processWithCache(testFile, mockProcessor);
      
      expect(result.fromCache).toBe(false);
      expect(result.cached).toBe(false);
    });

    test('should not cache failed results', async () => {
      const mockProcessor = async (filePath, options) => {
        await new Promise(resolve => setTimeout(resolve, 1100));
        return {
          success: false,
          error: 'Processing failed',
          transactions: []
        };
      };

      const result = await cacheIntegration.processWithCache(testFile, mockProcessor);
      
      expect(result.fromCache).toBe(false);
      expect(result.cached).toBe(false);
    });
  });

  describe('Confidence Calculation', () => {
    test('should calculate high confidence for good results', async () => {
      const result = {
        success: true,
        transactions: [
          { id: 1, amount: 100, confidence: 0.9 },
          { id: 2, amount: 200, confidence: 0.8 }
        ],
        meta: { pages: 5, file_size: 2048000 }
      };

      const confidence = cacheIntegration.calculateConfidenceScore(result, 15000);
      
      expect(confidence).toBeGreaterThan(0.8);
    });

    test('should calculate low confidence for poor results', async () => {
      const result = {
        success: true,
        transactions: [], // No transactions
        meta: { pages: 1 }
      };

      const confidence = cacheIntegration.calculateConfidenceScore(result, 2000);
      
      // Should be exactly 0.7 (0.5 base + 0.2 for success), so we expect it to be <= 0.7
      expect(confidence).toBeLessThanOrEqual(0.7);
    });
  });

  describe('Statistics', () => {
    test('should track integration statistics', async () => {
      const mockProcessor = async () => {
        await new Promise(resolve => setTimeout(resolve, 1100));
        return {
          success: true,
          transactions: [{ id: 1, amount: 100 }],
          meta: { pages: 1 }
        };
      };

      // Process twice
      await cacheIntegration.processWithCache(testFile, mockProcessor);
      await cacheIntegration.processWithCache(testFile, mockProcessor);

      const stats = await cacheIntegration.getStatistics();
      
      expect(stats.integration.totalRequests).toBe(2);
      expect(stats.integration.cacheHits).toBe(1);
      expect(stats.integration.cacheMisses).toBe(1);
      expect(stats.integration.hitRatio).toBe(0.5);
    });
  });
});