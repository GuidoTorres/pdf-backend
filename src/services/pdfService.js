import pdf from "pdf-parse/lib/pdf-parse.js";
import { createWorker } from "tesseract.js";
import { Poppler } from "node-poppler";
import fs from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import tempFileManager from '../utils/fileUtils.js';
import { readPdfText } from 'pdf-text-reader';

class PDFService {
  /**
   * Extrae texto de un PDF. Primero intenta la extracción estructurada,
   * y si la calidad es baja, recurre al OCR completo.
   */
  async extractText(pdfBuffer) {
    // 1. Intenta la extracción de texto estructurado
    const structuredText = await this._extractStructuredText(pdfBuffer);

    // 2. Heurística de calidad: si el texto es bueno, lo devolvemos.
    if (structuredText && structuredText.length > 0 && structuredText.some(page => page.length > 150 && /[a-zA-Z]/.test(page))) {
      return { text: structuredText, isOCR: false, isStructured: true };
    }

    // 3. Si no, recurrimos al OCR completo (lento pero necesario para imágenes)
    const ocrText = await this._performFullOcr(pdfBuffer);
    return { text: [ocrText], isOCR: true, isStructured: false };
  }

  /**
   * @private Usa pdf-text-reader para extraer texto manteniendo la estructura.
   */
  async _extractStructuredText(pdfBuffer) {
    try {
      const pages = await readPdfText(pdfBuffer);
      return pages.map(page => page.join('\n'));
    } catch (error) {      
      return null;
    }
  }

  /**
   * @private Usa pdf-parse para extraer texto de PDFs seleccionables.
   */
  async _extractNativeText(pdfBuffer) {
    try {
      const data = await pdf(pdfBuffer);
      return data.text?.trim() || null;
    } catch (error) {
      return null;
    }
  }

  /**
   * @private Usa Poppler para convertir PDF a imágenes y Tesseract para el OCR.
   */
  async _performFullOcr(pdfBuffer) {
    return tempFileManager.withTempFile(pdfBuffer, 'pdf', async (pdfPath) => {
      return tempFileManager.withTempDir(async (tempDir) => {
        const poppler = new Poppler();
        const outputFilePrefix = path.join(tempDir, `image_${uuidv4()}`);
        
        const options = {
          pngFile: true,
        };
        
        // Convertir PDF a imágenes
        await poppler.pdfToCairo(pdfPath, outputFilePrefix, options);

        const worker = await createWorker('eng+spa'); // Soporte para inglés y español
        
        try {
          const files = await fs.readdir(tempDir);
          const imageFiles = files.filter(f => f.startsWith(path.basename(outputFilePrefix)) && f.endsWith('.png'));
          
          if (imageFiles.length === 0) {
            throw new Error("Poppler no pudo convertir el PDF a imágenes. Asegúrate de que poppler-utils esté instalado.");
          }

          let fullText = '';
          // Ordena los archivos para procesar las páginas en el orden correcto
          imageFiles.sort(); 

          for (const imageFile of imageFiles) {
            const imagePath = path.join(tempDir, imageFile);
            const { data: { text } } = await worker.recognize(imagePath);
            fullText += text + '\n\n==End of OCR for page==\n\n';
            // No necesitamos limpiar manualmente, tempFileManager se encarga
          }

          return fullText.trim();
        } finally {
          await worker.terminate();
        }
      });
    });
  }

  async getPageCount(pdfBuffer) {
    try {
      const data = await pdf(pdfBuffer);
      return data.numpages;
    } catch (error) {
      return 0;
    }
  }
}

export default new PDFService();