import CacheIntegration from '../src/services/cacheIntegration.js';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';

/**
 * Example: How to integrate the Intelligent Cache with PDF processing
 * 
 * This example demonstrates:
 * 1. Setting up the cache integration
 * 2. Processing documents with cache
 * 3. Monitoring cache performance
 * 4. Managing cache lifecycle
 */

async function runCacheIntegrationExample() {
  console.log('=== Intelligent Cache Integration Example ===\n');

  // 1. Initialize Cache Integration
  console.log('1. Initializing Cache Integration...');
  
  const cacheIntegration = new CacheIntegration({
    maxMemoryEntries: 10,
    maxDiskEntries: 20,
    cacheDir: path.join(os.tmpdir(), 'example-cache'),
    enableDiskCache: true,
    debug: true,
    minProcessingTimeForCache: 2000, // 2 seconds
    minConfidenceForCache: 0.7
  });

  await cacheIntegration.initialize();
  console.log('✓ Cache integration initialized\n');

  // 2. Create a sample PDF file for testing
  console.log('2. Creating sample PDF file...');
  
  const testDir = path.join(os.tmpdir(), 'cache-example');
  await fs.mkdir(testDir, { recursive: true });
  
  const samplePdf = path.join(testDir, 'sample.pdf');
  await fs.writeFile(samplePdf, 'Sample PDF content for cache testing');
  console.log(`✓ Created sample PDF: ${samplePdf}\n`);

  // 3. Define a mock PDF processing function
  const mockPdfProcessor = async (filePath, options) => {
    console.log(`   Processing ${path.basename(filePath)}...`);
    
    // Simulate processing time
    const processingTime = 2500 + Math.random() * 1000; // 2.5-3.5 seconds
    await new Promise(resolve => setTimeout(resolve, processingTime));
    
    // Simulate processing result
    const result = {
      success: true,
      transactions: [
        { id: 1, date: '2024-01-15', amount: 150.00, description: 'Payment received' },
        { id: 2, date: '2024-01-16', amount: -75.50, description: 'Service charge' },
        { id: 3, date: '2024-01-17', amount: 200.00, description: 'Deposit' }
      ],
      meta: {
        page_count: 3,
        file_size: 1024 * 1024, // 1MB
        processing_method: 'unified_processor'
      },
      processing_time: processingTime
    };
    
    console.log(`   ✓ Processing completed in ${processingTime.toFixed(0)}ms`);
    return result;
  };

  // 4. First processing (cache miss)
  console.log('3. First processing (should be cache miss)...');
  
  const startTime1 = Date.now();
  const result1 = await cacheIntegration.processWithCache(samplePdf, mockPdfProcessor, {
    userId: 'user123',
    jobId: 'job001'
  });
  const totalTime1 = Date.now() - startTime1;
  
  console.log(`✓ Result: ${result1.fromCache ? 'CACHE HIT' : 'CACHE MISS'}`);
  console.log(`✓ Cached: ${result1.cached}`);
  console.log(`✓ Transactions found: ${result1.transactions.length}`);
  console.log(`✓ Total time: ${totalTime1}ms\n`);

  // 5. Second processing (should be cache hit)
  console.log('4. Second processing (should be cache hit)...');
  
  const startTime2 = Date.now();
  const result2 = await cacheIntegration.processWithCache(samplePdf, mockPdfProcessor, {
    userId: 'user123',
    jobId: 'job002'
  });
  const totalTime2 = Date.now() - startTime2;
  
  console.log(`✓ Result: ${result2.fromCache ? 'CACHE HIT' : 'CACHE MISS'}`);
  console.log(`✓ Transactions found: ${result2.transactions.length}`);
  console.log(`✓ Total time: ${totalTime2}ms`);
  console.log(`✓ Time saved: ${result2.originalProcessingTime - totalTime2}ms\n`);

  // 6. Get cache statistics
  console.log('5. Cache Statistics...');
  
  const stats = await cacheIntegration.getStatistics();
  
  console.log('Integration Stats:');
  console.log(`   Total requests: ${stats.integration.totalRequests}`);
  console.log(`   Cache hits: ${stats.integration.cacheHits}`);
  console.log(`   Cache misses: ${stats.integration.cacheMisses}`);
  console.log(`   Hit ratio: ${(stats.integration.hitRatio * 100).toFixed(1)}%`);
  console.log(`   Processing time saved: ${stats.integration.processingTimeSaved}ms`);
  
  console.log('\nCache Stats:');
  console.log(`   Memory entries: ${stats.cache.memoryCacheSize}`);
  console.log(`   Disk entries: ${stats.cache.diskCacheSize}`);
  console.log(`   Memory usage: ${stats.cache.cacheStats.memoryUsageMB.toFixed(2)}MB`);
  console.log(`   Disk usage: ${stats.cache.cacheStats.diskUsageMB.toFixed(2)}MB`);
  console.log(`   Average access time: ${stats.cache.cacheStats.averageAccessTime.toFixed(2)}ms\n`);

  // 7. Test with different file (cache miss)
  console.log('6. Processing different file (should be cache miss)...');
  
  const samplePdf2 = path.join(testDir, 'sample2.pdf');
  await fs.writeFile(samplePdf2, 'Different PDF content for cache testing');
  
  const startTime3 = Date.now();
  const result3 = await cacheIntegration.processWithCache(samplePdf2, mockPdfProcessor, {
    userId: 'user123',
    jobId: 'job003'
  });
  const totalTime3 = Date.now() - startTime3;
  
  console.log(`✓ Result: ${result3.fromCache ? 'CACHE HIT' : 'CACHE MISS'}`);
  console.log(`✓ Cached: ${result3.cached}`);
  console.log(`✓ Total time: ${totalTime3}ms\n`);

  // 8. Test cache optimization
  console.log('7. Testing cache optimization...');
  
  await cacheIntegration.optimizeCache();
  console.log('✓ Cache optimization completed\n');

  // 9. Final statistics
  console.log('8. Final Statistics...');
  
  const finalStats = await cacheIntegration.getStatistics();
  
  console.log('Final Integration Stats:');
  console.log(`   Total requests: ${finalStats.integration.totalRequests}`);
  console.log(`   Cache hits: ${finalStats.integration.cacheHits}`);
  console.log(`   Cache misses: ${finalStats.integration.cacheMisses}`);
  console.log(`   Hit ratio: ${(finalStats.integration.hitRatio * 100).toFixed(1)}%`);
  console.log(`   Total processing time saved: ${finalStats.integration.processingTimeSaved}ms\n`);

  // 10. Cleanup
  console.log('9. Cleaning up...');
  
  await cacheIntegration.shutdown();
  
  try {
    await fs.rm(testDir, { recursive: true, force: true });
    console.log('✓ Temporary files cleaned up');
  } catch (error) {
    console.warn('⚠ Failed to cleanup temporary files:', error.message);
  }
  
  console.log('\n=== Cache Integration Example Complete ===');
}

// Performance comparison example
async function runPerformanceComparison() {
  console.log('\n=== Performance Comparison Example ===\n');

  const cacheIntegration = new CacheIntegration({
    maxMemoryEntries: 5,
    maxDiskEntries: 10,
    debug: false
  });

  await cacheIntegration.initialize();

  // Create test files
  const testDir = path.join(os.tmpdir(), 'perf-test');
  await fs.mkdir(testDir, { recursive: true });

  const testFiles = [];
  for (let i = 0; i < 3; i++) {
    const filePath = path.join(testDir, `test${i}.pdf`);
    await fs.writeFile(filePath, `Test content ${i}`);
    testFiles.push(filePath);
  }

  // Mock processor with variable processing time
  const mockProcessor = async (filePath) => {
    const processingTime = 2000 + Math.random() * 1000; // 2-3 seconds
    await new Promise(resolve => setTimeout(resolve, processingTime));
    
    return {
      success: true,
      transactions: [{ id: 1, amount: 100 }],
      meta: { pages: 1 },
      processing_time: processingTime
    };
  };

  console.log('Processing files multiple times to demonstrate cache benefits...\n');

  let totalTimeWithoutCache = 0;
  let totalTimeWithCache = 0;

  // Process each file 3 times
  for (let round = 1; round <= 3; round++) {
    console.log(`Round ${round}:`);
    
    for (let i = 0; i < testFiles.length; i++) {
      const filePath = testFiles[i];
      const fileName = path.basename(filePath);
      
      const startTime = Date.now();
      const result = await cacheIntegration.processWithCache(filePath, mockProcessor);
      const endTime = Date.now();
      
      const processingTime = endTime - startTime;
      
      if (result.fromCache) {
        totalTimeWithCache += processingTime;
        console.log(`   ${fileName}: ${processingTime}ms (CACHE HIT)`);
      } else {
        totalTimeWithoutCache += result.processingTime;
        totalTimeWithCache += processingTime;
        console.log(`   ${fileName}: ${processingTime}ms (CACHE MISS, processed in ${result.processingTime}ms)`);
      }
    }
    console.log('');
  }

  const stats = await cacheIntegration.getStatistics();
  
  console.log('Performance Summary:');
  console.log(`   Total processing time without cache: ${totalTimeWithoutCache}ms`);
  console.log(`   Total time with cache: ${totalTimeWithCache}ms`);
  console.log(`   Time saved: ${totalTimeWithoutCache - totalTimeWithCache}ms`);
  console.log(`   Performance improvement: ${((totalTimeWithoutCache - totalTimeWithCache) / totalTimeWithoutCache * 100).toFixed(1)}%`);
  console.log(`   Cache hit ratio: ${(stats.integration.hitRatio * 100).toFixed(1)}%`);

  // Cleanup
  await cacheIntegration.shutdown();
  await fs.rm(testDir, { recursive: true, force: true });
  
  console.log('\n=== Performance Comparison Complete ===');
}

// Run examples
async function main() {
  try {
    await runCacheIntegrationExample();
    await runPerformanceComparison();
  } catch (error) {
    console.error('Example failed:', error);
    process.exit(1);
  }
}

// Run if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { runCacheIntegrationExample, runPerformanceComparison };