import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import fs from 'fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { createPriorityWorkers } from '../config/queue.js';
import databaseService from '../services/databaseService.js';
import userService from '../services/userService.js';
import CacheIntegration from '../services/cacheIntegration.js';

console.log('[CACHED-PDF-WORKER] Starting cache-enhanced PDF processing workers...');

const pythonScriptPath = path.resolve(__dirname, '../../unified_pdf_processor.py');

// Initialize cache integration
const cacheIntegration = new CacheIntegration({
  maxMemoryEntries: 50,
  maxDiskEntries: 100,
  cacheDir: path.join(process.cwd(), 'temp', 'pdf-cache'),
  enableDiskCache: true,
  debug: process.env.NODE_ENV === 'development',
  minProcessingTimeForCache: 5000, // 5 seconds
  minConfidenceForCache: 0.7
});

// Initialize cache integration
await cacheIntegration.initialize();

// Create enhanced processor function that uses cache
const processJobWithCache = async (job) => {
  const { tempFilePath, originalName, userId } = job.data;
  const jobStartTime = Date.now();
  console.log(`[CACHED-PDF-WORKER] [${job.id}] Processing: ${originalName} for user ${userId}`);

  // Initialize document record in database
  await updateJobStatus(job.id, 'processing', 'Starting processing...', { userId, originalName });

  // Verify file exists before processing
  try {
    await fs.access(tempFilePath);
  } catch (fileErr) {
    const errorMsg = `Temporary file not found: ${tempFilePath}`;
    console.error(`[CACHED-PDF-WORKER] [${job.id}] ${errorMsg}`);
    await updateJobStatus(job.id, 'failed', errorMsg);
    throw new Error(errorMsg);
  }

  // Process with cache integration and automatic cleanup
  try {
    // Update status to indicate cache check
    await updateJobStatus(job.id, 'processing', 'Checking cache...', { userId, originalName });
    
    // Process with cache integration
    const result = await cacheIntegration.processWithCache(
      tempFilePath,
      // Processing function (called only on cache miss)
      async (filePath, options) => {
        await updateJobStatus(job.id, 'processing', 'Processing document (cache miss)...', { userId, originalName });
        return await processWithUnifiedProcessor(filePath, job.id);
      },
      // Processing options
      {
        jobId: job.id,
        userId,
        originalName
      }
    );
    
    // Log cache performance
    if (result.fromCache) {
      console.log(`[CACHED-PDF-WORKER] [${job.id}] Cache HIT - saved ${result.originalProcessingTime}ms processing time`);
      await updateJobStatus(job.id, 'processing', 'Retrieved from cache', { userId, originalName });
    } else {
      console.log(`[CACHED-PDF-WORKER] [${job.id}] Cache MISS - processed in ${result.processingTime}ms, cached: ${result.cached}`);
    }
    
    // Update as completed with file size and page count
    const updateData = {
      transactions: result.transactions || [],
      metadata: result.meta || result.metadata || {},
      fromCache: result.fromCache,
      cacheHit: result.cacheHit,
      processingTime: result.processingTime,
      cached: result.cached
    };
    
    // Extract file size and page count from metadata if available
    const metadata = result.meta || result.metadata || {};
    if (metadata.file_size) {
      updateData.file_size = metadata.file_size;
      console.log(`[CACHED-PDF-WORKER] [${job.id}] File size: ${metadata.file_size} bytes`);
    } else {
      console.warn(`[CACHED-PDF-WORKER] [${job.id}] No file_size found in metadata`);
    }
    
    let pageCount = 1; // Default to 1 page if not found
    if (metadata.page_count) {
      pageCount = metadata.page_count;
      updateData.page_count = metadata.page_count;
      console.log(`[CACHED-PDF-WORKER] [${job.id}] Page count: ${metadata.page_count}`);
    } else {
      console.warn(`[CACHED-PDF-WORKER] [${job.id}] No page_count found in metadata, using default: 1`);
      updateData.page_count = 1;
    }
    
    // Deduct pages from user's subscription (only if not from cache or if cache miss)
    if (!result.fromCache) {
      try {
        const remainingPages = await databaseService.updatePagesRemaining(userId, pageCount);
        console.log(`[CACHED-PDF-WORKER] [${job.id}] Pages deducted: ${pageCount}, remaining: ${remainingPages}`);
        
        // Add remaining pages info to metadata for frontend
        updateData.pages_deducted = pageCount;
        updateData.pages_remaining = remainingPages;
        
      } catch (pageError) {
        console.error(`[CACHED-PDF-WORKER] [${job.id}] Failed to deduct pages:`, pageError.message);
        
        // If user doesn't have enough pages, mark as failed
        if (pageError.message.includes('Páginas insuficientes')) {
          await updateJobStatus(job.id, 'failed', 'Insufficient pages remaining in your plan');
          throw new Error('Insufficient pages remaining in your plan');
        }
        
        // For other page-related errors, log but continue (don't fail the job)
        console.warn(`[CACHED-PDF-WORKER] [${job.id}] Page deduction failed but continuing: ${pageError.message}`);
      }
    } else {
      // For cached results, don't deduct pages but inform user
      console.log(`[CACHED-PDF-WORKER] [${job.id}] No pages deducted (result from cache)`);
      updateData.pages_deducted = 0;
      updateData.pages_remaining = 'unchanged';
    }
    
    await updateJobStatus(job.id, 'completed', 'Processing completed', updateData);
    
    const totalTime = Date.now() - jobStartTime;
    console.log(`[CACHED-PDF-WORKER] [${job.id}] Completed in ${totalTime}ms (processing: ${result.processingTime}ms, cache: ${result.fromCache})`);
    
    return result;
    
  } catch (error) {
    console.error(`[CACHED-PDF-WORKER] [${job.id}] Processing failed:`, error);
    await updateJobStatus(job.id, 'failed', error.message || 'Unknown processing error');
    throw error;
  } finally {
    // Automatic temp file cleanup using try-finally blocks
    await cleanupTempFile(tempFilePath, job.id);
  }
};

/**
 * Simplified status update function with better error handling
 * @param {string} jobId - Job ID
 * @param {string} status - Status (processing, completed, failed)
 * @param {string} step - Current step description
 * @param {Object} additionalData - Additional data to store
 */
async function updateJobStatus(jobId, status, step, additionalData = {}) {
  try {
    const updateData = {
      status,
      step,
      progress: status === 'completed' ? 100 : (status === 'processing' ? 50 : 0),
      ...additionalData
    };

    if (status === 'processing' && additionalData.userId && additionalData.originalName) {
      // Initial creation - verify user exists first
      try {
        await databaseService.createDocument({
          job_id: jobId.toString(),
          user_id: additionalData.userId,
          original_file_name: additionalData.originalName,
          ...updateData
        });
        console.log(`[CACHED-PDF-WORKER] [${jobId}] Document record created successfully`);
      } catch (createErr) {
        console.warn(`[CACHED-PDF-WORKER] [${jobId}] Failed to create document record:`, createErr.message);
        // Continue processing even if database creation fails
      }
    } else {
      // Update existing - handle case where document doesn't exist
      try {
        await databaseService.updateDocument(jobId.toString(), updateData);
        console.log(`[CACHED-PDF-WORKER] [${jobId}] Document record updated successfully`);
      } catch (updateErr) {
        console.warn(`[CACHED-PDF-WORKER] [${jobId}] Failed to update document record:`, updateErr.message);
        // Try to create the document if update fails (fallback)
        if (additionalData.transactions || additionalData.metadata) {
          try {
            await databaseService.createDocument({
              job_id: jobId.toString(),
              user_id: 'unknown', // Fallback user ID
              original_file_name: 'unknown.pdf',
              ...updateData
            });
            console.log(`[CACHED-PDF-WORKER] [${jobId}] Document record created as fallback`);
          } catch (fallbackErr) {
            console.warn(`[CACHED-PDF-WORKER] [${jobId}] Fallback document creation also failed:`, fallbackErr.message);
          }
        }
      }
    }
  } catch (dbErr) {
    console.error(`[CACHED-PDF-WORKER] [${jobId}] Unexpected database error:`, dbErr);
    // Don't throw - database errors shouldn't stop processing
  }
}

/**
 * Process PDF using UnifiedPdfProcessor with direct communication
 * @param {string} pdfPath - Path to the PDF file
 * @param {string} jobId - Job ID for logging
 * @returns {Promise<Object>} Processing result
 */
async function processWithUnifiedProcessor(pdfPath, jobId) {
  return new Promise((resolve, reject) => {
    console.log(`[CACHED-PDF-WORKER] [${jobId}] Starting UnifiedPdfProcessor...`);
    
    // Direct communication with UnifiedPdfProcessor
    const pythonProcess = spawn('python3', [pythonScriptPath, pdfPath, '--debug']);
    
    let stdoutBuffer = '';
    let errorOutput = '';

    pythonProcess.stdout.on('data', (data) => {
      const output = data.toString();
      stdoutBuffer += output;
      
      // Handle progress updates
      const lines = output.split('\n');
      lines.forEach(line => {
        if (line.trim()) {
          try {
            const progressData = JSON.parse(line);
            if (progressData.status === 'progress') {
              console.log(`[CACHED-PDF-WORKER] [${jobId}] ${progressData.step}`);
            }
          } catch (e) {
            // Not JSON progress data, ignore
          }
        }
      });
    });

    pythonProcess.stderr.on('data', (data) => {
      errorOutput += data.toString();
      console.error(`[PYTHON] [${jobId}] ${data}`);
    });

    pythonProcess.on('close', (code) => {
      if (code === 0) {
        console.log(`[CACHED-PDF-WORKER] [${jobId}] UnifiedPdfProcessor completed successfully`);
        
        // Extract result from output markers
        const resultStartMarker = '___RESULT_START___';
        const resultEndMarker = '___RESULT_END___';
        
        const startIndex = stdoutBuffer.indexOf(resultStartMarker);
        const endIndex = stdoutBuffer.indexOf(resultEndMarker);
        
        if (startIndex !== -1 && endIndex !== -1) {
          const jsonStr = stdoutBuffer.substring(
            startIndex + resultStartMarker.length,
            endIndex
          ).trim();
          
          try {
            const result = JSON.parse(jsonStr);
            console.log(`[CACHED-PDF-WORKER] [${jobId}] Result: ${result.success ? 'SUCCESS' : 'FAILED'}, ` +
                       `${result.transactions?.length || 0} transactions, ` +
                       `${result.processing_time?.toFixed(2) || 0}s`);
            
            if (!result.transactions || result.transactions.length === 0) {
              console.warn(`[CACHED-PDF-WORKER] [${jobId}] No transactions found in result`);
            }
            
            resolve(result);
          } catch (parseErr) {
            console.error(`[CACHED-PDF-WORKER] [${jobId}] JSON parse error:`, parseErr);
            reject(new Error(`Failed to parse result JSON: ${parseErr.message}`));
          }
        } else {
          console.error(`[CACHED-PDF-WORKER] [${jobId}] No result markers found in output`);
          reject(new Error('No valid result found in processor output'));
        }
      } else {
        console.error(`[CACHED-PDF-WORKER] [${jobId}] UnifiedPdfProcessor failed with code ${code}`);
        reject(new Error(errorOutput || `Processor failed with exit code ${code}`));
      }
    });

    pythonProcess.on('error', (err) => {
      console.error(`[CACHED-PDF-WORKER] [${jobId}] Failed to start UnifiedPdfProcessor:`, err);
      reject(new Error(`Failed to start processor: ${err.message}`));
    });
  });
}

/**
 * Clean up temporary file with automatic error handling
 * @param {string} filePath - Path to the temporary file
 * @param {string} jobId - Job ID for logging
 */
async function cleanupTempFile(filePath, jobId) {
  try {
    await fs.unlink(filePath);
    console.log(`[CACHED-PDF-WORKER] [${jobId}] Temp file cleaned: ${filePath}`);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.warn(`[CACHED-PDF-WORKER] [${jobId}] Cleanup warning for ${filePath}: ${err.message}`);
    }
    // ENOENT (file not found) is acceptable - file may have been cleaned already
  }
}

/**
 * Get cache statistics
 * @returns {Promise<Object>} Cache statistics
 */
export async function getCacheStatistics() {
  return await cacheIntegration.getStatistics();
}

/**
 * Optimize cache
 */
export async function optimizeCache() {
  await cacheIntegration.optimizeCache();
}

/**
 * Clear cache
 * @param {boolean} memoryOnly - If true, only clear memory cache
 */
export async function clearCache(memoryOnly = false) {
  await cacheIntegration.clearCache(memoryOnly);
}

// Create priority workers for all queues with cache integration
const priorityWorkers = createPriorityWorkers(processJobWithCache);

// Set up event handlers for all workers
Object.entries(priorityWorkers).forEach(([queueName, worker]) => {
  worker.on('completed', (job) => {
    const duration = job.finishedOn - job.processedOn;
    const transactionCount = job.returnvalue?.transactions?.length || 0;
    const userPlan = job.data?.userPlan || 'unknown';
    const fromCache = job.returnvalue?.fromCache || false;
    const cacheStatus = fromCache ? 'CACHE_HIT' : 'CACHE_MISS';
    console.log(`[CACHED-PDF-WORKER] [${queueName}] [${job.id}] COMPLETED: ${duration}ms, ${transactionCount} transactions, plan: ${userPlan}, cache: ${cacheStatus}`);
  });

  worker.on('failed', (job, err) => {
    const duration = job.finishedOn - job.processedOn;
    const userPlan = job.data?.userPlan || 'unknown';
    console.error(`[CACHED-PDF-WORKER] [${queueName}] [${job.id}] FAILED: ${duration}ms, plan: ${userPlan} - ${err.message}`);
  });

  worker.on('active', (job) => {
    const userPlan = job.data?.userPlan || 'unknown';
    const priority = job.data?.priority || 'unknown';
    console.log(`[CACHED-PDF-WORKER] [${queueName}] [${job.id}] ACTIVE: plan: ${userPlan}, priority: ${priority}`);
  });

  console.log(`[CACHED-PDF-WORKER] Cache-enhanced worker created for queue: ${queueName}`);
});

// Log cache statistics periodically
setInterval(async () => {
  try {
    const stats = await getCacheStatistics();
    console.log(`[CACHED-PDF-WORKER] Cache Stats - Hits: ${stats.integration.cacheHits}, Misses: ${stats.integration.cacheMisses}, Hit Ratio: ${(stats.integration.hitRatio * 100).toFixed(1)}%, Time Saved: ${stats.integration.processingTimeSaved}ms`);
  } catch (error) {
    console.error('[CACHED-PDF-WORKER] Failed to get cache statistics:', error);
  }
}, 5 * 60 * 1000); // Every 5 minutes

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('[CACHED-PDF-WORKER] Shutting down gracefully...');
  await cacheIntegration.shutdown();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('[CACHED-PDF-WORKER] Shutting down gracefully...');
  await cacheIntegration.shutdown();
  process.exit(0);
});

export { cacheIntegration };