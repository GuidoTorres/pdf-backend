import { priorityQueueManager } from '../config/queue.js';
import logService from '../services/logService.js';
import databaseService from '../services/databaseService.js';
import userService from '../services/userService.js';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import queueService from '../services/queueService.js';
import {
  enhanceTransactionsWithOriginalData,
  getFlexibleData,
  parseTransactions,
  parseMetadata,
  parseJsonField
} from '../utils/documentDataUtils.js';

async function processDocument(req, res) {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded.' });
  }

  let tempFilePath = null;
  try {
    // Get user subscription plan for priority determination
    const userPlan = await userService.getUserPlan(req.user.id);
    const fileSize = req.file.buffer.length;

    // Check if user has remaining pages (for non-enterprise users)
    if (userPlan !== 'enterprise') {
      const pageCheck = await userService.checkUserPages(req.user.id);
      if (!pageCheck.hasPages) {
        return res.status(403).json({ 
          error: 'Insufficient pages remaining in your plan. Please upgrade your subscription to continue processing documents.',
          errorCode: 'INSUFFICIENT_PAGES',
          remaining: pageCheck.remaining,
          plan: pageCheck.plan
        });
      }
    }

    // Guardar el fichero subido a una ruta temporal
    const tempDir = os.tmpdir();
    tempFilePath = path.join(tempDir, `upload_${Date.now()}_${req.file.originalname}`);
    await fs.writeFile(tempFilePath, req.file.buffer);

    // Prepare job data
    const jobData = {
      tempFilePath,
      originalName: req.file.originalname,
      userId: req.user.id,
      fileSize,
      uploadedAt: new Date().toISOString()
    };

    // Add job to appropriate priority queue
    const job = await priorityQueueManager.addJob(jobData, userPlan, fileSize);

    logService.log('[DOCUMENT_CONTROLLER] Job added to priority queue', { 
      jobId: job.id, 
      fileName: req.file.originalname,
      userPlan,
      fileSize,
      queueName: job.data.queueName,
      priority: job.data.priority
    });

    // Get queue statistics for response
    const queueStats = await priorityQueueManager.getQueueStats();
    const userQueueName = job.data.queueName;
    const estimatedWaitTime = calculateEstimatedWaitTime(queueStats, userQueueName, userPlan);

    // Responder inmediatamente con el ID del trabajo y información de cola
    res.status(202).json({ 
      jobId: job.id,
      message: 'El documento ha sido recibido y se está procesando en segundo plano.',
      queueInfo: {
        queueName: userQueueName,
        priority: job.data.priority,
        position: queueStats[userQueueName]?.waiting || 0,
        estimatedWaitTime
      },
      userPlan
    });

  } catch (err) {
    logService.error('[DOCUMENT_CONTROLLER] Error adding job to priority queue:', err);
    // Si algo falla, intentar eliminar el fichero temporal si se creó
    if (tempFilePath) {
      await fs.unlink(tempFilePath).catch(e => logService.error('Failed to cleanup temp file after error', e));
    }
    return res.status(500).json({ error: 'Error al iniciar el procesamiento del documento.' });
  }
}

/**
 * Calculate estimated wait time based on queue statistics
 * @param {Object} queueStats - Statistics for all queues
 * @param {string} queueName - Name of the queue the job was added to
 * @param {string} userPlan - User subscription plan
 * @returns {number} Estimated wait time in seconds
 */
function calculateEstimatedWaitTime(queueStats, queueName, userPlan) {
  const stats = queueStats[queueName];
  if (!stats) return 0;

  // Base processing time estimates per plan (in seconds)
  const baseProcessingTimes = {
    'enterprise': 15,
    'pro': 20,
    'basic': 30,
    'free': 45
  };

  const baseTime = baseProcessingTimes[userPlan] || baseProcessingTimes['free'];
  const waitingJobs = stats.waiting;
  const activeJobs = stats.active;

  // If no jobs waiting and workers available, process immediately
  if (waitingJobs === 0 && activeJobs < 3) {
    return 0;
  }

  // Estimate based on queue position and processing time
  const estimatedTime = (waitingJobs * baseTime) + (activeJobs * baseTime * 0.5);
  
  return Math.max(0, Math.round(estimatedTime));
}

async function getJobStatus(req, res) {
  const { jobId } = req.params;
  if (!jobId) {
    return res.status(400).json({ error: 'Job ID is required.' });
  }

  try {
    // Primero intentar obtener de la base de datos
    const document = await databaseService.getDocumentByJobId(jobId);
    
    if (document) {
      const rawTransactions = parseTransactions(document);
      let transactions = rawTransactions;
      let originalTransactions = null;

      if (rawTransactions.length > 0) {
        const enhancedResult = enhanceTransactionsWithOriginalData(rawTransactions, document);
        transactions = enhancedResult.transactions;
        originalTransactions = enhancedResult.originalTransactions;
      }

      const metadata = parseMetadata(document);
      
      // Log sign detection information for monitoring
      if (document.sign_detection_method) {
        logService.log('[DOCUMENT_CONTROLLER] Sign detection info', {
          jobId: document.job_id,
          signDetectionMethod: document.sign_detection_method,
          originalCredit: document.original_credit,
          originalDebit: document.original_debit,
          originalAmount: document.original_amount,
          transactionCount: transactions ? transactions.length : 0
        });
      }
      
      // Get flexible extraction data with error handling
      const flexibleData = getFlexibleData(document);
      const hasOriginalStructure = flexibleData.hasOriginalStructure || false;
      
      res.json({
        jobId: document.job_id,
        state: document.status,
        progress: document.progress,
        step: document.step,
        result: document.status === 'completed' ? {
          transactions: transactions,
          originalTransactions: originalTransactions,
          meta: metadata,
          // Include amount sign detection metadata
          amountSignData: {
            original_credit: document.original_credit,
            original_debit: document.original_debit,
            original_amount: document.original_amount,
            sign_detection_method: document.sign_detection_method
          },
          // Include flexible data extraction metadata
          originalStructure: flexibleData.original_structure,
          columnMetadata: flexibleData.column_mappings,
          extractType: flexibleData.extract_type,
          bankType: flexibleData.bank_type,
          formatVersion: flexibleData.format_version,
          preservationMetadata: flexibleData.preservation_metadata
        } : null,
        // Add preservedData flag for backward compatibility
        preservedData: hasOriginalStructure,
        failedReason: document.error_message,
        fileName: document.original_file_name,
        createdAt: document.created_at
      });
      return;
    }

    // Si no está en la BD, intentar obtenerlo desde las colas
    const job = await queueService.getJob(jobId);

    if (!job) {
      return res.status(404).json({ error: 'Job not found.' });
    }

    const state = await job.getState();
    const result = job.returnvalue;
    const failedReason = job.failedReason;

    // Get additional queue information if available
    let queueInfo = null;
    if (job.data && job.data.queueName) {
      const queueStats = await priorityQueueManager.getQueueStats();
      queueInfo = {
        queueName: job.data.queueName,
        priority: job.data.priority,
        userPlan: job.data.userPlan,
        fileSize: job.data.fileSize,
        queueStats: queueStats[job.data.queueName]
      };
    }

    res.json({
      jobId: job.id,
      state,
      progress: job.progress,
      result,
      failedReason,
      queueInfo
    });
  } catch (error) {
    logService.error(`[DOCUMENT_CONTROLLER] Error getting status for job ${jobId}:`, error);
    res.status(500).json({ error: 'Error al obtener el estado del trabajo.' });
  }
}

async function getHistory(req, res) {
  try {
    const documents = await databaseService.getUserDocuments(req.user.id);
    
    // Enhance documents with parsed transactions and original amount data
    const enhancedDocuments = documents.map(document => {
      const rawTransactions = parseTransactions(document);
      let transactions = rawTransactions;
      let originalTransactions = null;

      if (rawTransactions.length > 0) {
        const enhancedResult = enhanceTransactionsWithOriginalData(rawTransactions, document);
        transactions = enhancedResult.transactions;
        originalTransactions = enhancedResult.originalTransactions;
      }

      const originalTransactionsField = document.originalTransactions || document.original_transactions;
      const dbOriginalTransactions = parseJsonField(originalTransactionsField, null);

      if (!dbOriginalTransactions && !originalTransactionsField) {
        console.log(`[DOCUMENT_CONTROLLER] No originalTransactions in DB for document ${document.id}`);
      }

      const metadata = parseMetadata(document);
      const flexibleData = getFlexibleData(document);

      const finalOriginalTransactions = dbOriginalTransactions || originalTransactions;
      console.log(`[DOCUMENT_CONTROLLER] Returning document ${document.id} with originalTransactions: ${finalOriginalTransactions?.length || 0} items`);

      return {
        ...document.toJSON(),
        transactions,
        originalTransactions: finalOriginalTransactions,
        metadata,
        amountSignData: {
          original_credit: document.original_credit,
          original_debit: document.original_debit,
          original_amount: document.original_amount,
          sign_detection_method: document.sign_detection_method
        },
        originalStructure: flexibleData.original_structure,
        columnMetadata: flexibleData.column_mappings,
        extractType: flexibleData.extract_type,
        bankType: flexibleData.bank_type,
        formatVersion: flexibleData.format_version,
        preservationMetadata: flexibleData.preservation_metadata,
        preservedData: flexibleData.hasOriginalStructure
      };
    });
    
    // Log sign detection statistics for monitoring
    const signDetectionStats = documents.reduce((stats, doc) => {
      if (doc.sign_detection_method) {
        stats[doc.sign_detection_method] = (stats[doc.sign_detection_method] || 0) + 1;
      }
      return stats;
    }, {});
    
    logService.log('[DOCUMENT_CONTROLLER] History retrieved with sign detection stats', {
      userId: req.user.id,
      count: documents.length,
      signDetectionStats
    });
    
    res.json({
      success: true,
      data: enhancedDocuments
    });
  } catch (error) {
    logService.error('[DOCUMENT_CONTROLLER] Failed to get history:', error);
    res.status(500).json({
      error: 'Error al obtener el historial',
      details: error.message
    });
  }
}

/**
 * Update document with enhanced transaction data including original amounts and flexible extraction data
 * This function can be called by processing workers to store enhanced transaction data
 * @param {string} jobId - Job ID
 * @param {Object} enhancedData - Enhanced transaction data
 */
async function updateDocumentWithEnhancedData(jobId, enhancedData) {
  try {
    const { transactions, metadata, amountSignData, flexibleExtractionData } = enhancedData;
    
    // Update document with transactions and metadata
    const updateData = {
      transactions: JSON.stringify(transactions),
      metadata: JSON.stringify(metadata),
      status: 'completed',
      progress: 100,
      step: 'Completed'
    };
    
    // Add amount sign detection data if provided
    if (amountSignData) {
      if (amountSignData.original_credit !== undefined) {
        updateData.original_credit = amountSignData.original_credit;
      }
      if (amountSignData.original_debit !== undefined) {
        updateData.original_debit = amountSignData.original_debit;
      }
      if (amountSignData.original_amount !== undefined) {
        updateData.original_amount = amountSignData.original_amount;
      }
      if (amountSignData.sign_detection_method) {
        updateData.sign_detection_method = amountSignData.sign_detection_method;
      }
    }
    
    // Add flexible extraction data if provided
    if (flexibleExtractionData) {
      if (flexibleExtractionData.original_structure !== undefined) {
        updateData.original_structure = flexibleExtractionData.original_structure;
      }
      if (flexibleExtractionData.column_mappings !== undefined) {
        updateData.column_mappings = flexibleExtractionData.column_mappings;
      }
      if (flexibleExtractionData.extract_type !== undefined) {
        updateData.extract_type = flexibleExtractionData.extract_type;
      }
      if (flexibleExtractionData.bank_type !== undefined) {
        updateData.bank_type = flexibleExtractionData.bank_type;
      }
      if (flexibleExtractionData.format_version !== undefined) {
        updateData.format_version = flexibleExtractionData.format_version;
      }
      if (flexibleExtractionData.preservation_metadata !== undefined) {
        updateData.preservation_metadata = flexibleExtractionData.preservation_metadata;
      }
    }
    
    await databaseService.updateDocument(jobId, updateData);
    
    // Log successful update with sign detection and flexible extraction information
    logService.log('[DOCUMENT_CONTROLLER] Document updated with enhanced transaction data', {
      jobId,
      transactionCount: Array.isArray(transactions) ? transactions.length : 0,
      signDetectionMethod: amountSignData?.sign_detection_method,
      hasOriginalCredit: amountSignData?.original_credit !== undefined,
      hasOriginalDebit: amountSignData?.original_debit !== undefined,
      hasOriginalAmount: amountSignData?.original_amount !== undefined,
      // Flexible extraction logging
      extractType: flexibleExtractionData?.extract_type,
      bankType: flexibleExtractionData?.bank_type,
      hasOriginalStructure: flexibleExtractionData?.original_structure !== undefined,
      hasColumnMappings: flexibleExtractionData?.column_mappings !== undefined
    });
    
    return true;
  } catch (error) {
    logService.error('[DOCUMENT_CONTROLLER] Failed to update document with enhanced data:', error);
    throw error;
  }
}

export { processDocument, getHistory, getJobStatus, updateDocumentWithEnhancedData };
export default {
  processDocument,
  getHistory,
  getJobStatus,
  updateDocumentWithEnhancedData
};
