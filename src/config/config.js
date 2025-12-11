import "dotenv/config";
import path from 'path';

const config = {
  port: process.env.PORT || 3000,
  groqApiKey: process.env.GROQ_API_KEY,
  llmProvider: process.env.LLM_PROVIDER || 'groq',
  google: {
    projectId: process.env.GOOGLE_PROJECT_ID,
    location: process.env.GOOGLE_LOCATION,
    processorId: process.env.GOOGLE_DOCAI_PROCESSOR_ID,
    endpoint: process.env.GOOGLE_DOCAI_ENDPOINT,
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  },
  database: {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    name: process.env.DB_NAME || 'stamentai',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    ssl: process.env.DB_SSL === 'true'
  },
  jwt: {
    secret: process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-this-in-production',
    expiresIn: process.env.JWT_EXPIRES_IN || '7d'
  },
  email: {
    host: process.env.EMAIL_HOST,
    port: process.env.EMAIL_PORT || 587,
    user: process.env.EMAIL_USER,
    password: process.env.EMAIL_PASSWORD,
    from: process.env.EMAIL_FROM || 'noreply@stamentai.com'
  },
  env: process.env.NODE_ENV || 'development',
  paddle: {
    vendorId: process.env.PADDLE_VENDOR_ID,
    apiKey: process.env.PADDLE_API_KEY,
    publicKey: process.env.PADDLE_PUBLIC_KEY,
    webhookSecret: process.env.PADDLE_WEBHOOK_SECRET,
    products: {
      starter: process.env.PADDLE_PRODUCT_STARTER_ID,
      pro: process.env.PADDLE_PRODUCT_PRO_ID,
      business: process.env.PADDLE_PRODUCT_BUSINESS_ID,
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
