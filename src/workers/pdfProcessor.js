import { createWorker } from '../config/queue.js';
import extractorService from '../services/extractorService.js';
import supabaseService from '../services/supabaseService.js';
import path from 'path';
import fs from 'fs/promises';

console.log('[PDF-WORKER] Iniciando worker de procesamiento de PDFs...');

const pdfWorker = createWorker(async (job) => {
  const { tempFilePath, originalName, userId } = job.data;
  console.log(`[PDF-WORKER] Procesando trabajo ${job.id}: ${originalName} para el usuario ${userId}`);

  try {
    const pdfBuffer = await fs.readFile(tempFilePath);
    
    const result = await extractorService.process(pdfBuffer, originalName, userId, true);

    if (result.success) {
      console.log(`[PDF-WORKER] Trabajo ${job.id} completado exitosamente.`);
      // Aquí podrías guardar el resultado en la base de datos, por ejemplo:
      // await supabaseService.saveDocumentResult(userId, originalName, result.json);
    } else {
      console.error(`[PDF-WORKER] Trabajo ${job.id} falló: ${result.error}`);
      // Aquí podrías marcar el trabajo como fallido en la base de datos
    }

    return { success: true, result };

  } catch (error) {
    console.error(`[PDF-WORKER] Error crítico en el trabajo ${job.id}:`, error);
    throw error; // Lanza el error para que BullMQ lo marque como fallido
  } finally {
    // Limpiar el fichero temporal después de procesar
    try {
      await fs.unlink(tempFilePath);
      console.log(`[PDF-WORKER] Fichero temporal eliminado: ${tempFilePath}`);
    } catch (cleanError) {
      console.error(`[PDF-WORKER] Error eliminando fichero temporal: ${cleanError.message}`);
    }
  }
});

pdfWorker.on('completed', (job) => {
  console.log(`[PDF-WORKER] El trabajo ${job.id} ha sido completado.`);
});

pdfWorker.on('failed', (job, err) => {
  console.error(`[PDF-WORKER] El trabajo ${job.id} ha fallado con el error: ${err.message}`);
});
