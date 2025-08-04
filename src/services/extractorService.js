import axios from 'axios';
import config from '../config/config.js';
import logService from './logService.js';

class ExtractorService {
  constructor() {
    this.workerUrl = config.docling.workerUrl;
    this.timeout = config.docling.timeout;
  }

  async process(pdfBuffer, fileName, userId, debug = false) {
    const processStartTime = Date.now();
    try {
      console.log(`[ExtractorService] Procesando ${fileName} con Docling Worker...`);
      
      // --- Medir conversión a Base64 ---
      const toBase64StartTime = Date.now();
      const pdfBase64 = pdfBuffer.toString('base64');
      const toBase64EndTime = Date.now();
      console.log(`[ExtractorService] [TIMER] Conversión a Base64: ${toBase64EndTime - toBase64StartTime}ms`);

      // --- Medir llamada al worker de Python ---
      const workerCallStartTime = Date.now();
      const doclingJson = await this._callDoclingWorker(pdfBase64, debug);
      const workerCallEndTime = Date.now();
      console.log(`[ExtractorService] [TIMER] Llamada a Docling Worker: ${workerCallEndTime - workerCallStartTime}ms`);
      
      console.log(`[ExtractorService] Docling Worker exitoso para ${fileName}`);
      const processEndTime = Date.now();
      console.log(`[ExtractorService] [TIMER] Tiempo total de process(): ${processEndTime - processStartTime}ms`);

      return { success: true, ...doclingJson };
    } catch (e) {
      console.error(`[ExtractorService] Docling Worker falló para ${fileName}:`, e.message);
      logService.log(`[Extractor] Docling Worker failed: ${JSON.stringify({ error: e.message })}`);
      return { 
        success: false, 
        error: e.message,
        provider: 'docling'
      };
    }
  }

  async _callDoclingWorker(pdfBase64, debug) {
    console.log(`[ExtractorService] Llamando al worker en: ${this.workerUrl} con contenido base64.`);
    try {
      const response = await axios.post(this.workerUrl, {
        file_content_b64: pdfBase64,
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
