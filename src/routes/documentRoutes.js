import express from "express";
import multer from "multer";
import { processDocument, getHistory, getJobStatus } from "../controllers/documentController.js";
import authMiddleware from "../middleware/authMiddleware.js";

const router = express.Router();

// Configurar multer para archivos en memoria
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === "application/pdf") {
      cb(null, true);
    } else {
      cb(new Error("Solo se permiten archivos PDF"), false);
    }
  },
});

// Rutas protegidas (requieren autenticación)
router.use(authMiddleware);

/**
 * POST /api/documents/process
 * Encola un trabajo para procesar un PDF
 */
router.post("/process", upload.single("pdf"), processDocument);

/**
 * GET /api/documents/status/:jobId
 * Consulta el estado de un trabajo de procesamiento
 */
router.get("/status/:jobId", getJobStatus);

/**
 * GET /api/documents/history
 * Obtiene el historial de documentos procesados
 */
router.get("/history", getHistory);

// Manejo de errores de multer
router.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({
        error: "El archivo es demasiado grande",
        maxSize: "10MB",
      });
    }
  }

  if (error.message === "Solo se permiten archivos PDF") {
    return res.status(400).json({
      error: "Tipo de archivo no válido",
      allowedTypes: ["application/pdf"],
    });
  }

  next(error);
});

export default router;
