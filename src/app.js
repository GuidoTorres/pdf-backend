import express from "express";
import cors from "cors";
import config from "./config/config.js";
import documentRoutes from "./routes/documentRoutes.js";
import authRoutes from "./routes/authRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import adminRoutes from "./routes/adminRoutes.js";
import webhookRoutes from "./routes/webhookRoutes.js";
import logService from "./services/logService.js";

const app = express();

app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:3000', 'http://127.0.0.1:5173', 'https://pdf-converter-sable.vercel.app'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposedHeaders: ['Content-Length', 'X-Foo', 'X-Bar'],
  maxAge: 86400,
  optionsSuccessStatus: 204
}));

// Aumentar límites para archivos grandes
app.use(express.json({ 
  limit: '50mb',
  verify: (req, res, buf) => {
    req.rawBody = buf.toString();
  }
}));

app.use(express.urlencoded({ 
  limit: '50mb', 
  extended: true 
}));

// Middleware para logging básico
app.use((req, res, next) => {
  const start = Date.now();
  
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} - Start`);
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} - ${res.statusCode} (${duration}ms)`);
  });
  
  next();
});

// Timeout middleware
app.use((req, res, next) => {
  const timeout = req.originalUrl.includes('/documents') ? 300000 : 30000;
  
  req.setTimeout(timeout, () => {
    console.log(`[${new Date().toISOString()}] Request timeout for ${req.method} ${req.originalUrl}`);
    if (!res.headersSent) {
      res.status(408).json({ error: 'Request timeout' });
    }
  });
  
  next();
});

// Registrar todas las rutas
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/webhooks', webhookRoutes);

// Manejador de errores global
app.use((err, req, res, next) => {
  console.error(`[${new Date().toISOString()}] Global error handler:`, err.stack);
  
  if (res.headersSent) {
    return next(err);
  }

  res.status(500).json({
    error: 'Error interno del servidor',
    details: err.message
  });
});

// Manejador para rutas no encontradas
app.use('*', (req, res) => {
  console.log(`[${new Date().toISOString()}] 404 - Route not found: ${req.method} ${req.originalUrl}`);
  res.status(404).json({ error: 'Ruta no encontrada' });
});

// Iniciar servidor
const server = app.listen(config.port, () => {
  console.log(`Servidor corriendo en el puerto ${config.port}`);
});

server.timeout = 300000;
server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;

export default app;