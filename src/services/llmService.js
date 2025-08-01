import Groq from 'groq-sdk';
import config from '../config/config.js';
import logService from './logService.js';
import { jsonrepair } from 'jsonrepair';

class LLMService {
  constructor() {
    this.groqClient = null;
    this.initializeClient();
  }

  initializeClient() {
    if (!config.groqApiKey) {
      throw new Error('Groq API key is not configured.');
    }
    this.groqClient = new Groq({
      apiKey: config.groqApiKey,
    });
  }

  // Prompts universales para todos los tipos de extractos bancarios
  static PROMPTS = {
    // Prompts ultra-concisos pero precisos
    LAYOUT_STRUCTURING: `Organiza con etiquetas:
[HEADER] - banco, cuenta, titular
[SUMMARY] - período, saldos  
[TRANSACTIONS_SECTION_X] - tablas movimientos

Conserva texto exacto.`,

    FINANCIAL_ANALYSIS: `Convierte a JSON:
{
  "metadata": {"bankName": "string|null", "accountNumber": "string|null", "currency": "string|null", "period": {"startDate": "YYYY-MM-DD|null", "endDate": "YYYY-MM-DD|null"}, "openingBalance": "number|null", "closingBalance": "number|null"},
  "transactions": [{"postDate": "YYYY-MM-DD", "description": "string exacto", "amount": number, "type": "CREDIT|DEBIT", "balanceAfter": "number|null"}]
}

Procesa TODAS las secciones TRANSACTIONS_SECTION_X. Solo JSON válido.`
  };

  // Modelos predefinidos
  static MODELS = {
    SCOUT: "meta-llama/llama-4-scout-17b-16e-instruct",
    MAVERICK: "meta-llama/llama-4-maverick-17b-128e-instruct"
  };

  /**
   * Pre-procesa texto OCR para mejorar la estructuración universal
   * @param {string} text - Texto OCR crudo
   * @returns {string} Texto pre-procesado
   */
  preprocessOCRText(text) {
    return text
      // Normalizar espacios múltiples
      .replace(/\s{3,}/g, '  ')
      // Normalizar saltos de línea múltiples
      .replace(/\n{3,}/g, '\n\n')
      // Identificar y marcar secciones de transacciones
      .split('\n')
      .map(line => {
        const trimmed = line.trim();
        
        // Marcar líneas que son claramente totales para ignorarlas (multiidioma)
        const totalPatterns = [
          'Total ', 'TOTAL ', 'Ending Balance', 'Beginning Balance',
          'Saldo Final', 'Saldo Inicial', 'SALDO FINAL', 'SALDO INICIAL',
          'Total Movimiento', 'TOTAL MOVIMIENTO', 'Subtotal', 'SUBTOTAL'
        ];
        
        if (totalPatterns.some(pattern => trimmed.includes(pattern))) {
          return `[TOTAL] ${trimmed}`;
        }
        
        return trimmed;
      })
      .filter(line => line && !line.startsWith('[TOTAL]')) // Filtrar totales
      .reduce((acc, line, index, array) => {
        if (!line) return acc;
        
        // Detectar si la línea empieza con fecha o número (multiidioma)
        const datePatterns = [
          /^\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}/, // DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY
          /^\d{4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2}/, // YYYY/MM/DD, YYYY-MM-DD
          /^\d{1,2}[A-Z]{3}\d{2,4}/, // 20MAY2023, 20MAY23
          /^\d+[\.,]\d+/, // Montos
          /^[A-Z]{3}\d{1,2}/ // MAY20, JUN15
        ];
        
        const startsWithDateOrNumber = datePatterns.some(pattern => pattern.test(line));
        
        if (!startsWithDateOrNumber && acc.length > 0 && !line.includes('|')) {
          // Unir con la línea anterior solo si no es una tabla ya estructurada
          acc[acc.length - 1] += ' ' + line;
        } else {
          acc.push(line);
        }
        
        return acc;
      }, [])
      .join('\n');
  }

  /**
   * Valida la calidad del resultado de extracción
   * @param {Object} result - Resultado de la extracción
   * @returns {Object} Métricas de calidad
   */
  validateExtractionQuality(result) {
    const quality = {
      score: 0,
      confidence: 'LOW',
      issues: [],
      metrics: {}
    };

    // 1. Validación estructural básica
    if (!result.metadata && (!result.transactions || result.transactions.length === 0)) {
      quality.issues.push('NO_DATA_EXTRACTED');
      return quality;
    }

    // 2. Validación de transacciones
    const allTransactions = result.transactions || [];

    if (allTransactions.length > 0) {
      const validTransactions = allTransactions.filter(t => 
        t.postDate && t.description && t.amount !== null && t.type
      );
      
      quality.metrics.transactionCompleteness = validTransactions.length / allTransactions.length;
      quality.score += quality.metrics.transactionCompleteness * 40;

      // Validar fechas
      const validDates = validTransactions.filter(t => 
        /^\d{4}-\d{2}-\d{2}$/.test(t.postDate)
      ).length;
      quality.metrics.dateValidation = validTransactions.length > 0 ? validDates / validTransactions.length : 1;
      quality.score += quality.metrics.dateValidation * 20;

      // Validar montos
      const validAmounts = validTransactions.filter(t => 
        typeof t.amount === 'number' && !isNaN(t.amount)
      ).length;
      quality.metrics.amountValidation = validTransactions.length > 0 ? validAmounts / validTransactions.length : 1;
      quality.score += quality.metrics.amountValidation * 20;

      // Penalizar descripciones genéricas o faltantes
      const genericDescriptions = allTransactions.filter(t => 
        !t.description || 
        t.description === 'Operación bancaria' || 
        t.description === 'Bank transaction' ||
        t.description === 'Checks Paid'
      ).length;
      
      if (genericDescriptions > allTransactions.length * 0.3) {
        quality.issues.push(`HIGH_GENERIC_DESCRIPTIONS_${genericDescriptions}`);
        quality.score -= 15;
      }
    } else {
      // No hay transacciones extraídas
      quality.score += 20; // Damos puntos por al menos procesar el documento
    }

    // 3. Validación de balance (si disponible)
    if (result.metadata?.balanceCheck === true) {
      quality.score += 20;
      quality.metrics.balanceVerified = true;
    }

    // 4. Determinar confianza
    if (quality.score >= 80) quality.confidence = 'HIGH';
    else if (quality.score >= 60) quality.confidence = 'MEDIUM';
    else quality.confidence = 'LOW';

    return quality;
  }

  /**
   * Procesa texto con el modelo LLM especificado
   * @param {string} text - Texto a procesar
   * @param {string} prompt - Prompt del sistema
   * @param {Object} options - Opciones de configuración
   * @returns {Promise<any>} Respuesta procesada
   */
  async processText(text, prompt, options = {}) {
    const {
      model = LLMService.MODELS.SCOUT,
      responseFormat = { type: "json_object" },
      userPrompt = null
    } = options;

    const startTime = Date.now();

    try {
      logService.log(`[LLM_SERVICE] Processing with model: ${model}`);
      logService.log(`[LLM_SERVICE] Input text length: ${text.length}`);

      const defaultUserPrompt = responseFormat.type === "json_object" 
        ? `Analiza el siguiente extracto bancario y devuelve las transacciones en formato JSON. El extracto puede estar en cualquier idioma y formato. Detecta automáticamente el tipo de banco y estructura.

Texto del extracto:
<<<
${text}
>>>`
        : text;

      const chatCompletion = await this.groqClient.chat.completions.create({
        messages: [
          {
            role: "system",
            content: prompt,
          },
          {
            role: "user",
            content: userPrompt || defaultUserPrompt,
          },
        ],
        model: model,
        response_format: responseFormat,
      });

      const rawResponse = chatCompletion.choices[0]?.message?.content;
      const processingTime = Date.now() - startTime;

      logService.log(`[LLM_SERVICE] Processing completed in ${processingTime}ms`);
      logService.log(`[LLM_SERVICE] Raw response length: ${rawResponse?.length || 0}`);

      if (!rawResponse) {
        throw new Error('LLM did not return a response.');
      }

      // Procesar respuesta según el formato esperado
      if (responseFormat && responseFormat.type === "json_object") {
        const repairedResponse = jsonrepair(rawResponse);
        const parsedResponse = JSON.parse(repairedResponse);
        
        logService.log(`[LLM_SERVICE] JSON response parsed successfully`);
        return parsedResponse;
      } else {
        return rawResponse;
      }

    } catch (error) {
      const processingTime = Date.now() - startTime;
      logService.error(`[LLM_SERVICE] Error after ${processingTime}ms:`, error);
      throw new Error(`LLM processing failed: ${error.message}`);
    }
  }

  /**
   * Estructura el layout del documento usando el LLM.
   * @param {string} text - Texto crudo del documento.
   * @returns {Promise<string>} Texto estructurado con etiquetas.
   */
  async structureLayout(text) {
    logService.log('[LLM_SERVICE] Structuring document layout.');
    const prompt = LLMService.PROMPTS.LAYOUT_STRUCTURING;
    const userPrompt = `Estructura el siguiente texto del extracto bancario:\n\n<<<\n${text}\n>>>`;

    return this.processText(text, prompt, {
      model: LLMService.MODELS.SCOUT,
      responseFormat: { type: 'text' },
      userPrompt: userPrompt
    });
  }

  /**
   * Estructura texto en formato de tabla con pipes (versión mejorada universal)
   * @param {string} rawText - Texto sin estructura
   * @returns {Promise<string>} Texto estructurado
   */
  async structureLayoutEnhanced(rawText) {
    // Pre-procesamiento del texto OCR
    const cleanedText = this.preprocessOCRText(rawText);
    
    const enhancedPrompt = `${LLMService.PROMPTS.LAYOUT_STRUCTURING}

**TEXTO OCR A PROCESAR**:
${cleanedText.slice(0, 8000)}

**INSTRUCCIONES ADICIONALES**:
- Este texto viene de OCR y puede tener espacios irregulares
- Detecta automáticamente el idioma (español, inglés, portugués, etc.)
- Busca patrones de fechas en cualquier formato
- Agrupa texto que claramente pertenece a la misma transacción
- Si ves números aislados, probablemente son montos o saldos
- Preserva TODA la información, no omitas nada
- Mantén los nombres de columnas en el idioma original`;

    return this.processText(cleanedText.slice(0, 8000), enhancedPrompt, {
      model: LLMService.MODELS.SCOUT,
      responseFormat: { type: 'text' }
    });
  }

  /**
   * Analiza extracto bancario con sistema de fallback universal
   * @param {string} text - Texto del extracto
   * @returns {Promise<Object>} Datos estructurados del extracto
   */
  async analyzeFinancialStatementWithFallback(structuredText) {
    // Adaptamos el prompt para que busque las etiquetas <tx>
    const analysisPrompt = `${LLMService.PROMPTS.FINANCIAL_ANALYSIS}

**INSTRUCCIONES DE PROCESAMIENTO ADICIONALES**:
El siguiente texto contiene transacciones individuales envueltas en etiquetas <tx> y </tx>. Tu tarea es procesar el contenido de CADA una de estas etiquetas y convertirlo en un objeto en el array "transactions" del JSON. Ignora cualquier texto fuera de las etiquetas <tx>.`;

    try {
      // Intento principal con el prompt adaptado
      const result = await this.processText(structuredText, analysisPrompt, {
        model: LLMService.MODELS.MAVERICK,
        responseFormat: { type: "json_object" }
      });
      
      // Validar calidad
      const quality = this.validateExtractionQuality(result);
      logService.log(`[LLM_SERVICE] Extraction quality: ${quality.confidence} (${Math.round(quality.score)}%)`);
      
      if (quality.score < 70) {
        logService.log('[LLM_SERVICE] Low quality result, trying enhanced universal analysis');
        
        // Fallback: Prompt más estricto con instrucciones específicas
        const enhancedPrompt = `${analysisPrompt}

**INSTRUCCIONES ADICIONALES PARA MEJORAR CALIDAD**:
- El análisis anterior fue de baja calidad. Presta mucha atención a cada etiqueta <tx>.
- Asegúrate de que CADA transacción tenga al menos: fecha, monto, tipo.
- Si no puedes determinar la descripción exacta, preserva cualquier texto disponible dentro de la etiqueta <tx>.`;

        const enhancedResult = await this.processText(structuredText, enhancedPrompt, {
          model: LLMService.MODELS.MAVERICK,
          responseFormat: { type: "json_object" }
        });
        
        const enhancedQuality = this.validateExtractionQuality(enhancedResult);
        
        if (enhancedQuality.score > quality.score) {
          logService.log(`[LLM_SERVICE] Enhanced analysis improved quality to ${enhancedQuality.confidence}`);
          return enhancedResult;
        }
      }
      
      return result;
    } catch (error) {
      logService.error('[LLM_SERVICE] Analysis failed, trying recovery mode');
      throw new Error(`Financial analysis failed: ${error.message}`);
    }
  }

  /**
   * Analiza extracto bancario
   * @param {string} text - Texto del extracto
   * @returns {Promise<Object>} Datos estructurados del extracto
   */
  async analyzeFinancialStatement(text) {
    // Este método ahora solo analiza, asumiendo que el texto ya está estructurado.
    // El flujo correcto es llamar a analyzeDocumentWorkflow.
    logService.log('[LLM_SERVICE] Analyzing pre-structured financial statement.');
    return this.analyzeFinancialStatementWithFallback(text);
  }

  /**
   * Orquesta el flujo completo según el proveedor configurado
   * @param {string} rawText - Texto crudo del PDF.
   * @returns {Promise<Object>} Resultado del análisis completo.
   */
  async analyzeDocumentWorkflow(rawText) {
    logService.log(`[LLM_SERVICE] Starting analysis with provider: ${config.llmProvider}`);
    
    if (config.llmProvider === 'google' && config.google.geminiApiKey) {
      // Usar Google AI exclusivamente
      const googleAIService = await import('./googleAIService.js');
      const result = await googleAIService.default.analyzeFinancialDocument(rawText);
      const quality = googleAIService.default.validateExtractionQuality(result);
      
      logService.log(`[LLM_SERVICE] Google AI completed. Quality: ${quality.confidence} (${Math.round(quality.score)}%)`);
      return result;
      
    } else {
      // Usar Groq exclusivamente
      logService.log('[LLM_SERVICE] Using Groq two-step process');
      const structuredText = await this.structureLayout(rawText);
      const analysisResult = await this.analyzeFinancialStatementWithFallback(structuredText);
      return analysisResult;
    }
  }

  /**
   * Estructura texto en formato de tabla con pipes
   * @deprecated Usar el nuevo structureLayout que etiqueta con <tx>
   * @param {string} rawText - Texto sin estructura
   * @returns {Promise<string>} Texto estructurado con pipes
   */
  async structureLayout_DEPRECATED(rawText) {
    // Limitar texto para evitar costos excesivos
    const limitedText = rawText
      .split('\n')
      .slice(0, 100)
      .join('\n');

    try {
      const structuredText = await this.processText(limitedText, LLMService.PROMPTS.LAYOUT_STRUCTURING, {
        model: LLMService.MODELS.SCOUT,
        responseFormat: { type: 'text' }
      });

      // Validación básica - debe tener alguna estructura
      if (!structuredText.includes('|') && !structuredText.includes('[TABLE:') && !structuredText.includes('[SECTION:')) {
        logService.log('[LLM_SERVICE] Poor structure detected, trying enhanced approach');
        return await this.structureLayoutEnhanced(rawText);
      }

      return structuredText.trim();
    } catch (error) {
      logService.error('[LLM_SERVICE] Structure layout failed, trying enhanced approach');
      return await this.structureLayoutEnhanced(rawText);
    }
  }

  /**
   * Método genérico para compatibilidad con código existente
   * @deprecated Usar processText, analyzeFinancialStatement o structureLayout
   */
  async analyzeStatement(text, customPrompt = null, responseFormat = { type: "json_object" }, model = LLMService.MODELS.SCOUT) {
    return this.processText(text, customPrompt || LLMService.PROMPTS.FINANCIAL_ANALYSIS, {
      model,
      responseFormat
    });
  }
}

export default new LLMService();

  