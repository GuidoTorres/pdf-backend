import axios from 'axios';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import config from '../config/config.js';
import logService from './logService.js';

class ExtractorService {
  constructor() {
    this.workerUrl = config.docling.workerUrl;
    this.timeout = config.docling.timeout;
  }

  async process(pdfBuffer, fileName, userId, debug = false) {
    let tempFilePath = null;
    try {
      console.log(`[ExtractorService] Procesando ${fileName} con Docling Worker...`);
      
      // 1. Guardar el buffer en un fichero temporal
      const tempDir = os.tmpdir();
      tempFilePath = path.join(tempDir, `upload_${Date.now()}_${fileName}`);
      await fs.writeFile(tempFilePath, pdfBuffer);
      console.log(`[ExtractorService] PDF guardado temporalmente en: ${tempFilePath}`);

      // 2. Llamar al worker de Python
      const doclingJson = await this._callDoclingWorker(tempFilePath, debug);
      console.log(`[ExtractorService] Docling Worker exitoso para ${fileName}`);
      
      return { success: true, json: doclingJson, provider: 'docling' };
    } catch (e) {
      console.error(`[ExtractorService] Docling Worker falló para ${fileName}:`, e.message);
      logService.log(`[Extractor] Docling Worker failed: ${JSON.stringify({ error: e.message })}`);
      return { 
        success: false, 
        error: e.message,
        provider: 'docling'
      };
    } finally {
      // 3. Limpiar el fichero temporal
      if (tempFilePath) {
        try {
          await fs.unlink(tempFilePath);
          console.log(`[ExtractorService] Fichero temporal eliminado: ${tempFilePath}`);
        } catch (cleanError) {
          console.error(`[ExtractorService] Error eliminando fichero temporal: ${cleanError.message}`);
        }
      }
    }
  }

  async _callDoclingWorker(filePath, debug) {
    console.log(`[ExtractorService] Llamando al worker en: ${this.workerUrl}`);
    try {
      const response = await axios.post(this.workerUrl, {
        file_path: filePath,
        debug: debug
      }, {
        timeout: this.timeout
      });

      console.log('[ExtractorService] Respuesta del worker recibida.');
      return response.data;
    } catch (error) {
      if (error.response) {
        console.error('[ExtractorService] Error del worker:', error.response.data);
        throw new Error(error.response.data.error || 'Error desconocido del worker');
      } else if (error.request) {
        console.error('[ExtractorService] No se recibió respuesta del worker:', error.message);
        throw new Error('No se pudo conectar con el Docling Worker. ¿Está en marcha?');
      } else {
        console.error('[ExtractorService] Error configurando la petición al worker:', error.message);
        throw new Error(`Error en la petición al worker: ${error.message}`);
      }
    }
  }
}

export default new ExtractorService();
