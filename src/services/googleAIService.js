import { GoogleGenerativeAI } from '@google/generative-ai';
import config from '../config/config.js';
import logService from './logService.js';
import { jsonrepair } from 'jsonrepair';

class GoogleAIService {
  constructor() {
    this.genAI = null;
    this.model = null;
    this.initializeClient();
  }

  initializeClient() {
    if (!config.google.geminiApiKey) {
      throw new Error('Google Gemini API key is not configured.');
    }
    
    this.genAI = new GoogleGenerativeAI(config.google.geminiApiKey);
    this.model = this.genAI.getGenerativeModel({ 
      model: "gemini-1.5-flash",
      generationConfig: {
        temperature: 0.1, // Más determinístico para datos estructurados
        topK: 1,
        topP: 0.8,
        maxOutputTokens: 8192,
      }
    });
  }

  /**
   * Analiza extracto bancario directamente con Gemini (REEMPLAZO COMPLETO)
   * @param {string} text - Texto del extracto
   * @returns {Promise<Object>} Resultado del análisis
   */
  async analyzeFinancialDocument(text) {
    const startTime = Date.now();
    
    try {
      logService.log('[GOOGLE_AI] Starting complete document analysis with Gemini');
      
      const prompt = `Eres un experto en análisis de extractos bancarios. Analiza este documento y extrae TODA la información en formato JSON.

ESQUEMA JSON REQUERIDO:
{
  "metadata": {
    "bankName": "string|null",
    "accountNumber": "string|null", 
    "currency": "string|null",
    "period": {"startDate": "YYYY-MM-DD|null", "endDate": "YYYY-MM-DD|null"},
    "openingBalance": "number|null",
    "closingBalance": "number|null"
  },
  "transactions": [{
    "postDate": "YYYY-MM-DD",
    "description": "string exacto del documento",
    "amount": number,
    "type": "CREDIT|DEBIT",
    "balanceAfter": "number|null"
  }]
}

INSTRUCCIONES CRÍTICAS:
- Extrae TODAS las transacciones de TODAS las tablas/secciones
- Conserva descripciones EXACTAS como aparecen en el documento
- Detecta automáticamente idioma, formato de fecha y moneda
- Si hay múltiples secciones (ATM, Depósitos, Retiros, etc.), inclúyelas todas
- Para type: usa "CREDIT" si es ingreso/depósito, "DEBIT" si es gasto/retiro
- Responde ÚNICAMENTE con JSON válido, sin explicaciones ni comentarios

EXTRACTO BANCARIO:
${text}`;

      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      const rawText = response.text();
      
      const processingTime = Date.now() - startTime;
      logService.log(`[GOOGLE_AI] Processing completed in ${processingTime}ms`);
      
      // Limpiar y parsear JSON
      const cleanedResponse = rawText.replace(/```json|```/g, '').trim();
      const repairedResponse = jsonrepair(cleanedResponse);
      const parsedResponse = JSON.parse(repairedResponse);
      
      logService.log(`[GOOGLE_AI] Successfully extracted ${parsedResponse.transactions?.length || 0} transactions`);
      
      return parsedResponse;
      
    } catch (error) {
      const processingTime = Date.now() - startTime;
      logService.error(`[GOOGLE_AI] Error after ${processingTime}ms:`, error);
      throw new Error(`Google AI processing failed: ${error.message}`);
    }
  }

  /**
   * Valida la calidad del resultado (mismo método que llmService)
   */
  validateExtractionQuality(result) {
    const quality = {
      score: 0,
      confidence: 'LOW',
      issues: [],
      metrics: {}
    };

    if (!result.metadata && (!result.transactions || result.transactions.length === 0)) {
      quality.issues.push('NO_DATA_EXTRACTED');
      return quality;
    }

    const allTransactions = result.transactions || [];

    if (allTransactions.length > 0) {
      const validTransactions = allTransactions.filter(t => 
        t.postDate && t.description && t.amount !== null && t.type
      );
      
      quality.metrics.transactionCompleteness = validTransactions.length / allTransactions.length;
      quality.score += quality.metrics.transactionCompleteness * 40;

      const validDates = validTransactions.filter(t => 
        /^\d{4}-\d{2}-\d{2}$/.test(t.postDate)
      ).length;
      quality.metrics.dateValidation = validTransactions.length > 0 ? validDates / validTransactions.length : 1;
      quality.score += quality.metrics.dateValidation * 20;

      const validAmounts = validTransactions.filter(t => 
        typeof t.amount === 'number' && !isNaN(t.amount)
      ).length;
      quality.metrics.amountValidation = validTransactions.length > 0 ? validAmounts / validTransactions.length : 1;
      quality.score += quality.metrics.amountValidation * 20;

      const genericDescriptions = allTransactions.filter(t => 
        !t.description || 
        t.description === 'Operación bancaria' || 
        t.description === 'Bank transaction'
      ).length;
      
      if (genericDescriptions > allTransactions.length * 0.3) {
        quality.issues.push(`HIGH_GENERIC_DESCRIPTIONS_${genericDescriptions}`);
        quality.score -= 15;
      }
    } else {
      quality.score += 20;
    }

    if (result.metadata?.balanceCheck === true) {
      quality.score += 20;
      quality.metrics.balanceVerified = true;
    }

    if (quality.score >= 80) quality.confidence = 'HIGH';
    else if (quality.score >= 60) quality.confidence = 'MEDIUM';
    else quality.confidence = 'LOW';

    return quality;
  }
}

export default new GoogleAIService();