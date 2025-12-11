import logService from '../services/logService.js';

/**
 * Safely parse a JSON field that might be stored as string or object
 */
export function parseJsonField(value, defaultValue = null) {
  if (!value) return defaultValue;

  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch (error) {
      logService.error('[DOCUMENT_UTILS] Failed to parse JSON field', {
        value: value.slice?.(0, 200) || '[binary]',
        error: error.message
      });
      return defaultValue;
    }
  }

  return value;
}

/**
 * Retrieve flexible extraction metadata from document
 */
export function getFlexibleData(document) {
  try {
    if (typeof document.getFlexibleExtractionData === 'function') {
      return {
        ...document.getFlexibleExtractionData(),
        hasOriginalStructure: document.hasOriginalStructure
          ? document.hasOriginalStructure()
          : false
      };
    }
  } catch (error) {
    logService.warn('[DOCUMENT_UTILS] Error retrieving flexible extraction data', {
      documentId: document.id,
      error: error.message
    });
  }

  return {
    original_structure: parseJsonField(document.original_structure, null),
    column_mappings: parseJsonField(document.column_mappings, null),
    extract_type: document.extract_type || null,
    bank_type: document.bank_type || null,
    format_version: document.format_version || null,
    preservation_metadata: parseJsonField(document.preservation_metadata, null),
    hasOriginalStructure: !!(document.original_structure || document.column_mappings)
  };
}

/**
 * Map normalized transaction data back to original column names
 */
export function mapNormalizedToOriginal(transaction, columnMappings) {
  if (!columnMappings || !Array.isArray(columnMappings)) {
    return transaction;
  }

  const originalTransaction = {};

  const standardMappings = {
    date: ['fecha', 'fecha_operacion', 'date'],
    description: ['concepto', 'descripcion', 'description'],
    amount: ['importe', 'monto', 'amount'],
    type: ['tipo', 'type'],
    balance: ['saldo', 'balance']
  };

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

  Object.entries(standardMappings).forEach(([normalizedField, possibleOriginalNames]) => {
    if (transaction[normalizedField] !== undefined) {
      const alreadyMapped = Object.values(originalTransaction).includes(transaction[normalizedField]);

      if (!alreadyMapped) {
        originalTransaction[possibleOriginalNames[0]] = transaction[normalizedField];
      }
    }
  });

  return originalTransaction;
}

function buildFallbackTransformationMetadata(transaction) {
  return {
    sourceColumns: Object.keys(transaction),
    transformationRules: ['fallback_mapping'],
    confidence: 0.7,
    preservationFlags: {
      originalFormatPreserved: false,
      dataTypesPreserved: true,
      allColumnsIncluded: false
    }
  };
}

function buildDefaultTransformationMetadata(transaction) {
  return {
    sourceColumns: [],
    transformationRules: [],
    confidence: 1.0,
    preservationFlags: {
      originalFormatPreserved: true,
      dataTypesPreserved: true,
      allColumnsIncluded: true
    }
  };
}

export function enhanceTransactionsWithOriginalData(transactions, document) {
  if (!Array.isArray(transactions)) {
    return { transactions, originalTransactions: null };
  }

  const flexibleData = getFlexibleData(document);

  const enhancedTransactions = transactions.map(transaction => {
    const enhancedTransaction = {
      ...transaction,
      ...(document.original_credit !== null && { document_original_credit: document.original_credit }),
      ...(document.original_debit !== null && { document_original_debit: document.original_debit }),
      ...(document.original_amount !== null && { document_original_amount: document.original_amount }),
      ...(document.sign_detection_method && { sign_detection_method: document.sign_detection_method })
    };

    ['original_credit', 'original_debit', 'original_amount', 'confidence'].forEach(key => {
      if (transaction[key] !== undefined) {
        enhancedTransaction[key] = transaction[key];
      }
    });

    return enhancedTransaction;
  });

  let originalTransactions = null;
  if (transactions.length > 0) {
    const hasOriginalData = transactions.some(t => t.original_data);

    if (hasOriginalData || flexibleData.original_structure) {
      originalTransactions = transactions.map(transaction => {
        if (transaction.original_data) {
          return {
            id: transaction.id,
            ...transaction.original_data,
            _transformationMetadata: transaction.transformationMetadata || buildDefaultTransformationMetadata(transaction)
          };
        }

        return {
          id: transaction.id,
          ...(flexibleData.column_mappings
            ? mapNormalizedToOriginal(transaction, flexibleData.column_mappings)
            : transaction),
          _transformationMetadata: buildFallbackTransformationMetadata(transaction)
        };
      });
    }
  }

  logTransactionEnhancementMetrics(enhancedTransactions, document, originalTransactions);

  return {
    transactions: enhancedTransactions,
    originalTransactions
  };
}

export function logTransactionEnhancementMetrics(transactions, document, originalTransactions = null) {
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

  if (originalTransactions) {
    let preservationSum = 0;
    let preservationCount = 0;

    originalTransactions.forEach(originalTx => {
      const confidence = originalTx._transformationMetadata?.confidence;
      if (confidence) {
        preservationSum += confidence;
        preservationCount++;
      }
    });

    if (preservationCount > 0) {
      metrics.averagePreservationConfidence = preservationSum / preservationCount;
    }
  }

  if (metrics.averageConfidence > 0 && metrics.averageConfidence < 0.7) {
    logService.warn('[DOCUMENT_UTILS] Low confidence in sign detection', {
      jobId: document.job_id,
      averageConfidence: metrics.averageConfidence,
      signDetectionMethod: document.sign_detection_method
    });
  }

  if (metrics.averagePreservationConfidence && metrics.averagePreservationConfidence < 0.8) {
    logService.warn('[DOCUMENT_UTILS] Low confidence in original structure preservation', {
      jobId: document.job_id,
      averagePreservationConfidence: metrics.averagePreservationConfidence,
      extractType: document.extract_type
    });
  }

  logService.log('[DOCUMENT_UTILS] Transaction enhancement metrics', {
    jobId: document.job_id,
    ...metrics
  });
}

export function parseTransactions(document) {
  const transactions = parseJsonField(document.transactions, []);
  return Array.isArray(transactions) ? transactions : [];
}

export function parseMetadata(document) {
  return parseJsonField(document.metadata, null);
}
