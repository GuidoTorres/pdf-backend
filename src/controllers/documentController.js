import { pdfProcessingQueue } from '../config/queue.js';
import logService from '../services/logService.js';
import supabaseService from '../services/supabaseService.js';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

async function processDocument(req, res) {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded.' });
  }

  let tempFilePath = null;
  try {
    // Guardar el fichero subido a una ruta temporal
    const tempDir = os.tmpdir();
    tempFilePath = path.join(tempDir, `upload_${Date.now()}_${req.file.originalname}`);
    await fs.writeFile(tempFilePath, req.file.buffer);

    // Añadir el trabajo a la cola
    const job = await pdfProcessingQueue.add('process-pdf', {
      tempFilePath,
      originalName: req.file.originalname,
      userId: req.user.id,
    });

    logService.log('[DOCUMENT_CONTROLLER] Job added to queue', { jobId: job.id, fileName: req.file.originalname });

    // Responder inmediatamente con el ID del trabajo
    res.status(202).json({ 
      jobId: job.id,
      message: 'El documento ha sido recibido y se está procesando en segundo plano.'
    });

  } catch (err) {
    logService.error('[DOCUMENT_CONTROLLER] Error adding job to queue:', err);
    // Si algo falla, intentar eliminar el fichero temporal si se creó
    if (tempFilePath) {
      await fs.unlink(tempFilePath).catch(e => logService.error('Failed to cleanup temp file after error', e));
    }
    return res.status(500).json({ error: 'Error al iniciar el procesamiento del documento.' });
  }
}

async function getJobStatus(req, res) {
  const { jobId } = req.params;
  if (!jobId) {
    return res.status(400).json({ error: 'Job ID is required.' });
  }

  try {
    const job = await pdfProcessingQueue.getJob(jobId);

    if (!job) {
      return res.status(404).json({ error: 'Job not found.' });
    }

    const state = await job.getState();
    const result = job.returnvalue;
    const failedReason = job.failedReason;

    res.json({
      jobId: job.id,
      state,
      progress: job.progress,
      result,
      failedReason
    });
  } catch (error) {
    logService.error(`[DOCUMENT_CONTROLLER] Error getting status for job ${jobId}:`, error);
    res.status(500).json({ error: 'Error al obtener el estado del trabajo.' });
  }
}

async function getHistory(req, res) {
  try {
    const conversions = await supabaseService.getConversions(req.user.id);
    
    logService.log('[DOCUMENT_CONTROLLER] History retrieved', {
      userId: req.user.id,
      count: conversions.length
    });
    
    res.json({
      success: true,
      data: conversions
    });
  } catch (error) {
    logService.error('[DOCUMENT_CONTROLLER] Failed to get history:', error);
    res.status(500).json({
      error: 'Error al obtener el historial',
      details: error.message
    });
  }
}

export { processDocument, getHistory, getJobStatus };
export default {
  processDocument,
  getHistory,
  getJobStatus
};
