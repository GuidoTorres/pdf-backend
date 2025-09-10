import express from "express";
import multer from "multer";
import { processDocument, getHistory, getJobStatus, updateDocumentWithEnhancedData } from "../controllers/documentController.js";
import { authenticateToken } from "../middleware/auth.js";
import excelExportService from "../services/excelExportService.js";
import databaseService from "../services/databaseService.js";
import logService from "../services/logService.js";

const router = express.Router();

// Configurar multer para archivos en memoria
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === "application/pdf") {
      cb(null, true);
    } else {
      cb(new Error("Solo se permiten archivos PDF"), false);
    }
  },
});

// Rutas protegidas (requieren autenticación)
router.use(authenticateToken);

/**
 * POST /api/documents/process
 * Encola un trabajo para procesar un PDF
 */
router.post("/process", upload.single("pdf"), processDocument);

/**
 * GET /api/documents/status/:jobId
 * Consulta el estado de un trabajo de procesamiento
 */
router.get("/status/:jobId", getJobStatus);

/**
 * GET /api/documents/history
 * Obtiene el historial de documentos procesados
 */
router.get("/history", getHistory);

/**
 * GET /api/documents/:id/download-original
 * Descarga el archivo PDF original
 */
router.get("/:id/download-original", async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  try {
    logService.log('[DOCUMENT_ROUTES] Original download requested', {
      documentId: id,
      userId: userId
    });

    // Get document from database
    const document = await databaseService.getDocument(id);
    
    if (!document) {
      return res.status(404).json({ 
        error: 'Document not found',
        message: 'The requested document does not exist or you do not have access to it.'
      });
    }

    // Verify user owns the document
    if (document.user_id !== userId) {
      logService.warn('[DOCUMENT_ROUTES] Unauthorized original download attempt', {
        documentId: id,
        userId: userId,
        documentUserId: document.user_id
      });
      return res.status(403).json({ 
        error: 'Access denied',
        message: 'You do not have permission to download this document.'
      });
    }

    // For now, return a message that this feature is being implemented
    // TODO: Implement actual file storage and retrieval
    return res.status(501).json({ 
      error: 'Feature not implemented',
      message: 'Original file download is not yet available. The original files are currently processed and then removed for security.'
    });

  } catch (error) {
    logService.error('[DOCUMENT_ROUTES] Original download failed:', error);
    
    res.status(500).json({ 
      error: 'Download failed',
      message: 'An error occurred while retrieving the original file. Please try again later.',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * GET /api/documents/:id/export/excel
 * Exporta un documento a Excel preservando la estructura original
 */
router.get("/:id/export/excel", async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  try {
    logService.log('[DOCUMENT_ROUTES] Excel export requested', {
      documentId: id,
      userId: userId
    });

    // Get document from database
    const document = await databaseService.getDocument(id);
    
    if (!document) {
      return res.status(404).json({ 
        error: 'Document not found',
        message: 'The requested document does not exist or you do not have access to it.'
      });
    }

    // Verify user owns the document
    if (document.user_id !== userId) {
      logService.warn('[DOCUMENT_ROUTES] Unauthorized Excel export attempt', {
        documentId: id,
        userId: userId,
        documentUserId: document.user_id
      });
      return res.status(403).json({ 
        error: 'Access denied',
        message: 'You do not have permission to export this document.'
      });
    }

    // Check if document is completed
    if (document.status !== 'completed') {
      return res.status(400).json({ 
        error: 'Document not ready',
        message: 'Document must be completed before it can be exported.',
        status: document.status
      });
    }

    // Check if document has transactions
    const transactions = document.transactions ? 
      (typeof document.transactions === 'string' ? JSON.parse(document.transactions) : document.transactions) : [];
    
    if (!Array.isArray(transactions) || transactions.length === 0) {
      return res.status(400).json({ 
        error: 'No data to export',
        message: 'This document contains no transaction data to export.'
      });
    }

    // Generate Excel file
    const excelBuffer = await excelExportService.generateExcel(document, {
      preserveOriginalStructure: true,
      includeMetadata: true,
      includeSummary: true
    });

    // Generate filename
    const originalName = document.original_file_name || 'document';
    const baseName = originalName.replace(/\.[^/.]+$/, ''); // Remove extension
    const timestamp = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const filename = `${baseName}_export_${timestamp}.xlsx`;

    // Set response headers for file download
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', excelBuffer.length);

    logService.log('[DOCUMENT_ROUTES] Excel export successful', {
      documentId: id,
      userId: userId,
      filename: filename,
      fileSize: excelBuffer.length,
      transactionCount: transactions.length
    });

    // Send the Excel file
    res.send(excelBuffer);

  } catch (error) {
    logService.error('[DOCUMENT_ROUTES] Excel export failed:', error);
    
    // Don't expose internal error details to client
    res.status(500).json({ 
      error: 'Export failed',
      message: 'An error occurred while generating the Excel file. Please try again later.',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * DELETE /api/documents/:jobId/cancel
 * Cancels a job and removes it from database if it's stuck
 */
router.delete("/:jobId/cancel", async (req, res) => {
  const { jobId } = req.params;
  const userId = req.user.id;

  try {
    logService.log('[DOCUMENT_ROUTES] Job cancellation requested', {
      jobId: jobId,
      userId: userId
    });

    // Find document by job_id
    const document = await databaseService.getDocument(jobId);
    
    if (!document) {
      logService.warn('[DOCUMENT_ROUTES] Job not found for cancellation', {
        jobId: jobId,
        userId: userId
      });
      return res.status(404).json({ 
        error: 'Job not found',
        message: 'The requested job does not exist or has already been processed.'
      });
    }

    // Verify user owns the document
    if (document.user_id !== userId) {
      logService.warn('[DOCUMENT_ROUTES] Unauthorized job cancellation attempt', {
        jobId: jobId,
        userId: userId,
        documentUserId: document.user_id
      });
      return res.status(403).json({ 
        error: 'Access denied',
        message: 'You do not have permission to cancel this job.'
      });
    }

    // Only allow cancellation of processing jobs
    if (document.status === 'completed') {
      return res.status(400).json({ 
        error: 'Cannot cancel completed job',
        message: 'This job has already been completed and cannot be cancelled.'
      });
    }

    // Try to cancel the job in the queue first
    try {
      const { queueManager } = await import('../services/queueManager.js');
      const job = await queueManager.getJob(jobId);
      
      if (job) {
        await job.remove();
        logService.log('[DOCUMENT_ROUTES] Job removed from queue', {
          jobId: jobId,
          userId: userId
        });
      }
    } catch (queueError) {
      logService.warn('[DOCUMENT_ROUTES] Failed to remove job from queue (might already be processed)', {
        jobId: jobId,
        userId: userId,
        error: queueError.message
      });
      // Continue with database cleanup even if queue removal fails
    }

    // Remove document from database to prevent it from reappearing
    await databaseService.deleteDocument(document.id, userId);
    
    logService.log('[DOCUMENT_ROUTES] Job cancelled successfully', {
      jobId: jobId,
      userId: userId,
      documentId: document.id
    });

    res.json({ 
      success: true,
      message: 'Job cancelled successfully',
      jobId: jobId
    });

  } catch (error) {
    logService.error('[DOCUMENT_ROUTES] Job cancellation failed:', error);
    
    res.status(500).json({ 
      error: 'Cancellation failed',
      message: 'An error occurred while cancelling the job. Please try again later.',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Manejo de errores de multer
router.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({
        error: "El archivo es demasiado grande",
        maxSize: "10MB",
      });
    }
  }

  if (error.message === "Solo se permiten archivos PDF") {
    return res.status(400).json({
      error: "Tipo de archivo no válido",
      allowedTypes: ["application/pdf"],
    });
  }

  next(error);
});

export default router;
