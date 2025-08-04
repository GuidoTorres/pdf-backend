import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Obtener la ruta del directorio actual del módulo
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Cargar las variables de entorno desde la raíz del backend
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { createWorker } from '../config/queue.js';
import extractorService from '../services/extractorService.js';
import supabaseService from '../services/supabaseService.js';
import fs from 'fs/promises';

console.log('[PDF-WORKER] Iniciando worker de procesamiento de PDFs...');

const pdfWorker = createWorker(async (job) => {
  const { tempFilePath, originalName, userId } = job.data;
  const jobStartTime = Date.now();
  console.log(`[PDF-WORKER] [${job.id}] Procesando: ${originalName} para usuario ${userId}`);

  try {
    // --- Medir lectura de archivo ---
    const readFileStartTime = Date.now();
    const pdfBuffer = await fs.readFile(tempFilePath);
    const readFileEndTime = Date.now();
    console.log(`[PDF-WORKER] [${job.id}] [TIMER] Lectura de archivo temporal: ${readFileEndTime - readFileStartTime}ms`);

    // --- Medir procesamiento de extractorService ---
    const extractorStartTime = Date.now();
    const result = await extractorService.process(pdfBuffer, originalName, userId, true);
    const extractorEndTime = Date.now();
    console.log(`[PDF-WORKER] [${job.id}] [TIMER] extractorService.process: ${extractorEndTime - extractorStartTime}ms`);

    if (result.success) {
      console.log(`[PDF-WORKER] [${job.id}] Trabajo completado exitosamente.`);
      // Aquí podrías guardar el resultado en la base de datos, por ejemplo:
      // await supabaseService.saveDocumentResult(userId, originalName, result.json);
    } else {
      console.error(`[PDF-WORKER] [${job.id}] Trabajo falló: ${result.error}`);
      // Aquí podrías marcar el trabajo como fallido en la base de datos
    }

    const jobEndTime = Date.now();
    console.log(`[PDF-WORKER] [${job.id}] [TIMER] Tiempo total del trabajo: ${jobEndTime - jobStartTime}ms`);

    return result;

  } catch (error) {
    console.error(`[PDF-WORKER] [${job.id}] Error crítico:`, error);
    throw error; // Lanza el error para que BullMQ lo marque como fallido
  } finally {
    // Limpiar el fichero temporal después de procesar
    try {
      await fs.unlink(tempFilePath);
      console.log(`[PDF-WORKER] [${job.id}] Fichero temporal eliminado: ${tempFilePath}`);
    } catch (cleanError) {
      console.error(`[PDF-WORKER] [${job.id}] Error eliminando fichero temporal: ${cleanError.message}`);
    }
  }
});

pdfWorker.on('completed', (job) => {
  const duration = job.finishedOn - job.processedOn;
  console.log(`[PDF-WORKER] [${job.id}] Completado. Duración (BullMQ): ${duration}ms.`);
});

pdfWorker.on('failed', (job, err) => {
  const duration = job.finishedOn - job.processedOn;
  console.error(`[PDF-WORKER] [${job.id}] Falló. Duración: ${duration}ms. Error: ${err.message}`);
});
