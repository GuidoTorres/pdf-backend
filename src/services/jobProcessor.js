import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import fs from 'fs/promises';
import databaseService from './databaseService.js';
import logService from './logService.js';
import webSocketManager from './websocketManager.js';
import userService from './userService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const pythonScriptPath = path.resolve(__dirname, '../../services/unified_pdf_processor.py');

/**
 * Process a PDF job with the unified processor
 * This is the core processing function used by all workers
 */
export const processJob = async (job) => {
  const { tempFilePath, originalName, userId } = job.data;
  const jobStartTime = Date.now();
  
  logService.log(`[JOB_PROCESSOR] [${job.id}] Processing: ${originalName} for user ${userId}`);

  // Initialize document record in database
  await updateJobStatus(job.id, 'processing', 'Starting processing...', { userId, originalName });

  // Notify user that job started
  webSocketManager.notifyJobStarted(userId, {
    jobId: job.id,
    workerId: 'worker-' + Math.random().toString(36).substr(2, 9),
    queue: job.data.queueName || 'normal'
  });

  // Notify initial progress
  webSocketManager.notifyJobProgress(userId, {
    jobId: job.id,
    progress: 0,
    stage: 'Starting processing...',
    estimatedTimeRemaining: null
  });

  // Verify file exists before processing
  try {
    await fs.access(tempFilePath);
    
    // Notify file verification completed
    webSocketManager.notifyJobProgress(userId, {
      jobId: job.id,
      progress: 10,
      stage: 'File verified, initializing processor...',
      estimatedTimeRemaining: null
    });
    
  } catch (fileErr) {
    const errorMsg = `Temporary file not found: ${tempFilePath}`;
    logService.error(`[JOB_PROCESSOR] [${job.id}] ${errorMsg}`);
    await updateJobStatus(job.id, 'failed', errorMsg);
    throw new Error(errorMsg);
  }

  // Process with automatic cleanup using try-finally
  try {
    const result = await processWithUnifiedProcessor(tempFilePath, job.id, userId);
    
    // Notify that processing is complete, now finalizing
    webSocketManager.notifyJobProgress(userId, {
      jobId: job.id,
      progress: 90,
      stage: 'Processing complete, finalizing results...',
      estimatedTimeRemaining: null
    });
    
    // Update as completed with file size and page count
    const updateData = {
      transactions: result.transactions || [],
      metadata: result.meta || result.metadata || {},
      originalTransactions: result.originalTransactions || null,
      originalTable: result.originalTable || null
    };
    
    // Extract file size and page count from metadata if available
    const metadata = result.meta || result.metadata || {};
    if (metadata.file_size) {
      updateData.file_size = metadata.file_size;
      logService.log(`[JOB_PROCESSOR] [${job.id}] File size: ${metadata.file_size} bytes`);
    } else {
      logService.warn(`[JOB_PROCESSOR] [${job.id}] No file_size found in metadata`);
    }
    
    let pageCount = 1; // Default to 1 page if not found
    if (metadata.page_count) {
      pageCount = metadata.page_count;
      updateData.page_count = metadata.page_count;
      logService.log(`[JOB_PROCESSOR] [${job.id}] Page count: ${metadata.page_count}`);
    } else {
      logService.warn(`[JOB_PROCESSOR] [${job.id}] No page_count found in metadata, using default: 1`);
      updateData.page_count = 1;
    }
    
    // Deduct pages from user's subscription
    logService.log(`[JOB_PROCESSOR] [${job.id}] About to deduct pages for user: ${userId}, pageCount: ${pageCount}`);
    try {
      const result = await userService.deductPages(userId, pageCount);
      logService.log(`[JOB_PROCESSOR] [${job.id}] Pages deduction result: ${JSON.stringify(result)}`);
      
      // Add remaining pages info to metadata for frontend
      updateData.pages_deducted = result.deducted;
      updateData.pages_remaining = result.remaining;
      
    } catch (pageError) {
      logService.error(`[JOB_PROCESSOR] [${job.id}] Failed to deduct pages:`, pageError.message);
      
      // If user doesn't have enough pages, mark as failed
      if (pageError.message.includes('Páginas insuficientes')) {
        await updateJobStatus(job.id, 'failed', 'Insufficient pages remaining in your plan');
        throw new Error('Insufficient pages remaining in your plan');
      }
      
      // For other page-related errors, log but continue (don't fail the job)
      logService.warn(`[JOB_PROCESSOR] [${job.id}] Page deduction failed but continuing: ${pageError.message}`);
    }
    
    await updateJobStatus(job.id, 'completed', 'Processing completed', updateData);
    
    const processingTime = Date.now() - jobStartTime;
    logService.log(`[JOB_PROCESSOR] [${job.id}] Completed in ${processingTime}ms`);
    
    // Log originalTransactions for debugging
    const originalTransactionsCount = result.originalTransactions?.length || 0;
    console.log(`[JOB_PROCESSOR] [${job.id}] About to notify WebSocket completion:`, {
      transactionCount: result.transactions?.length || 0,
      originalTransactionsCount,
      hasOriginalTransactions: !!result.originalTransactions,
      sampleOriginal: result.originalTransactions?.[0] || 'none'
    });

    // Notify user that job completed
    webSocketManager.notifyJobCompleted(userId, {
      jobId: job.id,
      success: true,
      result: {
        transactions: result.transactions || [],
        metadata: result.meta || result.metadata || {},
        originalTransactions: result.originalTransactions || null,
        originalTable: result.originalTable || null
      },
      processingTime: processingTime / 1000, // Convert to seconds
      queue: job.data.queueName || 'normal',
      fileSize: job.data.fileSize
    });
    
    return result;
    
  } catch (error) {
    logService.error(`[JOB_PROCESSOR] [${job.id}] Processing failed:`, error);
    await updateJobStatus(job.id, 'failed', error.message || 'Unknown processing error');
    
    // Notify user that job failed
    webSocketManager.notifyJobFailed(userId, {
      jobId: job.id,
      error: error.message || 'Unknown processing error',
      retryCount: 0,
      canRetry: true,
      queue: job.data.queueName || 'normal'
    });
    
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
        logService.log(`[JOB_PROCESSOR] [${jobId}] Document record created successfully`);
      } catch (createErr) {
        logService.warn(`[JOB_PROCESSOR] [${jobId}] Failed to create document record:`, createErr.message);
        // Continue processing even if database creation fails
      }
    } else {
      // Update existing - handle case where document doesn't exist
      try {
        await databaseService.updateDocument(jobId.toString(), updateData);
        logService.log(`[JOB_PROCESSOR] [${jobId}] Document record updated successfully`);
      } catch (updateErr) {
        logService.warn(`[JOB_PROCESSOR] [${jobId}] Failed to update document record:`, updateErr.message);
        // Try to create the document if update fails (fallback)
        if (additionalData.transactions || additionalData.metadata) {
          try {
            await databaseService.createDocument({
              job_id: jobId.toString(),
              user_id: 'unknown', // Fallback user ID
              original_file_name: 'unknown.pdf',
              ...updateData
            });
            logService.log(`[JOB_PROCESSOR] [${jobId}] Document record created as fallback`);
          } catch (fallbackErr) {
            logService.warn(`[JOB_PROCESSOR] [${jobId}] Fallback document creation also failed:`, fallbackErr.message);
          }
        }
      }
    }
  } catch (dbErr) {
    logService.error(`[JOB_PROCESSOR] [${jobId}] Unexpected database error:`, dbErr);
    // Don't throw - database errors shouldn't stop processing
  }
}

/**
 * Process PDF using UnifiedPdfProcessor with direct communication
 * @param {string} pdfPath - Path to the PDF file
 * @param {string} jobId - Job ID for logging
 * @param {string} userId - User ID for WebSocket notifications
 * @returns {Promise<Object>} Processing result
 */
async function processWithUnifiedProcessor(pdfPath, jobId, userId) {
  return new Promise((resolve, reject) => {
    logService.log(`[JOB_PROCESSOR] [${jobId}] Starting UnifiedPdfProcessor...`);
    
    // Notify that PDF processing has started
    webSocketManager.notifyJobProgress(userId, {
      jobId: jobId,
      progress: 20,
      stage: 'Initializing AI processor...',
      estimatedTimeRemaining: null
    });
    
    // Prepare environment variables for Python process
    const env = {
      ...process.env,
      GROQ_API_KEY: process.env.GROQ_API_KEY,
      GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,
    };
    
    // Direct communication with UnifiedPdfProcessor
    const pythonProcess = spawn('python3', [pythonScriptPath, pdfPath, '--debug'], {
      env: env
    });
    
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
              logService.log(`[JOB_PROCESSOR] [${jobId}] ${progressData.step}`);
              
              // Notify WebSocket clients about progress
              webSocketManager.notifyJobProgress(userId, {
                jobId: jobId,
                progress: progressData.progress || 50,
                stage: progressData.step,
                estimatedTimeRemaining: progressData.estimatedTimeRemaining || null
              });
            }
          } catch (e) {
            // Not JSON progress data, ignore
          }
        }
      });
    });

    pythonProcess.stderr.on('data', (data) => {
      errorOutput += data.toString();
      logService.error(`[PYTHON] [${jobId}] ${data}`);
    });

    pythonProcess.on('close', (code) => {
      if (code === 0) {
        logService.log(`[JOB_PROCESSOR] [${jobId}] UnifiedPdfProcessor completed successfully`);
        
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
            logService.log(`[JOB_PROCESSOR] [${jobId}] Result: ${result.success ? 'SUCCESS' : 'FAILED'}, ` +
                       `${result.transactions?.length || 0} transactions, ` +
                       `${result.processing_time?.toFixed(2) || 0}s`);
            
            if (!result.transactions || result.transactions.length === 0) {
              logService.warn(`[JOB_PROCESSOR] [${jobId}] No transactions found in result`);
            }
            
            resolve(result);
          } catch (parseErr) {
            logService.error(`[JOB_PROCESSOR] [${jobId}] JSON parse error:`, parseErr);
            reject(new Error(`Failed to parse result JSON: ${parseErr.message}`));
          }
        } else {
          logService.error(`[JOB_PROCESSOR] [${jobId}] No result markers found in output`);
          reject(new Error('No valid result found in processor output'));
        }
      } else {
        logService.error(`[JOB_PROCESSOR] [${jobId}] UnifiedPdfProcessor failed with code ${code}`);
        reject(new Error(errorOutput || `Processor failed with exit code ${code}`));
      }
    });

    pythonProcess.on('error', (err) => {
      logService.error(`[JOB_PROCESSOR] [${jobId}] Failed to start UnifiedPdfProcessor:`, err);
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
    logService.log(`[JOB_PROCESSOR] [${jobId}] Temp file cleaned: ${filePath}`);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      logService.warn(`[JOB_PROCESSOR] [${jobId}] Cleanup warning for ${filePath}: ${err.message}`);
    }
    // ENOENT (file not found) is acceptable - file may have been cleaned already
  }
}