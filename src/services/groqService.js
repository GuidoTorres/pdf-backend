import Groq from 'groq-sdk';
import config from '../config/config.js';
import logService from './logService.js';
import { jsonrepair } from 'jsonrepair';

let groq;

function getGroqClient() {
  if (!groq) {
    if (!config.groqApiKey) {
      throw new Error('Groq API key is not configured.');
    }
    groq = new Groq({
      apiKey: config.groqApiKey,
    });
  }
  return groq;
}

const defaultSystemPrompt = `Eres un analista financiero senior. Analiza el texto plano resultante de OCR de un extracto bancario cualquiera (cualquier país, idioma y formato) y produce SOLO un JSON válido, sin explicación.

**Requisitos de extracción**

1. **Ignora** cabeceras, pies de página, publicidad y resúmenes duplicados.
2. Reconoce fechas en formatos: DD/MM/YYYY, DD‑MMM‑YY, MM‑DD‑YYYY, YYYY‑MM‑DD.
3. Normaliza montos:
   • separadores de miles "." "," o espacio → elimina  
   • decimal → usa "."  
   • si existe una sola columna “Amount”, usa signo o abreviatura CR/DR para "type".
4. Añade "balanceCheck" = true si "openingBalance + Σ amount = closingBalance" (dentro de ±0.05).
5. Cualquier dato dudoso → null.

**Esquema estricto**

"json":{
  "meta": {
    "bankName": "string | null",
    "accountNumber": "string | null",
    "currency": "string | null",
    "period": {
      "startDate": "YYYY-MM-DD | null",
      "endDate": "YYYY-MM-DD | null"
    },
    "openingBalance": "number | null",
    "closingBalance": "number | null",
    "balanceCheck": "boolean | null"
  },
  "transactions": [
    {
      "postDate": "YYYY-MM-DD",
      "valueDate": "YYYY-MM-DD | null",
      "description": "string",
      "amount": number,          // negativo = débito
      "type": "CREDIT | DEBIT",
      "currency": "string | null",
      "balanceAfter": "number | null"
    }
  ]
}
`;

async function analyzeStatement(text, customPrompt = null, responseFormat = { type: "json_object" }, model = "meta-llama/llama-4-scout-17b-16e-instruct") {
  const client = getGroqClient();

  try {
    logService.log('Input text to Groq:', text);
    const chatCompletion = await groq.chat.completions.create({
      messages: [
        {
          role: "system",
          content: customPrompt || defaultSystemPrompt,
        },
        {
          role: "user",
          content: `Analiza el siguiente texto preprocesado en formato de tabla con pipes y devuelve las transacciones en formato JSON. El texto está estructurado con un encabezado y filas de datos separadas por el caracter '|'.

Texto preprocesado:
<<<
${text}
>>>`,
        },
      ],
      model: model, // Usar el modelo pasado como parámetro
      response_format: responseFormat,
    });

    const rawResponse = chatCompletion.choices[0]?.message?.content;
    logService.log('Groq Raw Response:', rawResponse);

    if (!rawResponse) {
      throw new Error('Groq did not return a response.');
    }

    // Solo intentar reparar y parsear si se espera un objeto JSON
    if (responseFormat && responseFormat.type === "json_object") {
      const repairedResponse = jsonrepair(rawResponse);
      const parsedResponse = JSON.parse(repairedResponse);
      return parsedResponse;
    } else {
      return rawResponse; // Devolver el string directamente para clasificación
    }

  } catch (error) {
    logService.error('Error al analizar el extracto con Groq:', error);
    throw new Error('Error al procesar el extracto bancario con Groq.');
  }
}

export default {
  analyzeStatement,
};
