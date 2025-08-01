import "dotenv/config";
import path from 'path';

const config = {
  port: process.env.PORT || 3000,
  groqApiKey: process.env.GROQ_API_KEY,
  llmProvider: process.env.LLM_PROVIDER || 'docling',
  useDocling: true, // AGREGAR ESTA LÍNEA
  google: {
    projectId: process.env.GOOGLE_PROJECT_ID,
    location: process.env.GOOGLE_LOCATION,
    processorId: process.env.GOOGLE_DOCAI_PROCESSOR_ID,
    endpoint: process.env.GOOGLE_DOCAI_ENDPOINT,
    geminiApiKey: process.env.GOOGLE_GEMINI_API_KEY,
  },
  // Configuración de Docling
  docling: {
    pythonPath: process.env.DOCLING_PYTHON_PATH || 'python3',
    scriptPath: process.env.DOCLING_SCRIPT_PATH || path.join(process.cwd(), 'backend', 'docling_processor.py'),
    workerUrl: process.env.DOCLING_WORKER_URL || 'http://127.0.0.1:5001/process',
    timeout: parseInt(process.env.DOCLING_TIMEOUT) || 600000, // 10 minutos para primera descarga
    tempDir: process.env.DOCLING_TEMP_DIR || path.join(process.cwd(), 'temp')
  },
  supabase: {
    url: process.env.SUPABASE_URL,
    key: process.env.SUPABASE_SERVICE_KEY,
    anonKey: process.env.SUPABASE_ANON_KEY,
  },
  lemonSqueezy: {
    apiKey: process.env.LEMON_SQUEEZY_API_KEY,
    webhookSecret: process.env.LEMON_SQUEEZY_WEBHOOK_SECRET,
    variants: {
      starter: process.env.LEMON_SQUEEZY_STARTER_VARIANT_ID,
      pro: process.env.LEMON_SQUEEZY_PRO_VARIANT_ID,
      business: process.env.LEMON_SQUEEZY_BUSINESS_VARIANT_ID,
    },
  },
  subscriptionPlans: {
    starter: 400,
    pro: 1000,
    business: 2000,
  },
  redis: {
    url: process.env.REDIS_URL || 'redis://127.0.0.1:6379'
  }
};

export default config;