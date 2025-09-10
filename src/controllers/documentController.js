import { pdfProcessingQueue, priorityQueueManager } from '../config/queue.js';
import logService from '../services/logService.js';
import databaseService from '../services/databaseService.js';
import userService from '../services/userService.js';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

/**
 * Enhance transactions with original amount sign data and flexible structure data from document
 * @param {Array} transactions - Array of transaction objects
 * @param {Object} document - Document object with original amount data and flexible structure
 * @returns {Object} Enhanced transactions with both normalized and original data
 */
function enhanceTransactionsWithOriginalData(transactions, document) {
  if (!Array.isArray(transactions)) {
    return { transactions, originalTransactions: null };
  }

  // Get flexible extraction data
  let flexibleData = {};
  try {
    flexibleData = document.getFlexibleExtractionData();
  } catch (error) {
    logService.warn('[DOCUMENT_CONTROLLER] Error getting flexible data during transaction enhancement', {
      jobId: document.job_id,
      error: error.message
    });
    flexibleData = {};
  }

  // Enhanced normalized transactions (existing functionality)
  const enhancedTransactions = transactions.map(transaction => {
    // Preserve existing transaction data and add original amount information
    const enhancedTransaction = {
      ...transaction,
      // Add original amount data if available at document level
      ...(document.original_credit !== null && { document_original_credit: document.original_credit }),
      ...(document.original_debit !== null && { document_original_debit: document.original_debit }),
      ...(document.original_amount !== null && { document_original_amount: document.original_amount }),
      ...(document.sign_detection_method && { sign_detection_method: document.sign_detection_method })
    };

    // If transaction already has individual original values, preserve them
    // (these would come from the transaction extraction process)
    if (transaction.original_credit !== undefined) {
      enhancedTransaction.original_credit = transaction.original_credit;
    }
    if (transaction.original_debit !== undefined) {
      enhancedTransaction.original_debit = transaction.original_debit;
    }
    if (transaction.original_amount !== undefined) {
      enhancedTransaction.original_amount = transaction.original_amount;
    }
    if (transaction.confidence !== undefined) {
      enhancedTransaction.confidence = transaction.confidence;
    }

    return enhancedTransaction;
  });

  // Create original transactions preserving raw structure
  let originalTransactions = null;
  if (transactions.length > 0) {
    // Check if any transaction has original_data (from new Python processor)
    const hasOriginalData = transactions.some(t => t.original_data);
    
    if (hasOriginalData || flexibleData.original_structure) {
      originalTransactions = transactions.map(transaction => {
        // If transaction has original_data field (from Python processor), use it
        if (transaction.original_data) {
          return {
            id: transaction.id,
            ...transaction.original_data,
            // Add transformation metadata
            _transformationMetadata: transaction.transformationMetadata || {
              sourceColumns: [],
              transformationRules: [],
              confidence: 1.0,
              preservationFlags: {
                originalFormatPreserved: true,
                dataTypesPreserved: true,
                allColumnsIncluded: true
              }
            }
          };
        }
        
        // Fallback: create original format from normalized data
        return {
          id: transaction.id,
          // Map normalized fields back to original column names if mappings exist
          ...(flexibleData.column_mappings ? 
            mapNormalizedToOriginal(transaction, flexibleData.column_mappings) : 
            transaction),
          _transformationMetadata: {
            sourceColumns: Object.keys(transaction),
            transformationRules: ['fallback_mapping'],
            confidence: 0.7,
            preservationFlags: {
              originalFormatPreserved: false,
              dataTypesPreserved: true,
              allColumnsIncluded: false
            }
          }
        };
      });
    }
  }

  // Log enhancement quality metrics
  logTransactionEnhancementMetrics(enhancedTransactions, document, originalTransactions);

  return {
    transactions: enhancedTransactions,
    originalTransactions
  };
}

/**
 * Map normalized transaction data back to original column names
 * @param {Object} transaction - Normalized transaction
 * @param {Object} columnMappings - Column mapping configuration
 * @returns {Object} Transaction with original column names
 */
function mapNormalizedToOriginal(transaction, columnMappings) {
  if (!columnMappings || !Array.isArray(columnMappings)) {
    return transaction;
  }

  const originalTransaction = {};
  
  // Standard field mappings
  const standardMappings = {
    date: ['fecha', 'fecha_operacion', 'date'],
    description: ['concepto', 'descripcion', 'description'],
    amount: ['importe', 'monto', 'amount'],
    type: ['tipo', 'type'],
    balance: ['saldo', 'balance']
  };

  // Apply reverse mappings from column mappings
  columnMappings.forEach(tableMapping => {
    if (tableMapping.columnMappings) {
      tableMapping.columnMappings.forEach(colMapping => {
        const normalizedName = colMapping.normalizedName;
        const originalName = colMapping.originalName;
        
        if (transaction[normalizedName] !== undefined) {
          originalTransaction[originalName] = transaction[normalizedName];
        }
      });
    }
  });

  // Fill in any missing mappings using standard mappings
  Object.entries(standardMappings).forEach(([normalizedField, possibleOriginalNames]) => {
    if (transaction[normalizedField] !== undefined) {
      // Find if we already mapped this field
      const alreadyMapped = Object.values(originalTransaction).includes(transaction[normalizedField]);
      
      if (!alreadyMapped) {
        // Use the first possible original name as fallback
        const originalName = possibleOriginalNames[0];
        originalTransaction[originalName] = transaction[normalizedField];
      }
    }
  });

  return originalTransaction;
}

/**
 * Log metrics about transaction enhancement quality
 * @param {Array} transactions - Enhanced transactions
 * @param {Object} document - Document object
 * @param {Array} originalTransactions - Original format transactions
 */
function logTransactionEnhancementMetrics(transactions, document, originalTransactions = null) {
  if (!Array.isArray(transactions) || transactions.length === 0) {
    return;
  }

  const metrics = {
    totalTransactions: transactions.length,
    withOriginalCredit: 0,
    withOriginalDebit: 0,
    withOriginalAmount: 0,
    withConfidence: 0,
    signDetectionMethod: document.sign_detection_method,
    averageConfidence: 0,
    // Flexible extraction metrics
    hasOriginalTransactions: originalTransactions !== null,
    originalTransactionCount: originalTransactions ? originalTransactions.length : 0,
    extractType: document.extract_type,
    bankType: document.bank_type,
    hasOriginalStructure: document.hasOriginalStructure ? document.hasOriginalStructure() : false
  };

  let confidenceSum = 0;
  let confidenceCount = 0;

  transactions.forEach(transaction => {
    if (transaction.original_credit !== undefined && transaction.original_credit !== null) {
      metrics.withOriginalCredit++;
    }
    if (transaction.original_debit !== undefined && transaction.original_debit !== null) {
      metrics.withOriginalDebit++;
    }
    if (transaction.original_amount !== undefined && transaction.original_amount !== null) {
      metrics.withOriginalAmount++;
    }
    if (transaction.confidence !== undefined && transaction.confidence !== null) {
      metrics.withConfidence++;
      confidenceSum += transaction.confidence;
      confidenceCount++;
    }
  });

  if (confidenceCount > 0) {
    metrics.averageConfidence = confidenceSum / confidenceCount;
  }

  // Calculate original transaction preservation metrics
  if (originalTransactions) {
    let preservationSum = 0;
    let preservationCount = 0;
    
    originalTransactions.forEach(originalTx => {
      if (originalTx._transformationMetadata && originalTx._transformationMetadata.confidence) {
        preservationSum += originalTx._transformationMetadata.confidence;
        preservationCount++;
      }
    });
    
    if (preservationCount > 0) {
      metrics.averagePreservationConfidence = preservationSum / preservationCount;
    }
  }

  // Log warning if confidence is low
  if (metrics.averageConfidence > 0 && metrics.averageConfidence < 0.7) {
    logService.warn('[DOCUMENT_CONTROLLER] Low confidence in sign detection', {
      jobId: document.job_id,
      averageConfidence: metrics.averageConfidence,
      signDetectionMethod: document.sign_detection_method
    });
  }

  // Log warning if preservation confidence is low
  if (metrics.averagePreservationConfidence && metrics.averagePreservationConfidence < 0.8) {
    logService.warn('[DOCUMENT_CONTROLLER] Low confidence in original structure preservation', {
      jobId: document.job_id,
      averagePreservationConfidence: metrics.averagePreservationConfidence,
      extractType: document.extract_type
    });
  }

  logService.log('[DOCUMENT_CONTROLLER] Transaction enhancement metrics', {
    jobId: document.job_id,
    ...metrics
  });
}

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
    const document = await databaseService.getDocument(jobId);
    
    if (document) {
      let transactions = null;
      let metadata = null;
      
      // Parse transactions if they exist
      let originalTransactions = null;
      if (document.transactions) {
        try {
          const rawTransactions = typeof document.transactions === 'string' 
            ? JSON.parse(document.transactions) 
            : document.transactions;
          
          // Enhance transactions with original amount sign data and flexible structure
          if (Array.isArray(rawTransactions)) {
            const enhancedResult = enhanceTransactionsWithOriginalData(rawTransactions, document);
            transactions = enhancedResult.transactions;
            originalTransactions = enhancedResult.originalTransactions;
          }
        } catch (parseErr) {
          logService.error('[DOCUMENT_CONTROLLER] Error parsing transactions JSON:', parseErr);
          transactions = [];
          originalTransactions = null;
        }
      }
      
      // Parse metadata if it exists
      if (document.metadata) {
        try {
          metadata = typeof document.metadata === 'string' 
            ? JSON.parse(document.metadata) 
            : document.metadata;
        } catch (parseErr) {
          logService.error('[DOCUMENT_CONTROLLER] Error parsing metadata JSON:', parseErr);
          metadata = null;
        }
      }
      
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
      let flexibleData = {};
      let hasOriginalStructure = false;
      
      try {
        flexibleData = document.getFlexibleExtractionData();
        hasOriginalStructure = document.hasOriginalStructure();
      } catch (flexibleDataError) {
        logService.warn('[DOCUMENT_CONTROLLER] Error retrieving flexible extraction data', {
          jobId: document.job_id,
          error: flexibleDataError.message
        });
        // Set default values if flexible data retrieval fails
        flexibleData = {
          original_structure: null,
          column_mappings: null,
          extract_type: null,
          bank_type: null,
          format_version: null,
          preservation_metadata: null
        };
        hasOriginalStructure = false;
      }
      
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

    // Si no está en la BD, intentar obtener de las colas de prioridad (fallback)
    let job = await priorityQueueManager.getJob(jobId);
    
    // If not found in priority queues, try legacy queue for backward compatibility
    if (!job) {
      job = await pdfProcessingQueue.getJob(jobId);
    }

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
      let transactions = null;
      let metadata = null;
      
      // Parse transactions if they exist
      let originalTransactions = null;
      if (document.transactions) {
        try {
          const rawTransactions = typeof document.transactions === 'string' 
            ? JSON.parse(document.transactions) 
            : document.transactions;
          
          // Enhance transactions with original amount data and flexible structure
          if (Array.isArray(rawTransactions)) {
            const enhancedResult = enhanceTransactionsWithOriginalData(rawTransactions, document);
            transactions = enhancedResult.transactions;
            originalTransactions = enhancedResult.originalTransactions;
          }
        } catch (parseErr) {
          logService.error('[DOCUMENT_CONTROLLER] Error parsing transactions JSON in history:', parseErr);
          transactions = [];
          originalTransactions = null;
        }
      }

      // Parse originalTransactions from database if they exist
      // Check both camelCase and snake_case field names
      let dbOriginalTransactions = null;
      const originalTransactionsField = document.originalTransactions || document.original_transactions;
      if (originalTransactionsField) {
        try {
          dbOriginalTransactions = typeof originalTransactionsField === 'string' 
            ? JSON.parse(originalTransactionsField) 
            : originalTransactionsField;
          console.log(`[DOCUMENT_CONTROLLER] Parsed originalTransactions from DB: ${dbOriginalTransactions?.length || 0} items for document ${document.id}`);
        } catch (parseErr) {
          logService.error('[DOCUMENT_CONTROLLER] Error parsing originalTransactions JSON in history:', parseErr);
          dbOriginalTransactions = null;
        }
      } else {
        console.log(`[DOCUMENT_CONTROLLER] No originalTransactions in DB for document ${document.id} (checked both originalTransactions and original_transactions fields)`);
        // Debug: log all available fields to see what's actually there
        console.log(`[DOCUMENT_CONTROLLER] Available fields on document:`, Object.keys(document.toJSON()));
      }
      
      // Parse metadata if it exists
      if (document.metadata) {
        try {
          metadata = typeof document.metadata === 'string' 
            ? JSON.parse(document.metadata) 
            : document.metadata;
        } catch (parseErr) {
          logService.error('[DOCUMENT_CONTROLLER] Error parsing metadata JSON in history:', parseErr);
          metadata = null;
        }
      }
      
      // Get flexible extraction data for history
      let flexibleData = {};
      try {
        flexibleData = document.getFlexibleExtractionData();
      } catch (error) {
        logService.warn('[DOCUMENT_CONTROLLER] Error getting flexible data in history', {
          documentId: document.id,
          error: error.message
        });
        flexibleData = {};
      }
      
      // Return enhanced document with parsed data and original amount information
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
        // Include flexible data extraction metadata
        originalStructure: flexibleData.original_structure,
        columnMetadata: flexibleData.column_mappings,
        extractType: flexibleData.extract_type,
        bankType: flexibleData.bank_type,
        formatVersion: flexibleData.format_version,
        preservationMetadata: flexibleData.preservation_metadata,
        preservedData: document.hasOriginalStructure ? document.hasOriginalStructure() : false
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
